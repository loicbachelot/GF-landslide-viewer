// src/download/downloadPanel.js

import { requestDownload } from './api.js';
import { getCurrentFiltersForSummary } from '../filter-panel/filters.js';

/**
 * Map the output of getCurrentFiltersForSummary()
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
    let root;
    if (typeof container === 'string') {
        root = document.getElementById(container);
    } else {
        root = container;
    }

    if (!root) {
        console.warn('[downloadPanel] Container not found');
        return;
    }

    // Build basic UI
    root.classList.add('download-panel');

    const title = document.createElement('h3');
    title.textContent = 'Download landslides';

    const description = document.createElement('p');
    description.textContent =
        'Download all landslides matching the current filters as GeoJSON.';

    const compressLabel = document.createElement('label');
    compressLabel.style.display = 'flex';
    compressLabel.style.alignItems = 'center';
    compressLabel.style.gap = '0.25rem';

    const compressCheckbox = document.createElement('input');
    compressCheckbox.type = 'checkbox';
    compressCheckbox.checked = false;

    const compressText = document.createElement('span');
    compressText.textContent = 'Compress as .zip';

    compressLabel.appendChild(compressCheckbox);
    compressLabel.appendChild(compressText);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Download';
    button.classList.add('download-button');

    const status = document.createElement('div');
    status.classList.add('download-status');
    status.style.fontSize = '0.85rem';
    status.style.marginTop = '0.25rem';

    root.appendChild(title);
    root.appendChild(description);
    root.appendChild(compressLabel);
    root.appendChild(button);
    root.appendChild(status);

    // Click handler
    button.addEventListener('click', async () => {
        let summaryFilters;
        try {
            summaryFilters = getCurrentFiltersForSummary();
        } catch (err) {
            console.error('[downloadPanel] getCurrentFiltersForSummary() threw', err);
            status.textContent = 'Failed to read current filters.';
            status.style.color = 'red';
            return;
        }

        console.log('[downloadPanel] summaryFilters:', summaryFilters);

        const backendFilters = buildBackendFiltersFromSummary(summaryFilters);

        console.log('[downloadPanel] backendFilters being sent:', backendFilters);

        button.disabled = true;
        button.textContent = 'Downloading...';
        status.textContent = 'Preparing file…';
        status.style.color = 'inherit';

        try {
            await requestDownload(backendFilters, { compress: compressCheckbox.checked });
            status.textContent = 'Download started.';
            status.style.color = 'green';
        } catch (err) {
            console.error('[downloadPanel] download error', err);
            status.textContent = err.message || 'Download failed.';
            status.style.color = 'red';
        } finally {
            button.disabled = false;
            button.textContent = 'Download';
        }
    });
}
