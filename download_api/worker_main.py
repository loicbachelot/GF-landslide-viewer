import os
import json
import tempfile
import zipfile
import time
from typing import Dict, Any, Optional, Tuple, List
from uuid import uuid4

import pg8000
from pg8000.dbapi import DatabaseError

import boto3
from botocore.exceptions import ClientError


# ---------- Globals ----------

dynamodb = boto3.resource("dynamodb")
JOBS_TABLE_NAME = os.getenv("JOBS_TABLE_NAME")
if not JOBS_TABLE_NAME:
    raise RuntimeError("JOBS_TABLE_NAME env var is required for worker")

jobs_table = dynamodb.Table(JOBS_TABLE_NAME)


# ---------- DB helpers (Lambda only, no Pydantic) ----------

def _get_db_credentials_from_env() -> Dict[str, Any]:
    """
    Resolve DB connection params from env and Secrets Manager.

    Env vars:
      PGHOST, PGDATABASE, PGUSER, optional PGPASSWORD or DB_SECRET_ARN
    """
    host = os.getenv("PGHOST")
    database = os.getenv("PGDATABASE")
    user = os.getenv("PGUSER")

    if not (host and database and user):
        raise RuntimeError("Missing PGHOST / PGDATABASE / PGUSER env vars.")

    password = os.getenv("PGPASSWORD")
    if not password:
        secret_arn = os.getenv("DB_SECRET_ARN")
        if not secret_arn:
            raise RuntimeError("Neither PGPASSWORD nor DB_SECRET_ARN is set.")
        sm = boto3.client("secretsmanager")
        try:
            resp = sm.get_secret_value(SecretId=secret_arn)
            secret_str = resp.get("SecretString")
            secret_dict = json.loads(secret_str)
            password = secret_dict.get("password")
        except ClientError as e:
            raise RuntimeError(f"Failed to fetch DB secret: {e}")

    port = int(os.getenv("PGPORT", "5432"))
    return {
        "host": host,
        "database": database,
        "user": user,
        "password": password,
        "port": port,
    }


def get_db_conn():
    creds = _get_db_credentials_from_env()
    print(
        "Connecting to Postgres:",
        f"{creds['user']}@{creds['host']}:{creds['port']}/{creds['database']}",
    )
    return pg8000.connect(
        host=creds["host"],
        database=creds["database"],
        user=creds["user"],
        password=creds["password"],
        port=creds["port"],
    )


# ---------- Filters / params helpers (dict-based) ----------

def _normalize_filters(filters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Take a raw filters dict and normalize keys / defaults.
    This replaces the Pydantic Filters model in Lambda.
    """
    f = filters or {}

    def get_list(key: str) -> List[str]:
        val = f.get(key)
        if val is None:
            return []
        if isinstance(val, list):
            return val
        return [val]

    def get_float(key: str) -> Optional[float]:
        val = f.get(key)
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    def get_float_default(key: str, default: float = 0.0) -> float:
        val = f.get(key)
        if val is None:
            return default
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    return {
        "materials": get_list("materials"),
        "movements": get_list("movements"),
        "confidences": get_list("confidences"),
        "pga_min": get_float("pga_min"),
        "pga_max": get_float("pga_max"),
        "pgv_min": get_float("pgv_min"),
        "pgv_max": get_float("pgv_max"),
        "psa03_min": get_float("psa03_min"),
        "psa03_max": get_float("psa03_max"),
        "mmi_min": get_float("mmi_min"),
        "mmi_max": get_float("mmi_max"),
        "rain_min": get_float("rain_min"),
        "rain_max": get_float("rain_max"),
        "tol_pga": get_float_default("tol_pga", 0.0),
        "tol_pgv": get_float_default("tol_pgv", 0.0),
        "tol_psa03": get_float_default("tol_psa03", 0.0),
        "tol_mmi": get_float_default("tol_mmi", 0.0),
        "tol_rain": get_float_default("tol_rain", 0.0),
        "selection_geojson": f.get("selection_geojson"),
    }


def _build_sql_params(filters: Dict[str, Any], max_features: Optional[int] = None) -> Dict[str, Any]:
    """
    Map normalized filters dict -> SQL params for export_original_from_filters.
    """
    selection_geojson = filters.get("selection_geojson")
    selection_geojson_str = json.dumps(selection_geojson) if selection_geojson else None

    params: Dict[str, Any] = {
        "materials": filters["materials"],
        "movements": filters["movements"],
        "confidences": filters["confidences"],
        "pga_min": filters["pga_min"],
        "pga_max": filters["pga_max"],
        "pgv_min": filters["pgv_min"],
        "pgv_max": filters["pgv_max"],
        "psa03_min": filters["psa03_min"],
        "psa03_max": filters["psa03_max"],
        "mmi_min": filters["mmi_min"],
        "mmi_max": filters["mmi_max"],
        "tol_pga": filters["tol_pga"],
        "tol_pgv": filters["tol_pgv"],
        "tol_psa03": filters["tol_psa03"],
        "tol_mmi": filters["tol_mmi"],
        "rain_min": filters["rain_min"],
        "rain_max": filters["rain_max"],
        "tol_rain": filters["tol_rain"],
        "selection_geojson": selection_geojson_str,
    }

    if max_features is not None:
        params["max_features"] = max_features

    return params


# ---------- Core DB logic ----------

def count_matching_filters(filters_dict: Dict[str, Any], max_features: int = 200_000) -> int:
    filters = _normalize_filters(filters_dict)
    params = _build_sql_params(filters, max_features=max_features)

    print("=== count_matching_filters params ===")
    print(json.dumps(params, indent=2, default=str))

    sql = """
          SELECT COUNT(*) AS count
          FROM landslide_v2.lsviewer_filtered_ids(
              %s, -- materials
              %s, -- movements
              %s, -- confidences
              %s, -- pga_min
              %s, -- pga_max
              %s, -- pgv_min
              %s, -- pgv_max
              %s, -- psa03_min
              %s, -- psa03_max
              %s, -- mmi_min
              %s, -- mmi_max
              %s, -- tol_pga
              %s, -- tol_pgv
              %s, -- tol_psa03
              %s, -- tol_mmi
              %s, -- rain_min
              %s, -- rain_max
              %s, -- tol_rain
              CASE
                WHEN %s::text IS NULL THEN NULL ::geometry
                ELSE ST_Transform(
                    ST_SetSRID(
                        ST_GeomFromGeoJSON(%s::text), 
                        4326
                    ), 
                    3857
                )
              END
          );
        """

    selection_str = params["selection_geojson"]
    args = (
        params["materials"],
        params["movements"],
        params["confidences"],
        params["pga_min"],
        params["pga_max"],
        params["pgv_min"],
        params["pgv_max"],
        params["psa03_min"],
        params["psa03_max"],
        params["mmi_min"],
        params["mmi_max"],
        params["tol_pga"],
        params["tol_pgv"],
        params["tol_psa03"],
        params["tol_mmi"],
        params["rain_min"],
        params["rain_max"],
        params["tol_rain"],
        selection_str,   # %s::text in WHEN
        selection_str,   # %s::text in ST_GeomFromGeoJSON
    )

    with get_db_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, args)
        row = cur.fetchone()

    count = row[0]
    print(f"count_matching_filters result: {count}")
    return count


def generate_geojson_export(
    filters_dict: Dict[str, Any],
    compress: bool = False,
    max_features: int = 200_000,
) -> Tuple[str, str]:
    filters = _normalize_filters(filters_dict)
    params = _build_sql_params(filters, max_features=max_features)

    print("=== generate_geojson_export params ===")
    print(json.dumps(params, indent=2, default=str))

    sql = """
        SELECT landslide_v2.export_original_from_filters(
            %s,  -- materials
            %s,  -- movements
            %s,  -- confidences
            %s,  -- pga_min
            %s,  -- pga_max
            %s,  -- pgv_min
            %s,  -- pgv_max
            %s,  -- psa03_min
            %s,  -- psa03_max
            %s,  -- mmi_min
            %s,  -- mmi_max
            %s,  -- tol_pga
            %s,  -- tol_pgv
            %s,  -- tol_psa03
            %s,  -- tol_mmi
            %s,  -- rain_min
            %s,  -- rain_max
            %s,  -- tol_rain
            CASE
                WHEN %s::text IS NULL THEN NULL::geometry
                ELSE ST_Transform(
                    ST_SetSRID(
                        ST_GeomFromGeoJSON(%s::text),
                        4326
                    ),
                    3857
                )
            END,
            %s   -- max_features
        ) AS feature;
    """

    selection_str = params["selection_geojson"]
    args = (
        params["materials"],
        params["movements"],
        params["confidences"],
        params["pga_min"],
        params["pga_max"],
        params["pgv_min"],
        params["pgv_max"],
        params["psa03_min"],
        params["psa03_max"],
        params["mmi_min"],
        params["mmi_max"],
        params["tol_pga"],
        params["tol_pgv"],
        params["tol_psa03"],
        params["tol_mmi"],
        params["rain_min"],
        params["rain_max"],
        params["tol_rain"],
        selection_str,   # %s::text in WHEN
        selection_str,   # %s::text in ST_GeomFromGeoJSON
        params["max_features"],
    )

    with get_db_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, args)

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

    if not compress:
        return geojson_path, "landslides.geojson"

    zip_path = os.path.join(tmp_dir, "landslides.geojson.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(geojson_path, arcname="landslides.geojson")

    print(f"Zipped file path: {zip_path}")
    return zip_path, "landslides.geojson.zip"


# ---------- S3 helper ----------

def upload_to_s3_and_presign(local_path: str, filename: str) -> Dict[str, str]:
    """
    Upload the file to S3 under exports/... and return:
      - presigned_url: direct S3 URL (for dev / fallback)
      - key: S3 object key (exports/...)
      - cf_path: path to use behind CloudFront ("/exports/...")
    """
    bucket = os.getenv("EXPORT_BUCKET")
    if not bucket:
        raise RuntimeError("EXPORT_BUCKET env var is not set")

    s3 = boto3.client("s3")
    key = f"exports/{uuid4()}/{filename}"

    print(f"Uploading {local_path} to s3://{bucket}/{key}")
    s3.upload_file(local_path, bucket, key)

    presigned_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=3600,
    )
    print(f"Presigned S3 URL: {presigned_url}")

    cf_path = f"/{key}"  # CloudFront behavior matches /exports/*

    return {
        "presigned_url": presigned_url,
        "key": key,
        "cf_path": cf_path,
    }


# ---------- Worker helpers ----------

def _update_job(job_id: str, **fields):
    """
    Update one or more attributes on a job item in DynamoDB.

    Example:
        _update_job(job_id, status="RUNNING")
        _update_job(job_id, status="DONE", result={"count": 123})
    """
    if not fields:
        return

    print(f"Updating job {job_id} with: {fields}")

    # Build a safe UpdateExpression that never uses raw attribute names,
    # so we don't hit reserved-word issues like 'status'.
    expr_names = {}
    expr_values = {}
    update_parts = []

    for i, (attr, value) in enumerate(fields.items()):
        name_placeholder = f"#f{i}"
        value_placeholder = f":v{i}"

        expr_names[name_placeholder] = attr
        expr_values[value_placeholder] = value
        update_parts.append(f"{name_placeholder} = {value_placeholder}")

    update_expr = "SET " + ", ".join(update_parts)

    jobs_table.update_item(
        Key={"jobId": job_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


# ---------- Lambda handler (SQS events) ----------

def lambda_handler(event, context):
    """
    Worker Lambda, triggered by SQS.
    Each record body is a JSON object with:
      { "jobId": "...", "jobType": "count" | "download" }
    """
    print("Worker event:", json.dumps(event))

    for record in event.get("Records", []):
        try:
            body = json.loads(record["body"])
        except Exception as e:
            print("Failed to parse SQS body:", record.get("body"), "error:", repr(e))
            # Skip bad message, do not rethrow
            continue

        job_id = body.get("jobId")
        job_type = body.get("jobType")

        print(f"Processing jobId={job_id}, jobType={job_type}")

        if not job_id or not job_type:
            print("Missing jobId or jobType in SQS message, skipping.")
            continue

        # Fetch job from DynamoDB
        resp = jobs_table.get_item(Key={"jobId": job_id})
        job = resp.get("Item")
        if not job:
            print(f"Job {job_id} not found in DynamoDB, skipping.")
            continue

        filters = job.get("filters") or {}
        # filters stored as JSON string or dict
        if isinstance(filters, str):
            try:
                filters = json.loads(filters)
            except Exception:
                print("Failed to decode filters JSON; using empty dict")
                filters = {}

        compress = bool(job.get("compress", False))

        try:
            _update_job(job_id, status="RUNNING")

            if job_type == "count":
                count = count_matching_filters(filters)
                _update_job(
                    job_id,
                    status="DONE",
                    result={"count": int(count)},
                )

            elif job_type == "download":
                file_path, filename = generate_geojson_export(
                    filters, compress=compress
                )
                upload_info = upload_to_s3_and_presign(file_path, filename)

                _update_job(
                    job_id,
                    status="DONE",
                    result={
                        "filename": filename,
                        "url": upload_info["presigned_url"],
                        "cf_path": upload_info["cf_path"],
                        "key": upload_info["key"],
                    },
                )

            else:
                print(f"Unknown jobType={job_type}, marking ERROR.")
                _update_job(
                    job_id,
                    status="ERROR",
                    error=f"Unknown jobType {job_type}",
                )

        except DatabaseError as e:
            print(f"DatabaseError for job {job_id}: {e}")
            _update_job(job_id, status="ERROR", error=f"Database error: {str(e)}")
        except Exception as e:
            print(f"Unhandled error for job {job_id}: {repr(e)}")
            _update_job(job_id, status="ERROR", error=f"Internal error: {str(e)}")

    # Let Lambda succeed (no rethrow) so SQS doesn't retry failed jobs indefinitely
    return {"ok": True}