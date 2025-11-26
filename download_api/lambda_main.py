import os
import json
import time
from uuid import uuid4
from typing import Any, Dict, Optional

import boto3
from decimal import Decimal


# ---------- Globals ----------

ALLOWED_CORS_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # add your CloudFront URL here if you want to restrict:
    # "https://d29ujemz317kys.cloudfront.net",
}

dynamodb = boto3.resource("dynamodb")
sqs = boto3.client("sqs")

JOBS_TABLE_NAME = os.getenv("JOBS_TABLE_NAME")
JOBS_QUEUE_URL = os.getenv("JOBS_QUEUE_URL")

if not JOBS_TABLE_NAME:
    raise RuntimeError("JOBS_TABLE_NAME env var is required for API Lambda")
if not JOBS_QUEUE_URL:
    raise RuntimeError("JOBS_QUEUE_URL env var is required for API Lambda")

jobs_table = dynamodb.Table(JOBS_TABLE_NAME)


# ---------- Helpers ----------

def _lambda_response(
    status_code: int,
    body: Dict[str, Any],
    origin: Optional[str] = "*",
):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin or "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    }
    return {
        "statusCode": status_code,
        "headers": headers,
        "isBase64Encoded": False,
        "body": json.dumps(body, default=_json_default),
    }


def _json_default(obj):
    if isinstance(obj, Decimal):
        # Try to convert to int if possible, otherwise float
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    return str(obj)


def _create_job(job_type: str, filters: Dict[str, Any], compress: bool) -> str:
    job_id = str(uuid4())
    now = int(time.time())

    # Store filters as JSON string to avoid Dynamo float issues
    filters_json = json.dumps(filters)

    item = {
        "jobId": job_id,
        "jobType": job_type,
        "status": "QUEUED",
        "filters": filters_json,        # <-- JSON string, safe for Dynamo
        "compress": bool(compress),
        "createdAt": now,
        "ttl": now + 6 * 3600,
    }

    print("Creating job:", json.dumps(item, default=str))
    jobs_table.put_item(Item=item)

    msg = {
            "jobId": job_id,
            "jobType": job_type,
        }
    print(f"Sending job to SQS: {msg}")
    sqs.send_message(
        QueueUrl=JOBS_QUEUE_URL,
        MessageBody=json.dumps(msg),
    )

    return job_id


def _get_job(job_id: str) -> Optional[Dict[str, Any]]:
    resp = jobs_table.get_item(Key={"jobId": job_id})
    return resp.get("Item")


# ---------- Dispatcher ----------

def lambda_handler(event, context):
    """
    Async API Lambda entrypoint.

    Handles:
      POST /api/count         -> create count job
      GET  /api/count/{jobId} -> get status/result
      POST /api/download      -> create download job
      GET  /api/download/{jobId} -> get status/result
    """
    print("API Lambda event:", json.dumps(event, default=_json_default))
    print("simple log")

    path = event.get("path", "") or ""
    resource = event.get("resource", "") or ""
    method = event.get("httpMethod", "GET")

    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    cors_origin = origin if origin in ALLOWED_CORS_ORIGINS else "*"

    # Decode body for POST
    body_data: Dict[str, Any] = {}
    raw_body = event.get("body")
    if raw_body:
        try:
            body_data = json.loads(raw_body)
        except json.JSONDecodeError:
            return _lambda_response(
                400,
                {"error": "Invalid JSON in request body"},
                cors_origin,
            )

    # Path parameters (for {jobId})
    path_params = event.get("pathParameters") or {}
    job_id_param = path_params.get("jobId")

    # ---- Routing ----

    # Count POST (create job)
    if method == "POST" and (resource == "/api/count" or path.endswith("/api/count")):
        filters = body_data.get("filters", body_data or {})
        filters = filters or {}
        job_id = _create_job("count", filters, compress=False)
        return _lambda_response(
            202,
            {
                "jobId": job_id,
                "status": "QUEUED",
                "jobType": "count",
            },
            cors_origin,
        )

    # Count GET (status)
    if method == "GET" and (resource == "/api/count/{jobId}" or "/api/count/" in path):
        job_id = job_id_param or path.rsplit("/", 1)[-1]
        job = _get_job(job_id)
        if not job:
            return _lambda_response(
                404,
                {"error": "Job not found", "jobId": job_id},
                cors_origin,
            )
        return _lambda_response(200, job, cors_origin)

    # Download POST (create job)
    if method == "POST" and (resource == "/api/download" or path.endswith("/api/download")):
        filters = body_data.get("filters", {})
        filters = filters or {}
        compress = bool(body_data.get("compress", False))
        job_id = _create_job("download", filters, compress=compress)
        return _lambda_response(
            202,
            {
                "jobId": job_id,
                "status": "QUEUED",
                "jobType": "download",
            },
            cors_origin,
        )

    # Download GET (status)
    if method == "GET" and (resource == "/api/download/{jobId}" or "/api/download/" in path):
        job_id = job_id_param or path.rsplit("/", 1)[-1]
        job = _get_job(job_id)
        if not job:
            return _lambda_response(
                404,
                {"error": "Job not found", "jobId": job_id},
                cors_origin,
            )
        return _lambda_response(200, job, cors_origin)

    # Fallback
    return _lambda_response(
        404,
        {"error": f"Unknown route {method} {path}"},
        cors_origin,
    )