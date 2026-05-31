// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  CompositeLayerProps,
  DefaultProps,
  FilterContext,
  Layer,
  LayersList
} from '@deck.gl/core';
import RasterLayer, {RasterLayerProps} from './raster-layer';
import QuadbinTileset2D from './quadbin-tileset-2d';
import type {TilejsonResult} from '@carto/api-client';
import {TilejsonPropType, mergeLoadOptions} from './utils';
import {DEFAULT_TILE_SIZE} from '../constants';
import {resolveTileMatrixSet, TileMatrixSet} from './tile-matrix-set';
import {TileLayer, TileLayerProps} from '@deck.gl/geo-layers';
import {copy, PostProcessModifier} from './post-process-utils';
import {registerLoaders} from '@loaders.gl/core';
import CartoRasterTileLoader from './schema/carto-raster-tile-loader';

registerLoaders([CartoRasterTileLoader]);

export const renderSubLayers = props => {
  const tileIndex = props.tile?.index?.q;
  if (!tileIndex) return null;
  return new RasterLayer(props, {tileIndex});
};

const defaultProps: DefaultProps<RasterTileLayerProps> = {
  data: TilejsonPropType,
  refinementStrategy: 'no-overlap',
  tileSize: DEFAULT_TILE_SIZE,
  tileMatrixSet: null
};

/** All properties supported by RasterTileLayer. */
export type RasterTileLayerProps<DataT = unknown> = _RasterTileLayerProps<DataT> &
  CompositeLayerProps;

/** Properties added by RasterTileLayer. */
type _RasterTileLayerProps<DataT> = Omit<RasterLayerProps<DataT>, 'data' | 'tileMatrixSet'> &
  Omit<TileLayerProps<DataT>, 'data'> & {
    data: null | TilejsonResult | Promise<TilejsonResult>;

    /**
     * Tile Matrix Set the raster tiles are indexed in. When omitted it is read from the raster
     * metadata (`tile_matrix_set`), defaulting to `'WebMercatorQuad'` for back-compat.
     */
    tileMatrixSet?: TileMatrixSet | null;
  };

class PostProcessTileLayer extends PostProcessModifier(TileLayer, copy) {
  static layerName = 'PostProcessTileLayer';

  // Forward the TMS into the Tileset2D options so the tileset can pick a TMS-aware tile cover.
  _getTilesetOptions() {
    return {
      ...super._getTilesetOptions(),
      tileMatrixSet: (this.props as {tileMatrixSet?: TileMatrixSet}).tileMatrixSet
    };
  }

  filterSubLayer(context: FilterContext) {
    // Handle DrawCallbackLayer
    const {tile} = (context.layer as Layer<{tile: any}>).props;
    if (!tile) return true;

    return super.filterSubLayer(context);
  }
}

export default class RasterTileLayer<
  DataT = any,
  ExtraProps extends {} = {}
> extends CompositeLayer<ExtraProps & Required<_RasterTileLayerProps<DataT>>> {
  static layerName = 'RasterTileLayer';
  static defaultProps = defaultProps;

  getLoadOptions(): any {
    const tileJSON = this.props.data as TilejsonResult;
    return mergeLoadOptions(super.getLoadOptions(), {
      fetch: {headers: {Authorization: `Bearer ${tileJSON.accessToken}`}}
    });
  }

  renderLayers(): Layer | null | LayersList {
    const tileJSON = this.props.data as TilejsonResult;
    if (!tileJSON) return null;

    const {tiles: data, minzoom: minZoom, maxzoom: maxZoom, raster_metadata: metadata} = tileJSON;
    // TODO: drop the casts once the pinned @carto/api-client adds `tile_matrix_set` to
    // RasterMetadata / Tilejson (see carto-api-client feat/tile-matrix-set-metadata).
    const tileMatrixSet = resolveTileMatrixSet(
      this.props.tileMatrixSet,
      (metadata as {tile_matrix_set?: string} | undefined)?.tile_matrix_set ??
        (tileJSON as {tile_matrix_set?: string}).tile_matrix_set
    );
    const SubLayerClass = this.getSubLayerClass('tile', PostProcessTileLayer);
    const loadOptions = this.getLoadOptions();
    return new SubLayerClass(this.props, {
      id: `raster-tile-layer-${this.props.id}`,
      data,
      // TODO: Tileset2D should be generic over TileIndex type
      TilesetClass: QuadbinTileset2D as any,
      renderSubLayers,
      minZoom,
      maxZoom,
      tileMatrixSet,
      loadOptions: {
        ...loadOptions,
        cartoRasterTile: {...loadOptions?.cartoRasterTile, metadata}
      }
    });
  }
}
