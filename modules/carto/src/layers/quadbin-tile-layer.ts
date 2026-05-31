// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, CompositeLayerProps, DefaultProps} from '@deck.gl/core';
import QuadbinLayer, {QuadbinLayerProps} from './quadbin-layer';
import QuadbinTileset2D from './quadbin-tileset-2d';
import SpatialIndexTileLayer, {SpatialIndexTileLayerProps} from './spatial-index-tile-layer';
import {hexToBigInt} from 'quadbin';
import type {TilejsonResult} from '@carto/api-client';
import {TilejsonPropType, mergeLoadOptions} from './utils';
import {DEFAULT_TILE_SIZE} from '../constants';
import {resolveTileMatrixSet, TileMatrixSet} from './tile-matrix-set';

export const renderSubLayers = props => {
  const {data} = props;
  if (!data || !data.length) return null;
  const isBigInt = typeof data[0].id === 'bigint';
  return new QuadbinLayer(props, {
    getQuadbin: isBigInt ? d => d.id : d => hexToBigInt(d.id)
  });
};

const defaultProps: DefaultProps<QuadbinTileLayerProps> = {
  data: TilejsonPropType,
  tileSize: DEFAULT_TILE_SIZE,
  tileMatrixSet: null
};

/** All properties supported by QuadbinTileLayer. */
export type QuadbinTileLayerProps<DataT = unknown> = _QuadbinTileLayerProps<DataT> &
  CompositeLayerProps;

/** Properties added by QuadbinTileLayer. */
type _QuadbinTileLayerProps<DataT> = Omit<QuadbinLayerProps<DataT>, 'data' | 'tileMatrixSet'> &
  Omit<SpatialIndexTileLayerProps<DataT>, 'data' | 'tileMatrixSet'> & {
    data: null | TilejsonResult | Promise<TilejsonResult>;

    /**
     * Tile Matrix Set the quadbin tiles are indexed in. When omitted it is read from the tileset
     * metadata (`tile_matrix_set`), defaulting to `'WebMercatorQuad'` for back-compat.
     */
    tileMatrixSet?: TileMatrixSet | null;
  };

export default class QuadbinTileLayer<
  DataT = any,
  ExtraProps extends {} = {}
> extends CompositeLayer<ExtraProps & Required<_QuadbinTileLayerProps<DataT>>> {
  static layerName = 'QuadbinTileLayer';
  static defaultProps = defaultProps;

  getLoadOptions(): any {
    const tileJSON = this.props.data as TilejsonResult;
    return mergeLoadOptions(super.getLoadOptions(), {
      fetch: {headers: {Authorization: `Bearer ${tileJSON.accessToken}`}},
      cartoSpatialTile: {scheme: 'quadbin'}
    });
  }

  renderLayers(): SpatialIndexTileLayer | null {
    const tileJSON = this.props.data as TilejsonResult;
    if (!tileJSON) return null;

    const {tiles: data, maxresolution: maxZoom} = tileJSON;
    // TODO: drop the cast once the pinned @carto/api-client adds `tile_matrix_set` to Tilejson.
    const tileMatrixSet = resolveTileMatrixSet(
      this.props.tileMatrixSet,
      (tileJSON as {tile_matrix_set?: string}).tile_matrix_set
    );
    const SubLayerClass = this.getSubLayerClass('spatial-index-tile', SpatialIndexTileLayer);
    return new SubLayerClass(this.props, {
      id: `quadbin-tile-layer-${this.props.id}`,
      data,
      // TODO: Tileset2D should be generic over TileIndex type
      TilesetClass: QuadbinTileset2D as any,
      renderSubLayers,
      maxZoom,
      tileMatrixSet,
      loadOptions: this.getLoadOptions()
    });
  }
}
