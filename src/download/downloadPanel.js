// src/download/downloadPanel.js

import { requestDownload } from './api.js';
import { getCurrentFilterSummary } from '../filter-panel/filterState.js';

/**
 * Map the output of getCurrentFilterSummary()
 * into the backend Filters model expected by FastAPI.
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
        // Categorical arrays (backend treats [] as "no filter")
        materials:   cat.material   ?? [],
        movements:   cat.movement   ?? [],
        confidences: cat.confidence ?? [],

        // Numeric ranges + tolerances
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

        // No selection geometry yet — lasso/box will fill this later
        selection_geojson: null,
    };
}

/**
 * Initialize the download panel UI.
 *
 * @param {object} options
 * @param {HTMLElement|string} options.container - DOM element or element id where the panel will be mounted
 */
export function initDownloadPanel({ container }) {
    const mountEl = (typeof container === 'string')
        ? document.getElementById(container)
        : container;

    if (!mountEl) {
        console.warn('[downloadPanel] Container not found');
        return;
    }

    // --- Layout: match FiltersPanel card style ---
    const wrap = document.createElement('div');
    wrap.className = 'download card shadow-sm';

    wrap.innerHTML = `
      <div class="card-body p-2">
        <h5 class="card-title mb-2">Download landslides</h5>
        <p class="card-text small mb-2">
          Download all landslides matching the current applied filters as GeoJSON.
        </p>

        <div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="downloadCompress">
          <label class="form-check-label small" for="downloadCompress">
            Compress as .zip
          </label>
        </div>

        <button type="button"
                class="btn btn-primary btn-sm w-100"
                id="downloadBtn">
          Download
        </button>

        <div class="small mt-1" id="downloadStatus"></div>
      </div>
    `;

    mountEl.innerHTML = '';
    mountEl.appendChild(wrap);

    const compressCheckbox = wrap.querySelector('#downloadCompress');
    const button = wrap.querySelector('#downloadBtn');
    const status = wrap.querySelector('#downloadStatus');

    const setStatus = (message, type = 'muted') => {
        status.textContent = message || '';
        status.classList.remove('text-success', 'text-danger', 'text-muted');

        if (!message) return;

        if (type === 'success') {
            status.classList.add('text-success');
        } else if (type === 'error') {
            status.classList.add('text-danger');
        } else {
            status.classList.add('text-muted');
        }
    };

    // --- Click handler ---
    button.addEventListener('click', async () => {
        let summaryFilters;
        try {
            summaryFilters = getCurrentFilterSummary();
        } catch (err) {
            console.error('[downloadPanel] getCurrentFilterSummary() threw', err);
            setStatus('Failed to read current filters.', 'error');
            return;
        }

        console.log('[downloadPanel] summaryFilters:', summaryFilters);

        const backendFilters = buildBackendFiltersFromSummary(summaryFilters);

        console.log('[downloadPanel] backendFilters being sent:', backendFilters);

        button.disabled = true;
        button.textContent = 'Downloading…';
        setStatus('Preparing file…', 'muted');

        try {
            await requestDownload(backendFilters, { compress: compressCheckbox.checked });
            setStatus('Download started.', 'success');
        } catch (err) {
            console.error('[downloadPanel] download error', err);
            setStatus(err?.message || 'Download failed.', 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Download';
        }
    });
}
