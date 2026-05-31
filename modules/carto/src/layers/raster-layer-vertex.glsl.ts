// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export default `\
#version 300 es
#define SHADER_NAME raster-layer-vertex-shader

in vec3 positions;
in vec3 normals;

in float instanceElevations;
in vec4 instanceFillColors;
in vec4 instanceLineColors;

// Result
out vec4 vColor;
#ifdef FLAT_SHADING
out vec4 position_commonspace;
#endif

void main(void) {
  // Rather than positioning using attribute, layout pixel grid using gl_InstanceID
  vec2 tileOrigin = column.offset.xy;
  float scale = column.widthScale; // Re-use widthScale prop to pass cell scale

  int yIndex = - (gl_InstanceID / BLOCK_WIDTH);
  int xIndex = gl_InstanceID + (yIndex * BLOCK_WIDTH);

  // Avoid precision issues by applying 0.5 offset here, rather than when laying out vertices
  vec2 cellCenter = scale * vec2(float(xIndex) + 0.5, float(yIndex) - 0.5);

  // Cell Y extent. Uniform (== scale) for WebMercatorQuad; per-row for GoogleCRS84Quad below.
  float cellSizeY = scale;

#ifdef GOOGLE_CRS84_QUAD
  // GoogleCRS84Quad (plate carrée): pixel rows are uniform in latitude, NOT in Mercator world Y.
  // Reproject each row's latitude band onto Mercator world Y so rows land correctly on a Mercator
  // basemap. column.offset.y already carries the Mercator world Y of the tile's north edge
  // (computed on the CPU in float64), so we only add small, well-conditioned per-row offsets here.
  #define CRS84_PI 3.141592653589793
  #define CRS84_DEG_TO_RAD 0.017453292519943295
  #define CRS84_WORLD_SIZE 512.0
  float row = float(-yIndex); // 0-based pixel row from the tile's north edge
  float latTop = raster.northLat - row * raster.dLat;
  float latBot = latTop - raster.dLat;
  float mercNorth = log(tan(CRS84_PI * 0.25 + raster.northLat * CRS84_DEG_TO_RAD * 0.5));
  float k = CRS84_WORLD_SIZE / (2.0 * CRS84_PI);
  // Mercator world Y relative to the tile's north edge (north-up, negative going south)
  float yTop = k * (log(tan(CRS84_PI * 0.25 + latTop * CRS84_DEG_TO_RAD * 0.5)) - mercNorth);
  float yBot = k * (log(tan(CRS84_PI * 0.25 + latBot * CRS84_DEG_TO_RAD * 0.5)) - mercNorth);
  cellSizeY = yTop - yBot; // row height in Mercator world Y (positive)
  cellCenter = vec2(scale * (float(xIndex) + 0.5), 0.5 * (yTop + yBot));
#endif

  vec4 color = column.isStroke ? instanceLineColors : instanceFillColors;

  // if alpha == 0.0 or z < 0.0, do not render element
  float shouldRender = float(color.a > 0.0 && instanceElevations >= 0.0);
  float cellWidth = column.coverage * scale;

  // Get position directly from quadbin, rather than projecting
  // Important to set geometry.position before using project_ methods below
  // as geometry.worldPosition is not set (we don't know our lat/long)
  geometry.position = vec4(tileOrigin, 0.0, 1.0);
  if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET) {
    geometry.position.xyz -= project.commonOrigin;
  }

  // Important to apply after tileOrigin & commonOrigin as they are large values which often
  // cancel and thus cellCenter precision is lost if applied first.
  geometry.position.xy += cellCenter;

  // calculate elevation, if 3d not enabled set to 0
  // cylindar geometry height are between -1.0 to 1.0, transform it to between 0, 1
  float elevation = 0.0;
  // calculate stroke offset
  float strokeOffsetRatio = 1.0;

  if (column.extruded) {
    elevation = instanceElevations * (positions.z + 1.0) / 2.0 * column.elevationScale;
  } else if (column.stroked) {
    float halfOffset = project_pixel_size(column.widthScale) / cellWidth;
    if (column.isStroke) {
      strokeOffsetRatio -= sign(positions.z) * halfOffset;
    } else {
      strokeOffsetRatio -= halfOffset;
    }
  }

  geometry.pickingColor = picking_getPickingColorFromInstanceID();

  // Cell coordinates centered on origin. Y uses cellSizeY so GoogleCRS84Quad rows tile without
  // gaps after reprojection; for WebMercatorQuad cellSizeY == scale so this is unchanged.
  vec2 base = positions.xy * vec2(scale, cellSizeY) * strokeOffsetRatio * column.coverage * shouldRender;
  vec3 cell = vec3(base, project_size(elevation));
  DECKGL_FILTER_SIZE(cell, geometry);

  geometry.position.xyz += cell;
  gl_Position = project_common_position_to_clipspace(geometry.position);

  geometry.normal = project_normal(normals);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  // Light calculations
  if (column.extruded && !column.isStroke) {
#ifdef FLAT_SHADING
    position_commonspace = geometry.position;
    vColor = vec4(color.rgb, color.a * layer.opacity);
#else
    vec3 lightColor = lighting_getLightColor(color.rgb, project.cameraPosition, geometry.position.xyz, geometry.normal);
    vColor = vec4(lightColor, color.a * layer.opacity);
#endif
  } else {
    vColor = vec4(color.rgb, color.a * layer.opacity);
  }

  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;
