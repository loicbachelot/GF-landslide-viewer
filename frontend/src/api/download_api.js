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
 * Small helper to wait between polls.
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a job endpoint until it finishes or errors.
 *
 * @param {string} basePath - e.g. "/api/count" or "/api/download"
 * @param {string} jobId
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.intervalMs]
 * @param {number} [options.maxDurationMs]
 * @returns {Promise<object>} full job object from the API
 */
async function pollJob(basePath, jobId, {
    signal,
    intervalMs = 2000,
    maxDurationMs = 5 * 60 * 1000,
} = {}) {
    const start = Date.now();

    while (true) {
        if (signal?.aborted) {
            throw new DOMException('Polling aborted', 'AbortError');
        }

        const res = await fetch(`${basePath}/${encodeURIComponent(jobId)}`, {
            method: 'GET',
        });

        if (!res.ok) {
            const message = await extractErrorMessage(res, 'Job status failed');
            throw new Error(message);
        }

        const job = await res.json();
        const status = job.status;

        if (status === 'DONE') {
            return job;
        }

        if (status === 'ERROR') {
            const errMsg = job.error || 'Job failed with status ERROR';
            throw new Error(errMsg);
        }

        // QUEUED / RUNNING
        const elapsed = Date.now() - start;
        if (elapsed > maxDurationMs) {
            throw new Error('Timed out waiting for job to complete.');
        }

        await delay(intervalMs);
    }
}

/**
 * Call the backend /download endpoint with the given filters.
 *
 * New async behavior:
 *  - POST /api/download -> { jobId, status: "QUEUED" }
 *  - Poll GET /api/download/{jobId} until status === "DONE"
 *  - When done, use result.cf_path (prod) or result.url (local) and
 *    TRIGGER the browser download.
 *
 * @param {object} filters
 * @param {object} options
 * @param {boolean} [options.compress=false]
 * @param {AbortSignal} [options.signal] - optional abort signal for polling
 */
export async function requestDownload(
    filters,
    { compress = false, signal } = {},
) {
    if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid filters object passed to requestDownload.');
    }

    const payload = {
        filters,
        compress,
    };

    // Step 1: create the job
    const res = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const message = await extractErrorMessage(res, 'Download job creation failed');
        throw new Error(message);
    }

    const data = await res.json();
    const jobId = data?.jobId;
    if (!jobId) {
        throw new Error('Download response missing "jobId".');
    }

    // Step 2: poll job status until DONE/ERROR
    const job = await pollJob(`${API_BASE}/download`, jobId, {
        signal,
        intervalMs: 5000,
        maxDurationMs: 12 * 60 * 1000,
    });

    // Worker stores result under job.result
    const result = job.result || {};
    const cfPath = result.cf_path;
    const url = result.url;
    const filename =
        result.filename || (compress ? 'landslides.geojson.zip' : 'landslides.geojson');

    if (!cfPath && !url) {
        throw new Error('Download job completed but no URL was returned.');
    }

    // Decide whether to use CloudFront path or presigned S3 URL
    const host = window.location.hostname;
    const isLocal =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0';

    // In prod (served behind CloudFront / real domain), prefer cf_path if present.
    // In local dev, or if cf_path is missing, fall back to the presigned S3 URL.
    const downloadUrl = (!isLocal && cfPath) ? cfPath : url;

    if (!downloadUrl) {
        throw new Error('No usable download URL from completed download job.');
    }

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename || '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Call the backend /count endpoint with the given filters.
 *
 * New async behavior:
 *  - POST /api/count -> { jobId, status: "QUEUED" }
 *  - Poll GET /api/count/{jobId} until status === "DONE"
 *  - Returns the numeric "count" from job.result.count
 *
 * @param {object} filters - current filters (materials, movements, pga_min, etc.)
 * @param {AbortSignal} [signal] - optional abort signal for polling
 * @returns {Promise<number>} count of matching landslides
 */
export async function requestCount(filters, signal) {
    if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid filters object passed to requestCount.');
    }

    // Step 1: create the job
    const res = await fetch(`${API_BASE}/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
    });

    if (!res.ok) {
        const message = await extractErrorMessage(res, 'Count job creation failed');
        throw new Error(message);
    }

    const data = await res.json();
    const jobId = data?.jobId;
    if (!jobId) {
        throw new Error('Count response missing "jobId".');
    }

    // Step 2: poll job status until DONE/ERROR
    const job = await pollJob(`${API_BASE}/count`, jobId, {
        signal,
        intervalMs: 1000,
        maxDurationMs: 2 * 60 * 1000,
    });

    const result = job.result || {};
    const count = typeof result.count === 'number'
        ? result.count
        : (typeof job.count === 'number' ? job.count : undefined);

    if (typeof count !== 'number') {
        throw new Error('Count job completed but no numeric "count" was returned.');
    }

    return count;
}