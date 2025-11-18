import os
import json
import tempfile
import zipfile
from typing import List, Optional, Tuple
from dotenv import load_dotenv
load_dotenv(".env.local")

import psycopg2
from psycopg2.extras import DictCursor
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

# ---- DB helper ----

def get_db_conn():
    """
    Very simple connection helper.
    Expect DATABASE_URL in format:
    postgres://user:pass@host:port/dbname
    """
    print(os.getenv("DATABASE_URL"))
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(dsn, cursor_factory=DictCursor)


# ---- Request model ----

class DownloadRequest(BaseModel):
    viewer_ids: List[str]
    compress: Optional[bool] = False


# ---- Core export function (reusable later in Lambda) ----

def generate_geojson_export(
    viewer_ids: List[str],
    compress: bool = False,
    max_features: int = 200_000,
) -> Tuple[str, str]:
    """
    Generate a GeoJSON file (optionally zipped) in a temp directory
    using the landslides.ls_export_original_features(viewer_ids text[]) function.

    Returns:
      (file_path, download_filename)
    """

    if not viewer_ids:
        raise ValueError("viewer_ids is empty")

    conn = get_db_conn()

    # You *can* make this a server-side cursor later if needed:
    # cur = conn.cursor(name="ls_export_cursor")
    cur = conn.cursor()

    # Call the Postgres function that unions all source tables
    sql = "SELECT landslide_v2.ls_export_original_features(%s) AS feature"
    cur.execute(sql, (viewer_ids,))

    # Create temp dir simulating Lambda's /tmp usage
    tmp_dir = tempfile.mkdtemp()
    geojson_path = os.path.join(tmp_dir, "landslides.geojson")

    feature_count = 0

    # Stream-write GeoJSON
    with open(geojson_path, "w", encoding="utf-8") as f:
        f.write('{"type":"FeatureCollection","features":[')
        first = True
        for (feature,) in cur:
            feature_count += 1
            if feature_count > max_features:
                cur.close()
                conn.close()
                raise RuntimeError(
                    f"Too many features requested (>{max_features}). "
                    "Please refine your selection."
                )

            if not first:
                f.write(",")
            else:
                first = False

            # feature is a dict-like (jsonb), so we can dump it directly
            json.dump(feature, f)

        f.write("]}")

    cur.close()
    conn.close()

    if not compress:
        # Return raw GeoJSON
        return geojson_path, "landslides.geojson"

    # Otherwise, zip it
    zip_path = os.path.join(tmp_dir, "landslides.geojson.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(geojson_path, arcname="landslides.geojson")

    return zip_path, "landslides.geojson.zip"


# ---- FastAPI endpoint ----

@app.post("/download")
def download(req: DownloadRequest):
    if not req.viewer_ids:
        raise HTTPException(status_code=400, detail="viewer_ids cannot be empty")

    try:
        file_path, filename = generate_geojson_export(
            viewer_ids=req.viewer_ids,
            compress=req.compress or False,
        )
    except RuntimeError as e:
        # e.g., too many features
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
