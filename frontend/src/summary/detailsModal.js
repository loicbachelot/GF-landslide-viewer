import { fetchLandslideDetails, abortLandslideDetailsFetch } from '../api/details_api.js';

function isUrl(v) {
    return typeof v === 'string' && /^(https?:\/\/|www\.)/i.test(v);
}

function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt ?? '';
}

function setError(msg) {
    const el = document.getElementById('detailsError');
    if (!el) return;
    if (msg) {
        el.classList.remove('d-none');
        el.textContent = msg;
    } else {
        el.classList.add('d-none');
        el.textContent = '';
    }
}

function renderKVTable(obj) {
    const tbody = document.getElementById('detailsTbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!obj) return;

    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
        const v = obj[k];
        if (v == null) continue;
        if (typeof v === 'object') continue; // keep it simple (no nested objects)

        const tr = document.createElement('tr');
        const tdK = document.createElement('td');
        const tdV = document.createElement('td');

        tdK.textContent = k.replace(/_/g, ' ');

        if (isUrl(v)) {
            const a = document.createElement('a');
            a.href = v.startsWith('www.') ? `https://${v}` : v;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = v;
            tdV.appendChild(a);
        } else {
            tdV.textContent = String(v);
        }

        tr.append(tdK, tdV);
        tbody.appendChild(tr);
    }
}

function normalizeDetails(apiJson) {
    // Your API returns: { found, source, viewer_id, properties: {...} }
    // Keep it flexible: show everything in `properties`, plus `source/viewer_id`.
    const p = apiJson?.properties ?? {};
    return {
        source: apiJson?.source ?? p.source ?? p.SOURCE ?? null,
        viewer_id: apiJson?.viewer_id ?? p.viewer_id ?? p.VIEWER_ID ?? null,
        ...p
    };
}

export function initDetailsModal() {
    const modalEl = document.getElementById('detailsModal');
    if (!modalEl) {
        console.warn('[detailsModal] #detailsModal not found');
        return;
    }

    const modal = window.bootstrap?.Modal.getOrCreateInstance(modalEl);
    if (!modal) {
        console.warn('[detailsModal] bootstrap.Modal not available (is Bootstrap JS loaded?)');
        return;
    }

    // Abort fetch when user closes the modal
    modalEl.addEventListener('hidden.bs.modal', () => {
        abortLandslideDetailsFetch();
        setError(null);
        setText('detailsStatus', '');
        renderKVTable({});
    });

    window.addEventListener('ls:view-details', async (ev) => {
        const { source, viewer_id } = ev.detail ?? {};
        if (!source || !viewer_id) {
            console.warn('[detailsModal] missing source/viewer_id', ev.detail);
            return;
        }

        // Open immediately with loading state
        setError(null);
        setText('detailsModalTitle', 'Information');
        setText('detailsStatus', `Loading details for ${source} / ${viewer_id}…`);
        renderKVTable({ source, viewer_id });
        modal.show();

        try {
            const apiJson = await fetchLandslideDetails({ source, viewer_id, include_geom: false });

            if (!apiJson?.found) {
                setText('detailsStatus', `No details found for ${source} / ${viewer_id}.`);
                return;
            }

            const normalized = normalizeDetails(apiJson);
            setText('detailsModalTitle', `Information — ${viewer_id}`);
            setText('detailsStatus', '');
            renderKVTable(normalized);
        } catch (e) {
            if (e?.name === 'AbortError') return;
            setText('detailsStatus', '');
            setError(String(e?.message ?? e));
        }
    });
}
