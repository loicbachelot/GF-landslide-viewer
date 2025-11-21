import { requestDownload, requestCount } from './api.js';
import { getCurrentFilterSummary } from '../filter-panel/filterState.js';

/**
 * Convert filter summary → backend Filters model
 */
function buildBackendFiltersFromSummary(summary) {
    const cat = summary.categorical || {};
    const num = summary.numeric || {};

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

        selection_geojson: null,
    };
}

/**
 * Render filter summary for modal
 */
function renderSummaryHTML(summary) {
    const cat = summary.categorical || {};
    const num = summary.numeric || {};

    const items = [];

    if (cat.material?.length) {
        items.push(`<li><strong>Material:</strong> ${cat.material.join(', ')}</li>`);
    }
    if (cat.movement?.length) {
        items.push(`<li><strong>Movement:</strong> ${cat.movement.join(', ')}</li>`);
    }
    if (cat.confidence?.length) {
        items.push(`<li><strong>Confidence:</strong> ${cat.confidence.join(', ')}</li>`);
    }

    for (const [key, range] of Object.entries(num)) {
        if (!range || (range.min == null && range.max == null)) continue;
        const label = key.toUpperCase();
        items.push(
            `<li><strong>${label}:</strong> ${range.min ?? '–'} – ${range.max ?? '–'}</li>`
        );
    }

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

    // Keep track of current backend filters for confirm
    let pendingFilters = null;

    const setModalCountingState = (summary) => {
        if (!modalCountEl || !modalFilters || !modalNoteEl || !modalConfirm) return;

        // Filters known immediately
        modalFilters.innerHTML = renderSummaryHTML(summary);

        // Count is not known yet
        modalCountEl.textContent = '…';

        modalNoteEl.textContent = 'Processing request, counting features…';
        modalNoteEl.classList.remove('text-danger');
        modalNoteEl.classList.add('text-muted');

        modalConfirm.disabled = true;
        modalConfirm.textContent = 'Download';
        delete modalConfirm.dataset.mode;
    };

    const setModalReadyState = (count) => {
        modalCountEl.textContent = count.toLocaleString('en-US');

        if (count > 100_000) {
            modalNoteEl.textContent =
                'Warning: this is a large download and may take some time to prepare. We advise you to download the .zip version';
            modalNoteEl.classList.remove('text-muted');
            modalNoteEl.classList.add('text-danger');
        } else {
            modalNoteEl.textContent = 'Large downloads may take some time to prepare.';
            modalNoteEl.classList.remove('text-danger');
            modalNoteEl.classList.add('text-muted');
        }

        modalConfirm.disabled = false;
        modalConfirm.textContent = 'Download';
    };

    const setModalDownloadingState = () => {
        modalNoteEl.textContent =
            'Preparing file… your browser will start the download shortly.';
        modalNoteEl.classList.remove('text-danger');
        modalNoteEl.classList.add('text-muted');

        modalConfirm.disabled = true;
        modalConfirm.textContent = 'Downloading…';
    };

    const setModalErrorState = (message) => {
        modalCountEl.textContent = '–';
        modalNoteEl.textContent = message;
        modalNoteEl.classList.remove('text-muted');
        modalNoteEl.classList.add('text-danger');

        modalConfirm.disabled = true;
        modalConfirm.textContent = 'Download';
    };

    // ---- Confirm button in modal ----
    if (modal && modalConfirm && !modalConfirm._bound) {
        modalConfirm.addEventListener('click', async () => {
            // If we've already finished, this button just closes the modal
            if (modalConfirm.dataset.mode === 'done') {
                modal.hide();
                return;
            }

            if (!pendingFilters) return;

            const compress = !!(modalCompress && modalCompress.checked);
            const backendFilters = pendingFilters;

            // Mark as "downloading" to prevent double-trigger
            modalConfirm.dataset.mode = 'downloading';

            setModalDownloadingState();
            setStatus('Preparing file…', 'muted');

            button.disabled = true;
            button.textContent = 'Downloading…';

            try {
                await requestDownload(backendFilters, { compress });
                setStatus('Download started.', 'success');

                // After a successful start, turn this button into a pure "Close"
                modalNoteEl.textContent =
                    'Download started. You can close this window when the file appears.';
                modalConfirm.textContent = 'Close';
                modalConfirm.disabled = false;
                modalConfirm.dataset.mode = 'done';

                // No more downloads from this modal instance
                pendingFilters = null;
            } catch (err) {
                console.error('[downloadPanel] download error', err);
                const msg = err?.message || 'Download failed.';
                setStatus(msg, 'danger');
                setModalErrorState(msg);
                modalConfirm.dataset.mode = 'error';
            } finally {
                button.disabled = false;
                button.textContent = 'Download';
            }
        });
        modalConfirm._bound = true;
    }

    // ---- Main click: open modal immediately, then count ----
    button.addEventListener('click', async () => {
        let summary;
        try {
            summary = getCurrentFilterSummary();
        } catch (err) {
            console.error('[downloadPanel] getCurrentFilterSummary() threw', err);
            setStatus('Failed to read current filters.', 'danger');
            return;
        }

        const backendFilters = buildBackendFiltersFromSummary(summary);
        pendingFilters = backendFilters;

        // If modal not available, fallback to direct behavior
        if (!modal || !modalCountEl || !modalFilters || !modalNoteEl || !modalConfirm) {
            console.warn('[downloadPanel] Modal not available, falling back to direct download');
            button.disabled = true;
            button.textContent = 'Downloading…';
            setStatus('Preparing file…', 'muted');
            try {
                await requestDownload(backendFilters, { compress: false });
                setStatus('Download started.', 'success');
            } catch (err) {
                console.error('[downloadPanel] download error', err);
                setStatus(err?.message || 'Download failed.', 'danger');
            } finally {
                button.disabled = false;
                button.textContent = 'Download';
            }
            return;
        }

        // Open modal immediately, show filters, show "counting" state
        setModalCountingState(summary);
        modal.show();

        setStatus('Counting matching landslides…', 'muted');
        button.disabled = true;
        button.textContent = 'Checking…';

        try {
            const count = await requestCount(backendFilters);
            setModalReadyState(count);
            setStatus('', 'muted');
        } catch (err) {
            console.error('[downloadPanel] count error', err);
            const msg = err?.message || 'Failed to count matching landslides.';
            setStatus(msg, 'danger');
            setModalErrorState(msg);
        } finally {
            button.disabled = false;
            button.textContent = 'Download';
        }
    });
}