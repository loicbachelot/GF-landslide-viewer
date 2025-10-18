# CPAL Landslide Viewer

MapLibre + Martin + PostGIS viewer for landslide inventories with **dynamic clustering** and **attribute filtering**.

---

## Quick Start

### 1. Run PostGIS + Martin

```bash
docker run --name postgis -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=gis -p 5432:5432 -d postgis/postgis:15-3.4
```

For Martin server, use directly the docker compose in /martin-server


---

### 2. Load data

```bash
ogr2ogr -f PostgreSQL "PG:host=localhost dbname=gis user=postgres password=pass"   /path/to/landslides_points.gpkg -nln landslides.ls_points -nlt POINT -overwrite
ogr2ogr -f PostgreSQL "PG:host=localhost dbname=gis user=postgres password=pass"   /path/to/landslides_polygons.gpkg -nln landslides.ls_polygons -nlt MULTIPOLYGON -overwrite
```

---

### 3. Run Viewer

Serve `/public/index.html` locally:

```bash
npx serve public
```

Open [http://localhost:3000](http://localhost:3000)

---

## Key Features

- Vector tiles via Martin
- Zoom-based clustering 
- Attribute filters (sliders, toggles)
- Smooth MapLibre layers (clusters → raw points → polygons)

---

## Troubleshooting

**Cache stuck?** Add `?ts=timestamp` to the tile URL or disable caching.

**Cluster jump too harsh?** Adjust tunables in SQL: `ppc_max`, `ppc_min`, `z_raw_points`.

**Filter crash?** Ensure `LandslideFilterConfig` is imported before `applyLandslideFilters()`.

---

## License

MIT — part of the **landslide_viewer** project (GF / CascadiaQuakes).
