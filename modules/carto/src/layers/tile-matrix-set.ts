// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Tile Matrix Set (TMS) supported by the CARTO quadbin layers.
 *
 * A quadbin cell is a pure quadkey `(z, x, y)` packed into 64 bits and carries no CRS of its
 * own. The TMS is the discriminator that says how a cell maps to lng/lat:
 *
 *  - `WebMercatorQuad`  (EPSG:3857) — the historical default. Latitude is mapped through the
 *    Mercator (gudermannian) projection. Square 2^z grid clamped at ±85.05°.
 *  - `GoogleCRS84Quad`  (OGC:1.3:CRS84, single 1×1 root) — plate carrée. Latitude is mapped
 *    **linearly**. Square 2^z grid covering the full -180..180 / -90..90 world (2:1 anisotropic
 *    pixels). Bit-for-bit compatible with the quadbin cell encoding.
 *
 * See `cartolibs/duckdb-raquet/.claude/plans/plan-crs-tms-extension.md` for the full contract.
 */
export type TileMatrixSet = 'WebMercatorQuad' | 'GoogleCRS84Quad';

/** Default TMS when none is declared — back-compat with all existing (Web Mercator) data. */
export const DEFAULT_TILE_MATRIX_SET: TileMatrixSet = 'WebMercatorQuad';

/**
 * Normalize a TMS identifier coming from tileset/source metadata into one of the supported
 * {@link TileMatrixSet} values. Accepts either the short OGC name (`GoogleCRS84Quad`) or the
 * canonical URI (`http://www.opengis.net/def/tilematrixset/OGC/1.0/GoogleCRS84Quad`). The short
 * name is ambiguous across spec versions, so matching is done loosely on the CRS family.
 *
 * Returns `null` when the value is absent or unrecognized, so callers can fall back to a default.
 */
export function normalizeTileMatrixSet(value: unknown): TileMatrixSet | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/GoogleCRS84Quad/i.test(value) || /CRS84/i.test(value) || /\b4326\b/.test(value)) {
    return 'GoogleCRS84Quad';
  }
  if (
    /WebMercatorQuad/i.test(value) ||
    /GoogleMapsCompatible/i.test(value) ||
    /\b3857\b/.test(value)
  ) {
    return 'WebMercatorQuad';
  }
  return null;
}

/**
 * Resolve the effective TMS for a layer. Precedence: an explicit `tileMatrixSet` prop wins, then
 * the value declared in metadata, then the default ({@link DEFAULT_TILE_MATRIX_SET}).
 */
export function resolveTileMatrixSet(
  prop: TileMatrixSet | null | undefined,
  metadataValue?: unknown
): TileMatrixSet {
  return prop ?? normalizeTileMatrixSet(metadataValue) ?? DEFAULT_TILE_MATRIX_SET;
}

/**
 * GoogleCRS84Quad (plate carrée) tile corner → lng/lat. The grid is a square `2^z × 2^z` grid of
 * tiles over the full world, so the mapping is linear in both axes. `x`/`y` may be fractional to
 * address a sub-tile corner (used to compute cell footprints with coverage < 1).
 */
export function crs84TileToLngLat(x: number, y: number, z: number): [number, number] {
  const scale = 2 ** z;
  const lng = (x / scale) * 360 - 180;
  const lat = 90 - (y / scale) * 180;
  return [lng, lat];
}
