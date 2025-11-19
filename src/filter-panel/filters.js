// filters.js
import {MARTIN_URL, sourceNames} from '../maplibre/config.js';

// ---- safe helpers ----
function safeCfg() {
    const cfg = window?.LandslideFilterConfig;
    // If not available yet, return a no-op config
    if (!cfg) {
        return {
            categorical: {
                material: {elementId: 'materialFilter', options: []},
                movement: {elementId: 'movementFilter', options: []},
                confidence: {elementId: 'confidenceFilter', options: []}
            },
            numericRanges: {
                pga: {elementId: 'pgaRange', tolerance: 0},
                pgv: {elementId: 'pgvRange', tolerance: 0},
                psa03: {elementId: 'psa03Range', tolerance: 0},
                mmi: {elementId: 'mmiRange', tolerance: 0},
                rain: {elementId: 'rainRange', tolerance: 0}
            }
        };
    }
    return cfg;
}

function getSelectedValues(selectId) {
    console.log(selectId)
    if (!selectId) return [];
    const el = document.getElementById(selectId);
    console.log(el)
    if (!el) return [];
    if (el.tagName === 'SELECT') {
        return Array.from(el.selectedOptions).map(o => o.value);
    }
    return Array.from(
        document.querySelectorAll(`#${selectId} input[type=checkbox]:checked`)
    ).map(cb => cb.value);
}

function getRange(rangeId) {
    if (!rangeId) return null;
    const minEl = document.getElementById(`${rangeId}Min`);
    const maxEl = document.getElementById(`${rangeId}Max`);
    if (!minEl && !maxEl) return null; // inputs not mounted yet
    const minV = !minEl || minEl.value === '' ? null : Number(minEl.value);
    const maxV = !maxEl || maxEl.value === '' ? null : Number(maxEl.value);
    if (minV == null && maxV == null) return null;
    return [minV, maxV];
}

function normalizeLabel(s) {
    return String(s || '').trim();
}

function expandMatches(opt) {
    return [normalizeLabel(opt.label || ''), ...((opt.matchValues || []).map(normalizeLabel))];
}

function collectCategorical(groupCfg, selected) {
    if (!groupCfg) return [];
    if (!selected?.length) return [];
    const allowed = new Set(selected.map(normalizeLabel));
    const out = [];
    for (const opt of (groupCfg.options || [])) {
        const names = expandMatches(opt);
        if (names.some(n => allowed.has(n))) out.push(names[0]); // canonical = label
    }
    return Array.from(new Set(out));
}

function buildQueryFromFiltersObject(filtersObj) {
    const qp = new URLSearchParams();

    // categorical
    const cat = filtersObj?.categorical || {};
    if (cat.material?.length) qp.set('materials', cat.material.join(','));
    if (cat.movement?.length) qp.set('movements', cat.movement.join(','));
    if (cat.confidence?.length) qp.set('confidences', cat.confidence.join(','));

    // numeric
    const num = filtersObj?.numeric || {};
    const push = (key) => {
        if (!num[key]) return;
        const {min, max, tol} = num[key];
        if (min != null) qp.set(`${key}_min`, String(min));
        if (max != null) qp.set(`${key}_max`, String(max));
        if (tol != null) qp.set(`tol_${key}`, String(tol));
    };
    push('pga');
    push('pgv');
    push('psa03');
    push('mmi');
    push('rain');

    qp.set('ts', Date.now().toString());
    return qp.toString();
}

function showMapLoading() {
    document.getElementById('map-loading')?.classList.remove('d-none');
}

function hideMapLoading() {
    document.getElementById('map-loading')?.classList.add('d-none');
}

export function applyLandslideFiltersFromObject(map, filtersObj) {
    const qp = buildQueryFromFiltersObject(filtersObj);

    showMapLoading();

    setSourceTilesSafe(map, 'polys_cluster',
        `${MARTIN_URL}/${sourceNames.polysFn}/{z}/{x}/{y}?mode=cluster&${qp}`);
    setSourceTilesSafe(map, 'polys_raw',
        `${MARTIN_URL}/${sourceNames.polysFn}/{z}/{x}/{y}?mode=raw&${qp}`);
    setSourceTilesSafe(map, 'points_cluster',
        `${MARTIN_URL}/${sourceNames.pointsFn}/{z}/{x}/{y}?mode=cluster&${qp}`);
    setSourceTilesSafe(map, 'points_raw',
        `${MARTIN_URL}/${sourceNames.pointsFn}/{z}/{x}/{y}?mode=raw&${qp}`);


    let done = false;
    const finish = () => {
        if (!done) {
            done = true;
            hideMapLoading();
        }
    };
    map.once('idle', finish);
    setTimeout(finish, 5000);
}

// ---- public API ----
export function buildFilterQuery() {
    const cfg = safeCfg();
    const qp = new URLSearchParams();

    // categorical
    const c = cfg.categorical;
    const materials = collectCategorical(c.material, getSelectedValues(c.material?.elementId));
    const movements = collectCategorical(c.movement, getSelectedValues(c.movement?.elementId));
    const confidences = collectCategorical(c.confidence, getSelectedValues(c.confidence?.elementId));
    if (materials.length) qp.set('materials', materials.join(','));
    if (movements.length) qp.set('movements', movements.join(','));
    if (confidences.length) qp.set('confidences', confidences.join(','));

    // numeric
    const n = cfg.numericRanges;

    function pushRange(key, groupCfg) {
        if (!groupCfg) return;
        const r = getRange(groupCfg.elementId);
        if (!r) return;
        const [minV, maxV] = r;
        if (minV != null) qp.set(`${key}_min`, String(minV));
        if (maxV != null) qp.set(`${key}_max`, String(maxV));
        if (groupCfg.tolerance != null) qp.set(`tol_${key}`, String(groupCfg.tolerance));
    }

    pushRange('pga', n?.pga);
    pushRange('pgv', n?.pgv);
    pushRange('psa03', n?.psa03);
    pushRange('mmi', n?.mmi);
    pushRange('rain', n?.rain);

    // cache-buster
    qp.set('ts', Date.now().toString());
    return qp.toString();
}

function whenStyleLoaded(map) {
    return new Promise((res) => {
        if (map.isStyleLoaded()) return res();
        map.once('load', res);
    });
}

function whenSourceReady(map, sourceId) {
    return new Promise((res) => {
        const src = map.getSource(sourceId);
        if (src) return res();
        const onData = (e) => {
            if (e.sourceId === sourceId && map.getSource(sourceId)) {
                map.off('sourcedata', onData);
                res();
            }
        };
        map.on('sourcedata', onData);
    });
}

async function setSourceTilesSafe(map, sourceId, url) {
    await whenStyleLoaded(map);
    await whenSourceReady(map, sourceId);

    const src = map.getSource(sourceId);
    if (!src) return;

    if (typeof src.setTiles === 'function') {
        try {
            src.setTiles([url]);
        } catch (err) {
            // AbortError = previous network requests were cancelled; safe to ignore
            if (!err || err.name !== 'AbortError') console.warn('setTiles error:', err);
        }
    } else {
        // Fallback: remove/re-add source with new tiles
        const style = map.getStyle();
        const def = style?.sources?.[sourceId];
        if (!def) return;
        map.removeSource(sourceId);
        map.addSource(sourceId, {...def, tiles: [url]});
    }
}

export function getCurrentFiltersForSummary() {
    const cfg = safeCfg();

    console.log('[filters] safeCfg()', cfg);

    // categorical
    const c = cfg.categorical || {};
    console.log('[filters] categorical config:', c);

    const materialSelected = getSelectedValues(c.material?.elementId);
    const movementSelected = getSelectedValues(c.movement?.elementId);
    const confidenceSelected = getSelectedValues(c.confidence?.elementId);

    console.log('[filters] selected material values:', materialSelected);
    console.log('[filters] selected movement values:', movementSelected);
    console.log('[filters] selected confidence values:', confidenceSelected);

    const materials = collectCategorical(c.material, materialSelected);
    const movements = collectCategorical(c.movement, movementSelected);
    const confidences = collectCategorical(c.confidence, confidenceSelected);

    console.log('[filters] materials after collectCategorical:', materials);
    console.log('[filters] movements after collectCategorical:', movements);
    console.log('[filters] confidences after collectCategorical:', confidences);

    // numeric (min/max from inputs; include tolerance for display if you want)
    const n = cfg.numericRanges || {};
    const read = (key, groupCfg) => {
        if (!groupCfg) {
            console.log(`[filters] numeric groupCfg for ${key} is missing`);
            return null;
        }
        const r = getRange(groupCfg.elementId);
        console.log(`[filters] numeric raw range for ${key}:`, r);
        if (!r) return null;
        const [minV, maxV] = r;
        return {min: minV, max: maxV, tol: groupCfg.tolerance ?? null};
    };

    const pga = read('pga', n.pga);
    const pgv = read('pgv', n.pgv);
    const psa03 = read('psa03', n.psa03);
    const mmi = read('mmi', n.mmi);
    const rain = read('rain', n.rain);

    const result = {
        categorical: {material: materials, movement: movements, confidence: confidences},
        numeric: {pga, pgv, psa03, mmi, rain},
    };

    console.log('[filters] getCurrentFiltersForSummary result:', result);

    return result;

}

export function buildFilterSearchParams(extra = {}) {
    const params = new URLSearchParams(buildFilterQuery());  // uses your existing builder
    for (const [k, v] of Object.entries(extra)) {
        if (v == null) continue;
        params.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return params;
}
