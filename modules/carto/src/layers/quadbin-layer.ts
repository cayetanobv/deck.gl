// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {AccessorFunction, DefaultProps} from '@deck.gl/core';
import {
  _GeoCellLayer as GeoCellLayer,
  _GeoCellLayerProps as GeoCellLayerProps
} from '@deck.gl/geo-layers';
import {getQuadbinPolygon} from './quadbin-utils';
import {DEFAULT_TILE_MATRIX_SET, TileMatrixSet} from './tile-matrix-set';

const defaultProps: DefaultProps<QuadbinLayerProps> = {
  getQuadbin: {type: 'accessor', value: (d: any) => d.quadbin},
  tileMatrixSet: DEFAULT_TILE_MATRIX_SET
};

/** All properties supported by QuadbinLayer. */
export type QuadbinLayerProps<DataT = unknown> = _QuadbinLayerProps<DataT> &
  GeoCellLayerProps<DataT>;

/** Properties added by QuadbinLayer. */
type _QuadbinLayerProps<DataT> = {
  /**
   * Called for each data object to retrieve the quadbin string identifier.
   *
   * By default, it reads `quadbin` property of data object.
   */
  getQuadbin?: AccessorFunction<DataT, bigint>;

  /**
   * Tile Matrix Set the quadbin cells are indexed in, controlling how each cell maps to lng/lat.
   *
   * @default 'WebMercatorQuad'
   */
  tileMatrixSet?: TileMatrixSet;
};

export default class QuadbinLayer<DataT = any, ExtraProps extends {} = {}> extends GeoCellLayer<
  DataT,
  Required<_QuadbinLayerProps<DataT>> & ExtraProps
> {
  static layerName = 'QuadbinLayer';
  static defaultProps = defaultProps;

  indexToBounds(): Partial<GeoCellLayer['props']> | null {
    const {data, extruded, getQuadbin, tileMatrixSet} = this.props;
    // To avoid z-fighting reduce polygon footprint when extruding
    const coverage = extruded ? 0.99 : 1;

    return {
      data,
      _normalize: false,
      positionFormat: 'XY',

      getPolygon: (x: DataT, objectInfo) =>
        getQuadbinPolygon(getQuadbin(x, objectInfo), coverage, tileMatrixSet),
      updateTriggers: {getPolygon: [coverage, tileMatrixSet]}
    };
  }
}
