const API_BASE = '/api';

/**
 * Extract an error message from a failed response.
 */
async function extractErrorMessage(res, prefix = 'Request failed') {
    let message = `${prefix}: ${res.status}`;
    try {
        const text = await res.text();
        if (!text) return message;
        try {
            const data = JSON.parse(text);
            if (data?.detail) {
                message += ` – ${data.detail}`;
            } else if (data?.error) {
                message += ` – ${data.error}`;
            } else {
                message += ` – ${text}`;
            }
        } catch {
            message += ` – ${text}`;
        }
    } catch {
        // ignore
    }
    return message;
}

/**
 * Call the backend /download endpoint with the given filters.
 * Supports two backend behaviors:
 *
 * 1) JSON response (Lambda style):
 *    { url: "https://presigned...", filename: "landslides.geojson[.zip]" }
 *
 * 2) Direct file response (FastAPI FileResponse):
 *    Content-Type: application/zip or application/geo+json, body is the file.
 *
 * In both cases this function TRIGGERS the browser download and returns void.
 *
 * @param {object} filters
 * @param {object} options
 * @param {boolean} [options.compress=false]
 */
export async function requestDownload(filters, { compress = false } = {}) {
    if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid filters object passed to requestDownload.');
    }

    const payload = {
        filters,
        compress,
    };

    const res = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const message = await extractErrorMessage(res, 'Download failed');
        throw new Error(message);
    }

    const contentType = res.headers.get('content-type') || '';

    // ---- Case 1: JSON { url, filename } (Lambda / S3) ----
    if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!data?.url) {
            throw new Error('Download URL missing from /api/download response.');
        }

        const url = data.url;
        const filename =
            data.filename || (compress ? 'landslides.geojson.zip' : 'landslides.geojson');

        const a = document.createElement('a');
        a.href = url;
        a.download = filename || '';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();

        return;
    }

    // ---- Case 2: direct file response (FastAPI) ----
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = compress ? 'landslides.geojson.zip' : 'landslides.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
}

/**
 * Call the backend /count endpoint with the given filters.
 * We send { filters } to match the Lambda handler (which also accepts bare filters).
 *
 * @param {object} filters - current filters (materials, movements, pga_min, etc.)
 * @returns {Promise<number>} count of matching landslides
 */
export async function requestCount(filters) {
    if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid filters object passed to requestCount.');
    }

    const res = await fetch(`${API_BASE}/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
    });

    if (!res.ok) {
        const message = await extractErrorMessage(res, 'Count failed');
        throw new Error(message);
    }

    const data = await res.json();
    if (typeof data?.count !== 'number') {
        throw new Error('Count response missing numeric "count" field.');
    }
    return data.count;
}