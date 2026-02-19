const _cache = new Map(); // key -> { t, data }
const CACHE_TTL_MS = 60_000;

let _inflight = null;

export function abortLandslideDetailsFetch() {
    if (_inflight) _inflight.abort();
    _inflight = null;
}

export async function fetchLandslideDetails({ baseUrl = '', source, viewer_id, include_geom = false }) {
    if (!source || !viewer_id) throw new Error('fetchLandslideDetails requires {source, viewer_id}');

    const key = `${source}::${viewer_id}::${include_geom ? 1 : 0}`;
    const now = Date.now();

    const cached = _cache.get(key);
    if (cached && (now - cached.t) < CACHE_TTL_MS) return cached.data;

    abortLandslideDetailsFetch();
    const ac = new AbortController();
    _inflight = ac;

    const url = new URL(`${baseUrl}/api/landslide`, window.location.origin);
    url.searchParams.set('source', source);
    url.searchParams.set('viewer_id', viewer_id);
    url.searchParams.set('include_geom', include_geom ? 'true' : 'false');

    const resp = await fetch(url.toString(), { signal: ac.signal });
    if (!resp.ok) throw new Error(`GET ${url.pathname} failed: ${resp.status}`);
    const json = await resp.json();

    _cache.set(key, { t: now, data: json });
    return json;
}