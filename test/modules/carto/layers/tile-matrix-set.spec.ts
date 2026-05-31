// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {
  crs84TileToLngLat,
  normalizeTileMatrixSet,
  resolveTileMatrixSet
} from '@deck.gl/carto/layers/tile-matrix-set';
import {getQuadbinPolygon} from '@deck.gl/carto/layers/quadbin-utils';
import {tileToCell} from 'quadbin';

test('normalizeTileMatrixSet', () => {
  expect(normalizeTileMatrixSet('GoogleCRS84Quad'), 'short name').toBe('GoogleCRS84Quad');
  expect(
    normalizeTileMatrixSet('http://www.opengis.net/def/tilematrixset/OGC/1.0/GoogleCRS84Quad'),
    'canonical URI'
  ).toBe('GoogleCRS84Quad');
  expect(normalizeTileMatrixSet('EPSG:4326'), 'crs code').toBe('GoogleCRS84Quad');
  expect(normalizeTileMatrixSet('WebMercatorQuad'), 'mercator name').toBe('WebMercatorQuad');
  expect(normalizeTileMatrixSet('EPSG:3857'), 'mercator code').toBe('WebMercatorQuad');
  expect(normalizeTileMatrixSet(undefined), 'absent').toBe(null);
  expect(normalizeTileMatrixSet(''), 'empty').toBe(null);
  expect(normalizeTileMatrixSet('SomethingElse'), 'unknown').toBe(null);
});

test('resolveTileMatrixSet precedence', () => {
  // Explicit prop wins
  expect(resolveTileMatrixSet('WebMercatorQuad', 'GoogleCRS84Quad')).toBe('WebMercatorQuad');
  expect(resolveTileMatrixSet('GoogleCRS84Quad', undefined)).toBe('GoogleCRS84Quad');
  // Metadata used when prop absent
  expect(resolveTileMatrixSet(null, 'GoogleCRS84Quad')).toBe('GoogleCRS84Quad');
  expect(resolveTileMatrixSet(undefined, 'EPSG:4326')).toBe('GoogleCRS84Quad');
  // Default when both absent / unrecognized
  expect(resolveTileMatrixSet(null, undefined)).toBe('WebMercatorQuad');
  expect(resolveTileMatrixSet(null, 'nonsense')).toBe('WebMercatorQuad');
});

test('crs84TileToLngLat is linear', () => {
  // Full world at z=0
  expect(crs84TileToLngLat(0, 0, 0), 'NW corner').toEqual([-180, 90]);
  expect(crs84TileToLngLat(1, 1, 0), 'SE corner').toEqual([180, -90]);
  // z=1: 2x2 grid
  expect(crs84TileToLngLat(1, 1, 1), 'center').toEqual([0, 0]);
});

test('getQuadbinPolygon GoogleCRS84Quad vs WebMercatorQuad', () => {
  // Tile x=1, y=2, z=3
  const q = tileToCell({x: 1, y: 2, z: 3});

  // Plate carrée: linear mapping, exact rational bounds.
  // x=1 -> west=-135, east=-90 ; y=2 -> north=45, south=22.5
  const crs84 = getQuadbinPolygon(q, 1, 'GoogleCRS84Quad');
  expect(crs84, 'CRS84 polygon').toEqual([-90, 45, -90, 22.5, -135, 22.5, -135, 45, -90, 45]);

  // Mercator: longitudes identical, latitudes pulled towards the equator (gudermannian).
  const merc = getQuadbinPolygon(q, 1, 'WebMercatorQuad');
  // West/east longitudes match the linear ones.
  expect(merc[0], 'merc east lng').toBeCloseTo(-90, 9);
  expect(merc[4], 'merc west lng').toBeCloseTo(-135, 9);
  // North latitude under Mercator is greater than the linear plate-carrée latitude at this tile.
  expect(merc[1], 'merc north lat differs from linear').not.toBeCloseTo(45, 3);
  expect(merc[1]).toBeGreaterThan(45);

  // Default (no TMS arg) preserves the historical Mercator behavior exactly.
  expect(getQuadbinPolygon(q, 1), 'default == Mercator').toEqual(merc);
});
