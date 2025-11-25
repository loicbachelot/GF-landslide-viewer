import os
import json
import tempfile
import zipfile
from typing import List, Optional, Tuple, Dict, Any
from uuid import uuid4

from dotenv import load_dotenv
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env.local")

import psycopg2
from psycopg2.extras import DictCursor
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import boto3
from botocore.exceptions import ClientError

# ---------- FastAPI app (local dev) ----------

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


# ---------- DB helper ----------

def _get_db_dsn_from_env() -> str:
    """
    Build a PostgreSQL DSN from env.

    Priority:
      1. DATABASE_URL (local dev)
      2. PGHOST + PGDATABASE + PGUSER + password via:
           - PGPASSWORD env, or
           - DB_SECRET_ARN (Secrets Manager JSON with 'password')
    """
    dsn = os.getenv("DATABASE_URL")
    print(dsn)
    if dsn:
        return dsn

    host = os.getenv("PGHOST")
    database = os.getenv("PGDATABASE")
    user = os.getenv("PGUSER")

    if not (host and database and user):
        raise RuntimeError(
            "Missing PGHOST / PGDATABASE / PGUSER env vars and no DATABASE_URL set."
        )

    password = os.getenv("PGPASSWORD")
    if not password:
        secret_arn = os.getenv("DB_SECRET_ARN")
        if not secret_arn:
            raise RuntimeError("Neither PGPASSWORD nor DB_SECRET_ARN is set.")
        # Fetch password from Secrets Manager
        sm = boto3.client("secretsmanager")
        try:
            resp = sm.get_secret_value(SecretId=secret_arn)
            secret_str = resp.get("SecretString")
            secret_dict = json.loads(secret_str)
            password = secret_dict.get("password")
        except ClientError as e:
            raise RuntimeError(f"Failed to fetch DB secret: {e}")

    # default port 5432
    port = os.getenv("PGPORT", "5432")

    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def get_db_conn():
    """
    Very simple connection helper.
    """
    dsn = _get_db_dsn_from_env()
    print("Using DSN:", dsn.replace(password="***") if "password=" in dsn else dsn)
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

class CountRequest(BaseModel):
    filters: Filters



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


# ---- Core DB logic ----

def count_matching_filters(filters: Filters, max_features: int = 200_000) -> int:
    _debug_log_filters("count_matching_filters", filters)
    params = _build_sql_params(filters, max_features=max_features)

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
          );
    """

    with get_db_conn() as conn, conn.cursor() as cur:
        print("Executing COUNT(*) via export_original_from_filters...")
        cur.execute(sql, params)
        row = cur.fetchone()

    count = row["count"]
    print(f"count_matching_filters result: {count}")
    return count


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


# ---- S3 helper for Lambda ----

def upload_to_s3_and_presign(local_path: str, filename: str) -> str:
    bucket = os.getenv("EXPORT_BUCKET")
    if not bucket:
        raise RuntimeError("EXPORT_BUCKET env var is not set")

    s3 = boto3.client("s3")
    key = f"exports/{uuid4()}/{filename}"

    print(f"Uploading {local_path} to s3://{bucket}/{key}")
    s3.upload_file(local_path, bucket, key)

    # Presigned URL for download
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=3600,  # 1 hour
    )
    print(f"Presigned URL: {url}")
    return url


# ---- FastAPI endpoints (local dev only) ----

@app.post("/download")
def download(req: DownloadRequest):
    try:
        file_path, filename = generate_geojson_export(
            filters=req.filters,
            compress=req.compress or False,
        )
    except psycopg2.Error as e:
        msg = str(e)
        raise HTTPException(status_code=400, detail=f"Database error: {msg}")
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")

    return FileResponse(
        file_path,
        media_type="application/zip" if filename.endswith(".zip") else "application/geo+json",
        filename=filename,
    )


@app.post("/count")
def count_landslides(req: CountRequest):
    try:
        filters = req.filters
        count = count_matching_filters(filters)
        return {"count": count}
    except psycopg2.Error as e:
        raise HTTPException(status_code=400, detail=f"Database error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Count failed: {e}")


# ---- Lambda handler (for API Gateway) ----

ALLOWED_CORS_ORIGINS = set(origins)  # reuse same allowed origins


def _lambda_response(status_code: int, body: Dict[str, Any], origin: Optional[str] = "*"):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin or "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
    }
    return {
        "statusCode": status_code,
        "headers": headers,
        "isBase64Encoded": False,
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    """
    Single Lambda entrypoint for both /api/count and /api/download.

    API Gateway (REST) + Lambda proxy integration will send events like:
      - event["path"] -> "/api/count" or "/api/download"
      - event["body"] -> JSON string
    """

    print("Lambda event:", json.dumps(event))

    path = event.get("path", "")
    try:
        raw_body = event.get("body") or "{}"
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return _lambda_response(400, {"error": "Invalid JSON in request body"})

    # CORS: mirror origin if in allowed list, otherwise "*"
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    cors_origin = origin if origin in ALLOWED_CORS_ORIGINS else "*"

    try:
        if path.endswith("/count"):
            # Allow either {filters: {...}} or {...} directly
            if "filters" in body:
                filters = Filters(**body["filters"])
            else:
                filters = Filters(**body)

            count = count_matching_filters(filters)
            return _lambda_response(200, {"count": count}, cors_origin)

        elif path.endswith("/download"):
            # Expect {filters: {...}, compress: bool}
            req = DownloadRequest(**body)
            file_path, filename = generate_geojson_export(
                filters=req.filters,
                compress=req.compress or False,
            )
            url = upload_to_s3_and_presign(file_path, filename)
            return _lambda_response(
                200,
                {"url": url, "filename": filename},
                cors_origin,
            )

        else:
            return _lambda_response(404, {"error": f"Unknown path {path}"}, cors_origin)

    except psycopg2.Error as e:
        return _lambda_response(400, {"error": f"Database error: {e}"}, cors_origin)
    except RuntimeError as e:
        return _lambda_response(400, {"error": str(e)}, cors_origin)
    except Exception as e:
        # Don't leak full trace in prod, but log it
        print("Unhandled error:", repr(e))
        return _lambda_response(500, {"error": f"Internal server error: {e}"}, cors_origin)
