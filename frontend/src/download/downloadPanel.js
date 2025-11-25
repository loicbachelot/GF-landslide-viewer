import { requestDownload, requestCount } from './api.js';
import { getCurrentFilterSummary } from '../filter-panel/filterState.js';

/**
 * Convert filter summary → backend Filters model
 */
function buildBackendFiltersFromSummary(summary) {
    const cat = summary.categorical || {};
    const num = summary.numeric || {};
    const spatial = summary.spatial || null;

    const pga   = num.pga   || null;
    const pgv   = num.pgv   || null;
    const psa03 = num.psa03 || null;
    const mmi   = num.mmi   || null;
    const rain  = num.rain  || null;

    return {
        materials:   cat.material   ?? [],
        movements:   cat.movement   ?? [],
        confidences: cat.confidence ?? [],

        pga_min:   pga   ? pga.min   : null,
        pga_max:   pga   ? pga.max   : null,
        pgv_min:   pgv   ? pgv.min   : null,
        pgv_max:   pgv   ? pgv.max   : null,
        psa03_min: psa03 ? psa03.min : null,
        psa03_max: psa03 ? psa03.max : null,
        mmi_min:   mmi   ? mmi.min   : null,
        mmi_max:   mmi   ? mmi.max   : null,
        rain_min:  rain  ? rain.min  : null,
        rain_max:  rain  ? rain.max  : null,

        tol_pga:   pga   && pga.tol   != null ? pga.tol   : 0,
        tol_pgv:   pgv   && pgv.tol   != null ? pgv.tol   : 0,
        tol_psa03: psa03 && psa03.tol != null ? psa03.tol : 0,
        tol_mmi:   mmi   && mmi.tol   != null ? mmi.tol   : 0,
        tol_rain:  rain  && rain.tol  != null ? rain.tol  : 0,

        selection_geojson: spatial,
    };
}

/**
 * Render filter summary for modal
 */
function renderSummaryHTML(summary) {
    const cat = summary.categorical || {};
    const num = summary.numeric || {};
    const spatial = summary.spatial || null;

    const items = [];

    // ----- categorical -----
    if (cat.material?.length) {
        items.push(`<li><strong>Material:</strong> ${cat.material.join(', ')}</li>`);
    }
    if (cat.movement?.length) {
        items.push(`<li><strong>Movement:</strong> ${cat.movement.join(', ')}</li>`);
    }
    if (cat.confidence?.length) {
        items.push(`<li><strong>Confidence:</strong> ${cat.confidence.join(', ')}</li>`);
    }

    // ----- numeric ranges -----
    for (const [key, range] of Object.entries(num)) {
        if (!range || (range.min == null && range.max == null)) continue;
        const label = key.toUpperCase();
        items.push(
            `<li><strong>${label}:</strong> ${range.min ?? '–'} – ${range.max ?? '–'}</li>`
        );
    }

    // ----- spatial selection -----
    if (spatial && spatial.type === 'Polygon' && Array.isArray(spatial.coordinates)) {
        const ring = spatial.coordinates[0] || [];
        let minLng = Infinity, maxLng = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;

        for (const coord of ring) {
            const [lng, lat] = coord;
            if (typeof lng !== 'number' || typeof lat !== 'number') continue;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }

        if (isFinite(minLng) && isFinite(maxLng) && isFinite(minLat) && isFinite(maxLat)) {
            items.push(
                `<li><strong>Spatial:</strong> Polygon (${minLng.toFixed(3)}, ${minLat.toFixed(3)} → ${maxLng.toFixed(3)}, ${maxLat.toFixed(3)})</li>`
            );
        } else {
            items.push(`<li><strong>Spatial:</strong> Polygon selection</li>`);
        }
    }

    // ----- no filters -----
    if (!items.length) {
        return '<p class="mb-0 small text-muted">No filters applied (all landslides).</p>';
    }

    return `<ul class="mb-0 small">${items.join('')}</ul>`;
}

/**
 * DOWNLOAD PANEL WITH MODAL CONFIRMATION + PROGRESS STATES
 */
export function initDownloadPanel({ container }) {
    const mountEl = (typeof container === 'string')
        ? document.getElementById(container)
        : container;

    if (!mountEl) {
        console.warn('[downloadPanel] Container not found');
        return;
    }

    // --- Build the card ---
    const wrap = document.createElement('div');
    wrap.className = 'download card shadow-sm';

    wrap.innerHTML = `
      <div class="card-body p-2">
        <h5 class="card-title mb-2">Download landslides</h5>
        <p class="card-text small mb-2">Spatial selection tool</p>
        <div id="spatial-controls" class="spatial-controls">
            <button id="spatial-draw-btn"   type="button" class="btn btn-primary btn-sm">Draw selection</button>
            <button id="spatial-validate-btn" type="button" class="btn btn-success btn-sm">Validate</button>
            <button id="spatial-reset-btn"  type="button" class="btn btn-danger btn-sm">Reset</button>
        </div>
        <p class="card-text small mb-2">
          Download all landslides matching the current applied filters as GeoJSON.
        </p>
        <button type="button"
                class="btn btn-primary"
                id="downloadBtn">
          Download
        </button>
        <div class="small mt-1" id="downloadStatus"></div>
      </div>
    `;

    mountEl.innerHTML = '';
    mountEl.appendChild(wrap);

    const button = wrap.querySelector('#downloadBtn');
    const status = wrap.querySelector('#downloadStatus');

    const setStatus = (msg, type = 'muted') => {
        status.textContent = msg || '';
        status.className = `small mt-1${msg ? ' text-' + type : ''}`;
    };

    // ---- Modal references ----
    const modalEl      = document.getElementById('downloadConfirmModal');
    const modalCountEl = document.getElementById('downloadConfirmCount');
    const modalFilters = document.getElementById('downloadConfirmFilters');
    const modalNoteEl  = document.getElementById('downloadConfirmNote');
    const modalConfirm = document.getElementById('downloadConfirmBtn');
    const modalCompress = document.getElementById('downloadCompressModal');

    let modal = null;
    if (modalEl && window.bootstrap?.Modal) {
        modal = new window.bootstrap.Modal(modalEl);
    }

    // Fix aria-hidden accessibility warning
    if (modal && modalEl) {
        modalEl.addEventListener('hide.bs.modal', () => {
            const focusedElement = modalEl.querySelector(':focus');
            if (focusedElement) focusedElement.blur();
        });
    }

    let pendingFilters = null;

    // ---- Unified modal state management ----
    const setModalState = (state, data = {}) => {
        if (!modalCountEl || !modalFilters || !modalNoteEl || !modalConfirm) return;

        const states = {
            counting: {
                count: '…',
                note: 'Processing request, counting features…',
                noteClass: 'text-muted',
                btnDisabled: true,
                btnText: 'Download'
            },
            ready: {
                count: data.count?.toLocaleString('en-US'),
                note: data.count > 100_000
                    ? 'Warning: this is a large download and may take some time to prepare. We advise you to download the .zip version'
                    : 'Large downloads may take some time to prepare.',
                noteClass: data.count > 100_000 ? 'text-danger' : 'text-muted',
                btnDisabled: false,
                btnText: 'Download'
            },
            downloading: {
                note: 'Preparing file… your browser will start the download shortly.',
                noteClass: 'text-muted',
                btnDisabled: true,
                btnText: 'Downloading…'
            },
            error: {
                count: '–',
                note: data.message,
                noteClass: 'text-danger',
                btnDisabled: true,
                btnText: 'Download'
            }
        };

        const config = states[state];
        if (config.count !== undefined) modalCountEl.textContent = config.count;
        modalNoteEl.textContent = config.note;
        modalNoteEl.classList.remove('text-muted', 'text-danger');
        modalNoteEl.classList.add(config.noteClass);
        modalConfirm.disabled = config.btnDisabled;
        modalConfirm.textContent = config.btnText;

        if (state === 'counting') {
            delete modalConfirm.dataset.mode;
            modalFilters.innerHTML = renderSummaryHTML(data.summary);
        }
    };

    // ---- Extract download logic ----
    const performDownload = async (backendFilters, compress) => {
        setModalState('downloading');
        setStatus('Preparing file…', 'muted');
        button.disabled = true;
        button.textContent = 'Downloading…';

        try {
            await requestDownload(backendFilters, { compress });

            setStatus('Download started.', 'success');
            modalNoteEl.textContent = 'Download started. You can close this window when the file appears.';
            modalConfirm.textContent = 'Close';
            modalConfirm.disabled = false;
            modalConfirm.dataset.mode = 'done';
            pendingFilters = null;
        } catch (err) {
            console.error('[downloadPanel] download error', err);
            const msg = err?.message || 'Download failed.';
            setStatus(msg, 'danger');
            setModalState('error', { message: msg });
            modalConfirm.dataset.mode = 'error';
            throw err;
        } finally {
            button.disabled = false;
            button.textContent = 'Download';
        }
    };

    // ---- Modal confirm button ----
    if (modal && modalConfirm && !modalConfirm._bound) {
        modalConfirm.addEventListener('click', async () => {
            if (modalConfirm.dataset.mode === 'done') {
                modal.hide();
                return;
            }

            if (!pendingFilters) return;

            modalConfirm.dataset.mode = 'downloading';
            const compress = modalCompress?.checked ?? false;

            await performDownload(pendingFilters, compress);
        });
        modalConfirm._bound = true;
    }

    // ---- Helper functions for main button ----
    const getSummaryOrFail = () => {
        try {
            return getCurrentFilterSummary();
        } catch (err) {
            console.error('[downloadPanel] getCurrentFilterSummary() threw', err);
            setStatus('Failed to read current filters.', 'danger');
            return null;
        }
    };

    const isModalAvailable = () =>
        !!(modal && modalCountEl && modalFilters && modalNoteEl && modalConfirm);

    const fallbackDirectDownload = async (backendFilters) => {
        console.warn('[downloadPanel] Modal not available, falling back to direct download');
        button.disabled = true;
        button.textContent = 'Downloading…';
        setStatus('Preparing file…', 'muted');

        try {
            const { url, filename } = await requestDownload(backendFilters, { compress: false });

            const a = document.createElement('a');
            a.href = url;
            a.download = filename || '';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();

            setStatus('Download started.', 'success');
        } catch (err) {
            console.error('[downloadPanel] download error', err);
            setStatus(err?.message || 'Download failed.', 'danger');
        } finally {
            button.disabled = false;
            button.textContent = 'Download';
        }
    };

    const showModalAndCount = async (summary, backendFilters) => {
        setModalState('counting', { summary });
        modal.show();
        setStatus('Counting matching landslides…', 'muted');
        button.disabled = true;
        button.textContent = 'Checking…';

        try {
            const count = await requestCount(backendFilters);
            setModalState('ready', { count });
            setStatus('', 'muted');
        } catch (err) {
            console.error('[downloadPanel] count error', err);
            const msg = err?.message || 'Failed to count matching landslides.';
            setStatus(msg, 'danger');
            setModalState('error', { message: msg });
        } finally {
            button.disabled = false;
            button.textContent = 'Download';
        }
    };

    // ---- Main download button ----
    button.addEventListener('click', async () => {
        const summary = getSummaryOrFail();
        if (!summary) return;

        const backendFilters = buildBackendFiltersFromSummary(summary);
        pendingFilters = backendFilters;

        if (!isModalAvailable()) {
            return await fallbackDirectDownload(backendFilters);
        }

        await showModalAndCount(summary, backendFilters);
    });
}