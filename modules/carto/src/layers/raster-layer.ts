// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Accessor,
  CompositeLayer,
  CompositeLayerProps,
  Layer,
  LayersList,
  DefaultProps,
  PickingInfo
} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';
import {ColumnLayer, ColumnLayerProps} from '@deck.gl/layers';
import {cellToTile} from 'quadbin';
import {latitudeToWorldY, quadbinToOffset} from './quadbin-utils';
import {DEFAULT_TILE_MATRIX_SET, TileMatrixSet} from './tile-matrix-set';
import {Raster} from './schema/carto-raster-tile-loader';
import vs from './raster-layer-vertex.glsl';
import {createBinaryProxy} from '../utils';
import {RTTModifier} from './post-process-utils';

const defaultProps: DefaultProps<RasterLayerProps> = {
  ...ColumnLayer.defaultProps,
  extruded: false,
  diskResolution: 4,
  vertices: [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5]
  ]
};

// Per-tile uniforms for the GoogleCRS84Quad (plate carrée) raster reprojection. `northLat` is the
// latitude of the tile's north edge and `dLat` the latitude span of a single pixel row; together
// they let the vertex shader map each row's latitude band onto Mercator world Y.
const rasterUniformBlock = `\
layout(std140) uniform rasterUniforms {
  float northLat;
  float dLat;
} raster;
`;

type RasterUniformProps = {northLat: number; dLat: number};
const rasterUniforms = {
  name: 'raster',
  vs: rasterUniformBlock,
  uniformTypes: {
    northLat: 'f32',
    dLat: 'f32'
  }
} as const satisfies ShaderModule<RasterUniformProps>;

// Modified ColumnLayer with custom vertex shader
// Use RTT to avoid inter-tile seams
class RasterColumnLayer extends RTTModifier(ColumnLayer) {
  static layerName = 'RasterColumnLayer';

  getShaders() {
    const shaders = super.getShaders();
    const data = this.props.data as unknown as {data: Raster; length: number};
    const BLOCK_WIDTH = data.data.blockSize ?? Math.sqrt(data.length);
    const defines: Record<string, any> = {...shaders.defines, BLOCK_WIDTH};
    const modules = [...shaders.modules];
    // Gate the plate-carrée row reprojection behind a compile-time define so WebMercatorQuad keeps
    // the original uniform-grid layout with zero added instructions (no regression).
    if ((this.props as {tileMatrixSet?: TileMatrixSet}).tileMatrixSet === 'GoogleCRS84Quad') {
      defines.GOOGLE_CRS84_QUAD = 1;
      modules.push(rasterUniforms);
    }
    return {...shaders, defines, modules, vs};
  }

  draw(opts: any) {
    if ((this.props as {tileMatrixSet?: TileMatrixSet}).tileMatrixSet === 'GoogleCRS84Quad') {
      const {northLat, dLat} = this.props as unknown as RasterUniformProps;
      const rasterProps: RasterUniformProps = {northLat, dLat};
      for (const model of this.state.models ?? []) {
        model.shaderInputs.setProps({raster: rasterProps});
      }
    }
    super.draw(opts);
  }

  initializeState() {
    // Only add attributes needed by shader
    const attributeManager = this.getAttributeManager()!;
    /* eslint-disable max-len */
    attributeManager.addInstanced({
      instanceElevations: {
        size: 1,
        transition: true,
        accessor: 'getElevation'
      },
      instanceFillColors: {
        size: this.props.colorFormat.length,
        type: 'unorm8',
        transition: true,
        accessor: 'getFillColor',
        defaultValue: [0, 0, 0, 255]
      },
      instanceLineColors: {
        size: this.props.colorFormat.length,
        type: 'unorm8',
        transition: true,
        accessor: 'getLineColor',
        defaultValue: [255, 255, 255, 255]
      }
    });
  }
}

/** All properties supported by RasterLayer. */
export type RasterLayerProps<DataT = unknown> = _RasterLayerProps &
  ColumnLayerProps<DataT> &
  CompositeLayerProps;

/** Properties added by RasterLayer. */
type _RasterLayerProps = {
  /**
   * Quadbin index of tile
   */
  tileIndex: bigint;

  /**
   * Tile Matrix Set the raster cells are indexed in. Controls how cells are laid out / reprojected.
   *
   * @default 'WebMercatorQuad'
   */
  tileMatrixSet?: TileMatrixSet;
};

type RasterColumnLayerData = {
  data: Raster;
  length: number;
};

function wrappedDataComparator(oldData: RasterColumnLayerData, newData: RasterColumnLayerData) {
  return oldData.data === newData.data && oldData.length === newData.length;
}

// Adapter layer around RasterColumnLayer that converts data & accessors into correct format
export default class RasterLayer<DataT = any, ExtraProps = {}> extends CompositeLayer<
  Required<RasterLayerProps<DataT>> & ExtraProps
> {
  static layerName = 'RasterLayer';
  static defaultProps = defaultProps;

  state!: {
    highlightedObjectIndex: number;
    highlightColor: number[];
  };

  renderLayers(): Layer | null | LayersList {
    // Rendering props underlying layer
    const {
      data,
      getElevation,
      getFillColor,
      getLineColor,
      getLineWidth,
      tileIndex,
      tileMatrixSet = DEFAULT_TILE_MATRIX_SET,
      updateTriggers
    } = this.props as typeof this.props & {data: Raster};
    if (!data || !tileIndex || (data as any).length === 0) return null;

    const blockSize = data.blockSize ?? 0;
    const [xOffset, yOffset, scale] = quadbinToOffset(tileIndex);
    const offset = [xOffset, yOffset];
    const lineWidthScale = scale / blockSize;

    // For GoogleCRS84Quad, pixel rows are uniform in latitude and must be reprojected onto Mercator
    // world Y in the shader. Anchor the tile's north edge in Mercator common space here (float64)
    // and pass the per-row latitude span so the shader only computes small offsets.
    let northLat = 0;
    let dLat = 0;
    if (tileMatrixSet === 'GoogleCRS84Quad' && blockSize > 0) {
      const {y, z} = cellToTile(tileIndex);
      const worldScale = 2 ** z;
      northLat = 90 - (y / worldScale) * 180;
      const southLat = 90 - ((y + 1) / worldScale) * 180;
      dLat = (northLat - southLat) / blockSize;
      offset[1] = latitudeToWorldY(northLat);
    }

    // Filled Column Layer
    const CellLayer = this.getSubLayerClass('column', RasterColumnLayer);
    const {highlightedObjectIndex, highlightColor} = this.state;
    return new CellLayer(
      this.props,
      this.getSubLayerProps({
        id: 'cell',
        updateTriggers,

        getElevation: this.getSubLayerAccessor(getElevation),
        getFillColor: this.getSubLayerAccessor(getFillColor),
        getLineColor: this.getSubLayerAccessor(getLineColor),
        getLineWidth: this.getSubLayerAccessor(getLineWidth)
      }),
      {
        data: {
          data, // Pass through data for getSubLayerAccessor()
          length: blockSize * blockSize
        },
        dataComparator: wrappedDataComparator,
        offset,
        lineWidthScale, // Re-use widthScale prop to pass cell scale,
        tileMatrixSet,
        northLat,
        dLat,
        highlightedObjectIndex,
        highlightColor
      }
    );
  }

  protected getSubLayerAccessor<In, Out>(accessor: Accessor<In, Out>): Accessor<In, Out> {
    if (typeof accessor !== 'function') {
      return super.getSubLayerAccessor(accessor);
    }

    // Proxy values back in standard feature format
    return (object, info) => {
      const {data, index} = info;
      const binaryData = (data as unknown as {data: Raster}).data;
      const proxy = createBinaryProxy(binaryData.cells, index);
      // @ts-ignore (TS2349) accessor is always function
      return accessor({properties: proxy}, info);
    };
  }

  getPickingInfo(params: any) {
    const info = super.getPickingInfo(params);

    if (info.index !== -1) {
      info.object = this.getSubLayerAccessor((x: any) => x)(undefined, {
        data: this.props,
        index: info.index
      });
    }

    return info;
  }

  _updateAutoHighlight(info: PickingInfo) {
    const {highlightedObjectIndex} = this.state;
    let newHighlightedObjectIndex: number = -1;

    if (info.index !== -1) {
      newHighlightedObjectIndex = info.index;
    }

    if (highlightedObjectIndex !== newHighlightedObjectIndex) {
      let {highlightColor} = this.props;
      if (typeof highlightColor === 'function') {
        highlightColor = highlightColor(info);
      }

      this.setState({
        highlightColor,
        highlightedObjectIndex: newHighlightedObjectIndex
      });
    }
  }
}
