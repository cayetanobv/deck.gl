// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {lngLatToWorld, worldToLngLat} from '@math.gl/web-mercator';
import {cellToTile} from 'quadbin';
import {crs84TileToLngLat, DEFAULT_TILE_MATRIX_SET, TileMatrixSet} from './tile-matrix-set';

const TILE_SIZE = 512;

export function quadbinToOffset(quadbin: bigint): [number, number, number] {
  const {x, y, z} = cellToTile(quadbin);
  const scale = TILE_SIZE / (1 << z);
  return [x * scale, TILE_SIZE - y * scale, scale];
}

export function quadbinToWorldBounds(quadbin: bigint, coverage: number): [number[], number[]] {
  const [xOffset, yOffset, scale] = quadbinToOffset(quadbin);
  return [
    [xOffset, yOffset],
    [xOffset + coverage * scale, yOffset - coverage * scale]
  ];
}

/**
 * Mercator world-space Y (north-up, [0, TILE_SIZE]) of a latitude, matching the convention used by
 * {@link quadbinToOffset}. Used by the GoogleCRS84Quad raster path to anchor a tile's north edge in
 * Mercator common space on the CPU (float64), so the shader only computes small per-row offsets.
 */
export function latitudeToWorldY(latitude: number): number {
  return lngLatToWorld([0, latitude])[1];
}

/**
 * Decode a quadbin cell to a closed polygon ring in lng/lat, TMS-aware.
 *
 * For `WebMercatorQuad` (default) the cell corners are mapped through the Mercator projection
 * exactly as before. For `GoogleCRS84Quad` they are mapped linearly (plate carrée) — a quadbin
 * cell decoded as Mercator would otherwise be placed at the wrong latitude, with no error.
 */
export function getQuadbinPolygon(
  quadbin: bigint,
  coverage = 1,
  tileMatrixSet: TileMatrixSet = DEFAULT_TILE_MATRIX_SET
): number[] {
  if (tileMatrixSet === 'GoogleCRS84Quad') {
    const {x, y, z} = cellToTile(quadbin);
    const [w, n] = crs84TileToLngLat(x, y, z);
    const [e, s] = crs84TileToLngLat(x + coverage, y + coverage, z);
    return [e, n, e, s, w, s, w, n, e, n];
  }

  const [topLeft, bottomRight] = quadbinToWorldBounds(quadbin, coverage);
  const [w, n] = worldToLngLat(topLeft);
  const [e, s] = worldToLngLat(bottomRight);
  return [e, n, e, s, w, s, w, n, e, n];
}
