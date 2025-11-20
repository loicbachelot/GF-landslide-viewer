import os
import json
import tempfile
import zipfile
from typing import List, Optional, Tuple, Dict, Any

from dotenv import load_dotenv
load_dotenv(".env.local")

import psycopg2
from psycopg2.extras import DictCursor
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)


# ---- DB helper ----

def get_db_conn():
    """
    Very simple connection helper.
    Expect DATABASE_URL in format:
    postgres://user:pass@host:port/dbname
    """
    dsn = os.getenv("DATABASE_URL")
    print("DATABASE_URL =", dsn)  # debug
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(dsn, cursor_factory=DictCursor)


# ---- Request models ----

class Filters(BaseModel):
    # Categorical filters
    materials: Optional[List[str]] = None
    movements: Optional[List[str]] = None
    confidences: Optional[List[str]] = None

    # Numeric filters
    pga_min: Optional[float] = None
    pga_max: Optional[float] = None
    pgv_min: Optional[float] = None
    pgv_max: Optional[float] = None
    psa03_min: Optional[float] = None
    psa03_max: Optional[float] = None
    mmi_min: Optional[float] = None
    mmi_max: Optional[float] = None
    rain_min: Optional[float] = None
    rain_max: Optional[float] = None

    # Tolerances
    tol_pga: float = 0.0
    tol_pgv: float = 0.0
    tol_psa03: float = 0.0
    tol_mmi: float = 0.0
    tol_rain: float = 0.0

    # Optional selection geometry (GeoJSON, EPSG:4326)
    selection_geojson: Optional[Dict[str, Any]] = None


class DownloadRequest(BaseModel):
    filters: Filters
    compress: Optional[bool] = False


# ---- Internal helpers ----

def _filters_to_dict(filters: Filters) -> Dict[str, Any]:
    """Support both Pydantic v1 and v2 for debug logging."""
    try:
        return filters.dict()
    except AttributeError:
        return filters.model_dump()


def _debug_log_filters(prefix: str, filters: Filters):
    """Uniform debug logging for filters payloads."""
    try:
        filters_dict = _filters_to_dict(filters)
        print(f"=== {prefix} called with filters ===")
        print(json.dumps(filters_dict, indent=2, default=str))
    except Exception as exc:
        print(f"[{prefix}] Failed to log filters: {exc}")


def _build_sql_params(filters: Filters, max_features: Optional[int] = None) -> Dict[str, Any]:
    """
    Map Filters -> SQL parameters used by export_original_from_filters(...)
    """
    materials = filters.materials or []
    movements = filters.movements or []
    confidences = filters.confidences or []

    selection_geojson_str = (
        json.dumps(filters.selection_geojson) if filters.selection_geojson else None
    )

    params: Dict[str, Any] = {
        "materials": materials,
        "movements": movements,
        "confidences": confidences,
        "pga_min": filters.pga_min,
        "pga_max": filters.pga_max,
        "pgv_min": filters.pgv_min,
        "pgv_max": filters.pgv_max,
        "psa03_min": filters.psa03_min,
        "psa03_max": filters.psa03_max,
        "mmi_min": filters.mmi_min,
        "mmi_max": filters.mmi_max,
        "tol_pga": filters.tol_pga,
        "tol_pgv": filters.tol_pgv,
        "tol_psa03": filters.tol_psa03,
        "tol_mmi": filters.tol_mmi,
        "rain_min": filters.rain_min,
        "rain_max": filters.rain_max,
        "tol_rain": filters.tol_rain,
        "selection_geojson": selection_geojson_str,
    }

    if max_features is not None:
        params["max_features"] = max_features

    return params


# ---- Core export function (reusable later in Lambda) ----

def generate_geojson_export(
        filters: Filters,
        compress: bool = False,
        max_features: int = 200_000,
) -> Tuple[str, str]:
    """
    Generate a GeoJSON file (optionally zipped) in a temp directory
    using landslide_v2.export_original_from_filters(...) in Postgres.

    Returns:
      (file_path, download_filename)
    """
    _debug_log_filters("generate_geojson_export", filters)
    print("compress:", compress)
    print("max_features:", max_features)

    params = _build_sql_params(filters, max_features=max_features)

    # --- DEBUG: log params sent to SQL ---
    print("SQL params going to export_original_from_filters:")
    print(json.dumps(params, indent=2, default=str))

    sql = """
        SELECT landslide_v2.export_original_from_filters(
            %(materials)s,
            %(movements)s,
            %(confidences)s,
            %(pga_min)s,
            %(pga_max)s,
            %(pgv_min)s,
            %(pgv_max)s,
            %(psa03_min)s,
            %(psa03_max)s,
            %(mmi_min)s,
            %(mmi_max)s,
            %(tol_pga)s,
            %(tol_pgv)s,
            %(tol_psa03)s,
            %(tol_mmi)s,
            %(rain_min)s,
            %(rain_max)s,
            %(tol_rain)s,
            CASE
                WHEN %(selection_geojson)s IS NULL THEN NULL
                ELSE ST_Transform(
                    ST_SetSRID(
                        ST_GeomFromGeoJSON(%(selection_geojson)s),
                        4326
                    ),
                    3857
                )
            END,
            %(max_features)s
        ) AS feature;
    """

    # Query + stream results to temp GeoJSON file
    with get_db_conn() as conn, conn.cursor() as cur:
        print("Executing export_original_from_filters SQL...")
        cur.execute(sql, params)
        print("SQL executed successfully, streaming results...")

        tmp_dir = tempfile.mkdtemp()
        geojson_path = os.path.join(tmp_dir, "landslides.geojson")

        feature_count = 0
        with open(geojson_path, "w", encoding="utf-8") as f:
            f.write('{"type":"FeatureCollection","features":[')
            first = True
            for (feature,) in cur:
                feature_count += 1

                if not first:
                    f.write(",")
                else:
                    first = False

                json.dump(feature, f)

            f.write("]}")

    print(f"generate_geojson_export complete. feature_count={feature_count}")
    print(f"GeoJSON path: {geojson_path}")
    print("======================================")

    if not compress:
        return geojson_path, "landslides.geojson"

    zip_path = os.path.join(tmp_dir, "landslides.geojson.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(geojson_path, arcname="landslides.geojson")

    print(f"Zipped file path: {zip_path}")
    return zip_path, "landslides.geojson.zip"


# ---- FastAPI endpoints ----

@app.post("/download")
def download(req: DownloadRequest):
    try:
        file_path, filename = generate_geojson_export(
            filters=req.filters,
            compress=req.compress or False,
        )
    except psycopg2.Error as e:
        # e.g. DB-side "Too many features" exception, or others
        msg = str(e)
        raise HTTPException(status_code=400, detail=f"Database error: {msg}")
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Log in real app
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")

    # For local testing we just return the file directly.
    # In Lambda later, this is the part we replace with:
    #   - upload to S3
    #   - generate presigned URL
    #   - return JSON { url: ... }
    return FileResponse(
        file_path,
        media_type="application/zip" if filename.endswith(".zip") else "application/geo+json",
        filename=filename,
    )


@app.post("/count")
def count_landslides(filters: Filters):
    """
    Return how many features match the given filters,
    using the same landslide_v2.export_original_from_filters(...) function
    that the /download endpoint uses.
    """
    _debug_log_filters("/count", filters)

    # For counting, you may want a "large enough" cap; keep in sync with /download.
    params = _build_sql_params(filters, max_features=200_000)

    sql = """
          SELECT COUNT(*) AS count
          FROM landslide_v2.export_original_from_filters(
              %(materials)s,
              %(movements)s,
              %(confidences)s,
              %(pga_min)s,
              %(pga_max)s,
              %(pgv_min)s,
              %(pgv_max)s,
              %(psa03_min)s,
              %(psa03_max)s,
              %(mmi_min)s,
              %(mmi_max)s,
              %(tol_pga)s,
              %(tol_pgv)s,
              %(tol_psa03)s,
              %(tol_mmi)s,
              %(rain_min)s,
              %(rain_max)s,
              %(tol_rain)s,
              CASE
              WHEN %(selection_geojson)s IS NULL THEN NULL
              ELSE ST_Transform(
              ST_SetSRID(
              ST_GeomFromGeoJSON(%(selection_geojson)s),
              4326
              ),
              3857
              )
              END,
              %(max_features)s
              ); \
          """

    try:
        with get_db_conn() as conn, conn.cursor() as cur:
            print("Executing COUNT(*) via export_original_from_filters...")
            cur.execute(sql, params)
            row = cur.fetchone()

        count = row["count"]
        print(f"/count result: {count}")
        return {"count": count}

    except psycopg2.Error as e:
        raise HTTPException(status_code=400, detail=f"Database error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Count failed: {e}")
