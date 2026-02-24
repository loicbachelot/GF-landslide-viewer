import os
import json
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import ClientError
import pg8000


ALLOWED_CORS_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # add CloudFront URL here if you want to restrict later
}

def _lambda_response(status_code: int, body: Dict[str, Any], origin: Optional[str] = "*"):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin or "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,GET",
    }
    return {
        "statusCode": status_code,
        "headers": headers,
        "isBase64Encoded": False,
        "body": json.dumps(body, default=str),
    }

def _parse_bool(v) -> bool:
    if v is None:
        return False
    return str(v).strip().lower() in ("1", "true", "t", "yes", "y", "on")

def _get_db_credentials_from_env() -> Dict[str, Any]:
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
            secret_dict = json.loads(resp.get("SecretString") or "{}")
            password = secret_dict.get("password")
        except ClientError as e:
            raise RuntimeError(f"Failed to fetch DB secret: {e}")

    port = int(os.getenv("PGPORT", "5432"))
    return {"host": host, "database": database, "user": user, "password": password, "port": port}

def get_db_conn():
    c = _get_db_credentials_from_env()
    return pg8000.connect(
        host=c["host"], database=c["database"], user=c["user"], password=c["password"], port=c["port"]
    )

def lambda_handler(event, context):
    path = event.get("path", "") or ""
    method = event.get("httpMethod", "GET")

    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    cors_origin = origin if origin in ALLOWED_CORS_ORIGINS else "*"

    if method == "OPTIONS":
        return _lambda_response(200, {"ok": True}, cors_origin)

    if method != "GET":
        return _lambda_response(405, {"error": "Method not allowed"}, cors_origin)

    # Query params
    query = event.get("queryStringParameters") or {}
    source = (query.get("source") or "").strip()
    viewer_id = (query.get("viewer_id") or "").strip()
    include_geom = _parse_bool(query.get("include_geom"))

    if not source or not viewer_id:
        return _lambda_response(400, {"error": "Missing required params: source, viewer_id"}, cors_origin)

    sql = "SELECT landslide_v2.get_landslide_props(%s, %s, %s);"

    try:
        with get_db_conn() as conn, conn.cursor() as cur:
            cur.execute(sql, (source, viewer_id, include_geom))
            row = cur.fetchone()
            payload = row[0] if row else None

        if not payload:
            return _lambda_response(404, {"found": False, "source": source, "viewer_id": viewer_id}, cors_origin)

        return _lambda_response(200, payload, cors_origin)

    except Exception as e:
        print("Details Lambda error:", repr(e))
        return _lambda_response(500, {"error": "Internal error"}, cors_origin)
