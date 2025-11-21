// src/download/api.js

/**
 * Call the backend /download endpoint with the given filters.
 * Filters must match the FastAPI Filters model.
 *
 * @param {object} filters - current filters (materials, movements, pga_min, etc.)
 * @param {object} options
 * @param {boolean} [options.compress=false] - whether to request a zipped export
 * @returns {Promise<void>}
 */
export async function requestDownload(filters, { compress = false } = {}) {
    if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid filters object passed to requestDownload.');
    }

    const payload = {
        filters,
        compress,
    };

    const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        // Try to read JSON error from backend
        let message = `Download failed: ${res.status}`;
        try {
            const data = await res.json();
            if (data?.detail) {
                message += ` – ${data.detail}`;
            }
        } catch {
            // ignore JSON parse error
        }
        throw new Error(message);
    }

    // Get file and trigger browser download
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
 * Filters must match the FastAPI Filters model.
 *
 * @param {object} filters - current filters (materials, movements, pga_min, etc.)
 * @returns {Promise<number>} count of matching landslides
 */
export async function requestCount(filters) {
    if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid filters object passed to requestCount.');
    }

    const res = await fetch('/api/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
    });

    if (!res.ok) {
        let message = `Count failed: ${res.status}`;
        try {
            const data = await res.json();
            if (data?.detail) {
                message += ` – ${data.detail}`;
            }
        } catch {
            // ignore JSON parse error
        }
        throw new Error(message);
    }

    const data = await res.json();
    if (typeof data?.count !== 'number') {
        throw new Error('Count response missing numeric "count" field.');
    }
    return data.count;
}