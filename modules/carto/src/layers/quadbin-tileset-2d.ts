// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {_Tileset2D as Tileset2D} from '@deck.gl/geo-layers';
import {bigIntToHex, cellToParent, cellToTile, getResolution, tileToCell} from 'quadbin';
import {crs84TileToLngLat, DEFAULT_TILE_MATRIX_SET, TileMatrixSet} from './tile-matrix-set';

const TILE_SIZE = 512;

// For calculations bigint representation is used, but
// for constructing URL also provide the hexidecimal value
type QuadbinTileIndex = {q: bigint; i?: string};

export default class QuadbinTileset2D extends Tileset2D {
  /**
   * The effective Tile Matrix Set, threaded down from the layer via tileset options. Defaults to
   * `WebMercatorQuad` so existing data and the `super` (Mercator OSM cover) path are unchanged.
   */
  get tileMatrixSet(): TileMatrixSet {
    return (this.opts as {tileMatrixSet?: TileMatrixSet}).tileMatrixSet ?? DEFAULT_TILE_MATRIX_SET;
  }

  // @ts-expect-error for spatial indices, TileSet2d should be parametrized by TileIndexT
  getTileIndices(opts): QuadbinTileIndex[] {
    if (this.tileMatrixSet === 'GoogleCRS84Quad') {
      // geo-layers core picks visible tiles with a Mercator OSM cover; for plate carrée we must
      // enumerate the covering cells from the viewport's lng/lat bounds with linear tile math.
      return this._getCRS84TileIndices(opts);
    }
    return super
      .getTileIndices(opts)
      .map(tileToCell)
      .map(q => ({q, i: bigIntToHex(q)}));
  }

  /** GoogleCRS84Quad viewport cover: enumerate the plate-carrée cells overlapping the viewport. */
  private _getCRS84TileIndices({viewport, minZoom, maxZoom}): QuadbinTileIndex[] {
    const {tileSize = TILE_SIZE} = this.opts;

    // Match the core zoom selection so tiles are fetched at the same level as Mercator basemaps:
    // at viewport.zoom = 9.5 we want z = 10. Then clamp to the data's available resolutions.
    let z = Math.round(viewport.zoom + Math.log2(TILE_SIZE / tileSize));
    if (Number.isFinite(minZoom) && z < minZoom!) z = minZoom!;
    if (Number.isFinite(maxZoom) && z > maxZoom!) z = maxZoom!;
    if (z < 0) return [];

    const scale = 2 ** z;
    const [west, south, east, north] = viewport.getBounds();

    // Plate-carrée tile math: x linear over -180..180, y linear over 90..-90 (north-up tile rows).
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
    const xMin = clamp(Math.floor(((west + 180) / 360) * scale), scale - 1);
    const xMax = clamp(Math.floor(((east + 180) / 360) * scale), scale - 1);
    const yMin = clamp(Math.floor(((90 - north) / 180) * scale), scale - 1);
    const yMax = clamp(Math.floor(((90 - south) / 180) * scale), scale - 1);

    const indices: QuadbinTileIndex[] = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const q = tileToCell({x, y, z});
        indices.push({q, i: bigIntToHex(q)});
      }
    }
    return indices;
  }

  // @ts-expect-error TileIndex must be generic
  getTileId({q, i}: QuadbinTileIndex): string {
    return i || bigIntToHex(q);
  }

  // @ts-expect-error TileIndex must be generic
  getTileMetadata({q}: QuadbinTileIndex) {
    if (this.tileMatrixSet === 'GoogleCRS84Quad') {
      // Mercator `super.getTileMetadata` would compute a Mercator bbox; for plate carrée the cell
      // bounds (used for viewport culling) must be linear in latitude.
      const {x, y, z} = cellToTile(q);
      const [west, north] = crs84TileToLngLat(x, y, z);
      const [east, south] = crs84TileToLngLat(x + 1, y + 1, z);
      return {bbox: {west, north, east, south}};
    }
    return super.getTileMetadata(cellToTile(q));
  }

  // @ts-expect-error TileIndex must be generic
  getTileZoom({q}: QuadbinTileIndex): number {
    return Number(getResolution(q));
  }

  // @ts-expect-error TileIndex must be generic
  getParentIndex({q}: QuadbinTileIndex): QuadbinTileIndex {
    return {q: cellToParent(q)};
  }
}
