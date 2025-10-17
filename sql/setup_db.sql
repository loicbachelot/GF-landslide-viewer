-- 00: extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 01: materialized views in 3857 + indexes
DROP MATERIALIZED VIEW IF EXISTS landslides.ls_points_merc;
CREATE MATERIALIZED VIEW landslides.ls_points_merc AS
SELECT ST_Transform(geom, 3857) AS g3857
FROM landslides.ls_points;
CREATE INDEX IF NOT EXISTS ls_points_merc_gix
    ON landslides.ls_points_merc USING GIST (g3857);

DROP MATERIALIZED VIEW IF EXISTS landslides.ls_polygons_merc;
CREATE MATERIALIZED VIEW landslides.ls_polygons_merc AS
SELECT ST_Transform(geom, 3857) AS g3857
FROM landslides.ls_polygons;
CREATE INDEX IF NOT EXISTS ls_polygons_merc_gix
    ON landslides.ls_polygons_merc USING GIST (g3857);

-- 02: refresh helper
CREATE OR REPLACE FUNCTION landslides.refresh_merc_views() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY landslides.ls_points_merc;
EXCEPTION WHEN feature_not_supported THEN
    REFRESH MATERIALIZED VIEW landslides.ls_points_merc;
END;
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY landslides.ls_polygons_merc;
EXCEPTION WHEN feature_not_supported THEN
    REFRESH MATERIALIZED VIEW landslides.ls_polygons_merc;
END;
  ANALYZE landslides.ls_points_merc;
  ANALYZE landslides.ls_polygons_merc;
END $$;

-- 10: points clustering function
DROP FUNCTION IF EXISTS landslides.ls_points_cluster_mvt(integer, integer, integer);
CREATE OR REPLACE FUNCTION landslides.ls_points_cluster_mvt(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
WITH
params AS (SELECT 8::int AS cells_across),
tile AS (SELECT ST_TileEnvelope(z, x, y) AS env_3857),
const AS (SELECT 40075016.6856::double precision AS world_m),
tile_metrics AS (SELECT (SELECT world_m FROM const) / (2^z) AS tile_w_m),
grid AS (SELECT (SELECT tile_w_m FROM tile_metrics) / (SELECT cells_across FROM params) AS cell_m),
pts AS (
  SELECT p.g3857 AS g
  FROM landslides.ls_points_merc p, tile
  WHERE p.g && (SELECT env_3857 FROM tile)
),
binned AS (
  SELECT ST_SnapToGrid(g, (SELECT cell_m FROM grid), (SELECT cell_m FROM grid)) AS cell_key, g
  FROM pts
),
agg AS (
  SELECT cell_key, ST_Centroid(ST_Collect(g)) AS geom_3857, COUNT(*)::int AS point_count
  FROM binned GROUP BY cell_key
),
mvt AS (
  SELECT ST_AsMVTGeom(geom_3857, (SELECT env_3857 FROM tile), 4096, 32, true) AS geom, point_count
  FROM agg WHERE geom_3857 IS NOT NULL
)
SELECT ST_AsMVT(m, 'ls_points_cluster', 4096, 'geom') FROM mvt m;
$$;

-- 11: polygons clustering function
DROP FUNCTION IF EXISTS landslides.ls_polygons_cluster_dynamic_mvt(integer, integer, integer);
CREATE OR REPLACE FUNCTION landslides.ls_polygons_cluster_dynamic_mvt(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
WITH
params AS (SELECT 8::int AS cells_across),
tile AS (SELECT ST_TileEnvelope(z, x, y) AS env_3857),
const AS (SELECT 40075016.6856::double precision AS world_m),
tile_metrics AS (SELECT (SELECT world_m FROM const) / (2^z) AS tile_w_m),
grid AS (SELECT (SELECT tile_w_m FROM tile_metrics) / (SELECT cells_across FROM params) AS cell_m),
polys AS (
  SELECT p.g3857 FROM landslides.ls_polygons_merc p, tile
  WHERE p.g3857 && (SELECT env_3857 FROM tile)
),
centroids AS (SELECT ST_Centroid(g3857) AS c FROM polys),
binned AS (
  SELECT ST_SnapToGrid(c, (SELECT cell_m FROM grid), (SELECT cell_m FROM grid)) AS cell_key, c
  FROM centroids
),
agg AS (
  SELECT cell_key, ST_Centroid(ST_Collect(c)) AS geom_3857, COUNT(*)::int AS poly_count
  FROM binned GROUP BY cell_key
),
mvt AS (
  SELECT ST_AsMVTGeom(geom_3857, (SELECT env_3857 FROM tile), 4096, 32, true) AS geom, poly_count
  FROM agg WHERE geom_3857 IS NOT NULL
)
SELECT ST_AsMVT(m, 'ls_polygons_cluster', 4096, 'geom') FROM mvt m;
$$;

-- metadata comments (optional)
COMMENT ON FUNCTION landslides.ls_points_cluster_mvt(integer,integer,integer) IS
'{"description":"Point clustering via fixed 8×8 tile grid (3857 MV)","vector_layers":[{"id":"ls_points_cluster","fields":{"point_count":"Number"}}]}';

COMMENT ON FUNCTION landslides.ls_polygons_cluster_dynamic_mvt(integer,integer,integer) IS
'{"description":"Polygon centroid clustering via fixed 8×8 tile grid (3857 MV)","vector_layers":[{"id":"ls_polygons_cluster","fields":{"poly_count":"Number"}}]}';
