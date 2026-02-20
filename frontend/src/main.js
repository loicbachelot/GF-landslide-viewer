import './style.css';
import './filter-panel/filters-panel.css';
import { startMapLibre } from './maplibre/viewer.js';
import { FiltersPanel } from './filter-panel/FiltersPanel.js';
import { applyLandslideFiltersFromObject } from './filter-panel/filters.js';
import './filter-panel/landslide-filters-config.js';
import { initSummaryPane } from './summary/summary.js';
import { initDetailsModal } from './summary/detailsModal.js';
import { initDownloadPanel } from './download/downloadPanel.js';
import { initLegend } from "./legend/legend.js";
import {setCurrentFilterSummary} from "./filter-panel/filterState.js";
import {styleIds} from "./maplibre/config.js";

// ---- defaults ----
const DEFAULT_NUMERIC_BOUNDS = {
    pga:   { min: 0,   max: 150, step: 0.1 },
    pgv:   { min: 0,   max: 150, step: 0.1 },
    psa03: { min: 0,   max: 300, step: 0.1 },
    mmi:   { min: 1,   max: 10,  step: 0.1 },
    rain:  { min: 0,   max: 5500,  step: 1 },
};

function adaptPanelConfig(lfc) {
    return {
        categorical: {
            material:   { label: lfc.categorical.material.summaryLabel,   options: lfc.categorical.material.options.map(o => o.label) },
            movement:   { label: lfc.categorical.movement.summaryLabel,   options: lfc.categorical.movement.options.map(o => o.label) },
            confidence: { label: lfc.categorical.confidence.summaryLabel, options: lfc.categorical.confidence.options.map(o => o.label) }
        },
        numeric: {
            pga:   { label: lfc.numericRanges.pga.label,   ...DEFAULT_NUMERIC_BOUNDS.pga   },
            pgv:   { label: lfc.numericRanges.pgv.label,   ...DEFAULT_NUMERIC_BOUNDS.pgv   },
            psa03: { label: lfc.numericRanges.psa03.label, ...DEFAULT_NUMERIC_BOUNDS.psa03 },
            mmi:   { label: lfc.numericRanges.mmi.label,   ...DEFAULT_NUMERIC_BOUNDS.mmi   },
            rain:  { label: lfc.numericRanges.rain.label,  ...DEFAULT_NUMERIC_BOUNDS.rain  },
        }
    };
}

function toMartinFilters(panelFilters, lfc) {
    return {
        categorical: {
            material:   panelFilters.categorical.material   || [],
            movement:   panelFilters.categorical.movement   || [],
            confidence: panelFilters.categorical.confidence || []
        },
        numeric: {
            pga:   { min: panelFilters.numeric.pga?.min   ?? null, max: panelFilters.numeric.pga?.max   ?? null, tol: lfc.numericRanges.pga.tolerance },
            pgv:   { min: panelFilters.numeric.pgv?.min   ?? null, max: panelFilters.numeric.pgv?.max   ?? null, tol: lfc.numericRanges.pgv.tolerance },
            psa03: { min: panelFilters.numeric.psa03?.min ?? null, max: panelFilters.numeric.psa03?.max ?? null, tol: lfc.numericRanges.psa03.tolerance },
            mmi:   { min: panelFilters.numeric.mmi?.min   ?? null, max: panelFilters.numeric.mmi?.max   ?? null, tol: lfc.numericRanges.mmi.tolerance },
            rain:  { min: panelFilters.numeric.rain?.min  ?? null, max: panelFilters.numeric.rain?.max  ?? null, tol: lfc.numericRanges.rain.tolerance }
        }
    };
}

let filtersPanel;

function initFiltersPanel(map) {
    const lfc = window.LandslideFilterConfig;
    const cfg = adaptPanelConfig(lfc);
    let currentMartinFilters = null;

    filtersPanel = new FiltersPanel(document.getElementById('filters-panel'), {
        categorical: cfg.categorical,
        numeric: cfg.numeric,
        onApply: (filters) => {
            const martinFilters = toMartinFilters(filters, lfc);

            // Save them for later (summary, download, etc.)
            setCurrentFilterSummary(martinFilters);
            applyLandslideFiltersFromObject(map, martinFilters);
        },
        onReset: () => {
            currentMartinFilters = null;
        }
    });
}

// Close accordions on landslide select:
window.addEventListener('ls:selected', () => {
    filtersPanel?.collapseAll();
});

function initSplitter(map) {
    const WIDTH_KEY = 'ls.lp.w';
    const root = document.documentElement;
    const gutter = document.getElementById('split-gutter');

    const css = getComputedStyle(root);
    const lpMin = parseFloat(css.getPropertyValue('--lp-min')) || 240;

    const getLpMaxPx = () => {
        const v = css.getPropertyValue('--lp-max').trim();
        if (v.endsWith('vw')) return (parseFloat(v) / 100) * window.innerWidth;
        if (v.endsWith('px')) return parseFloat(v);
        return 0.6 * window.innerWidth;
    };

    // restore saved width
    {
        const saved = parseFloat(localStorage.getItem(WIDTH_KEY));
        if (!isNaN(saved)) {
            const clamped = Math.min(Math.max(saved, lpMin), getLpMaxPx());
            root.style.setProperty('--lp-w', `${clamped}px`);
        }
    }

    let isDragging = false;
    let lastWidthPx = null;
    let rafId = null;

    const setLpWidth = (px) => {
        const clamped = Math.min(Math.max(px, lpMin), getLpMaxPx());
        if (clamped === lastWidthPx) return;
        lastWidthPx = clamped;
        root.style.setProperty('--lp-w', `${clamped}px`);
        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                try { map.resize(); } catch {}
            });
        }
    };

    const pointerX = (e) => (e.touches?.length ? e.touches[0].clientX : e.clientX);

    const onMove = (e) => { if (isDragging) { setLpWidth(pointerX(e)); e.preventDefault(); } };
    const onEnd  = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('is-resizing');
        if (lastWidthPx != null) localStorage.setItem(WIDTH_KEY, String(lastWidthPx));
        try { map.resize(); } catch {}
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove, { passive: false });
        window.removeEventListener('touchend', onEnd);
    };

    const startDrag = () => {
        isDragging = true;
        document.body.classList.add('is-resizing');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    };

    gutter.addEventListener('mousedown', startDrag);
    gutter.addEventListener('touchstart', startDrag, { passive: false });

    window.addEventListener('resize', () => {
        const current = parseFloat(getComputedStyle(root).getPropertyValue('--lp-w')) || 0;
        setLpWidth(Math.min(current, getLpMaxPx()));
    });
}

// ---- boot ----
const map = startMapLibre();
map.once('load', () => {
    initFiltersPanel(map);
    initSplitter(map);
    initDetailsModal();
    initLegend({
        map,
        defaultMode: "mmi",
        layerIds: {
            polysFill: styleIds.polysFill,
            pointsCircle: styleIds.pointsCircle
        }
    });
    if (typeof initSummaryPane === 'function') initSummaryPane(map);
    initDownloadPanel({
        container: 'download-panel',
        // map: map  <-- (optional, useful later for lasso)
    });
});
