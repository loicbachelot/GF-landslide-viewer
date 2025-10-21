import './style.css';
import './filter-panel/filters-panel.css';
import { startMapLibre } from './maplibre/viewer.js';
import { FiltersPanel } from './filter-panel/FiltersPanel.js';
import { applyLandslideFiltersFromObject } from './filter-panel/filters.js';
import './filter-panel/landslide-filters-config.js';
import { initSummaryPane} from './summary/summary.js';


// ---- defaults (swap with real data bounds when ready) ----
const DEFAULT_NUMERIC_BOUNDS = {
    pga:   { min: 0,   max: 150, step: 0.1 },
    pgv:   { min: 0,   max: 150, step: 0.1 },
    psa03: { min: 0,   max: 300, step: 0.1 },
    mmi:   { min: 1,   max: 10,  step: 0.1 }
};

function setSidebarCollapsed(on) {
    document.body.classList.toggle('sidebar-collapsed', !!on);
    document.getElementById('lp-toggle')?.setAttribute('aria-expanded', (!on).toString());
    try { map.resize(); } catch {}
}
document.getElementById('lp-toggle')?.addEventListener('click', () => {
    setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
});
// auto-collapse when a landslide is selected
window.addEventListener('ls:selected', () => setSidebarCollapsed(true));

// Adapt LandslideFilterConfig -> FiltersPanel props
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
            mmi:   { label: lfc.numericRanges.mmi.label,   ...DEFAULT_NUMERIC_BOUNDS.mmi   }
        }
    };
}

// Convert panel filters -> server query shape (adds tolerances from LFC)
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
            mmi:   { min: panelFilters.numeric.mmi?.min   ?? null, max: panelFilters.numeric.mmi?.max   ?? null, tol: lfc.numericRanges.mmi.tolerance }
        }
    };
}

function initFiltersPanel(map) {
    const lfc = window.LandslideFilterConfig;
    const cfg = adaptPanelConfig(lfc);

    new FiltersPanel(document.getElementById('filters-panel'), {
        categorical: cfg.categorical,
        numeric: cfg.numeric,
        onApply: (filters) => {
            applyLandslideFiltersFromObject(map, toMartinFilters(filters, lfc));
        },
        onReset: () => {
            applyLandslideFiltersFromObject(map, { categorical: {}, numeric: {} });
            const url = new URL(window.location.href);
            url.search = '';
            history.replaceState({}, '', url.toString());
            renderFilterChips();
        }
    });
}

function initSplitter(map) {
    const SIDEBAR_KEY = 'ls.sidebar.w';
    const root = document.documentElement;
    const gutter = document.getElementById('split-gutter');

    const css = getComputedStyle(root);
    const sidebarMin = parseFloat(css.getPropertyValue('--sidebar-min')) || 240;

    const getSidebarMaxPx = () => {
        const v = css.getPropertyValue('--sidebar-max').trim();
        if (v.endsWith('vw')) return (parseFloat(v) / 100) * window.innerWidth;
        if (v.endsWith('px')) return parseFloat(v);
        return 0.6 * window.innerWidth;
    };

    // restore saved width
    {
        const saved = parseFloat(localStorage.getItem(SIDEBAR_KEY));
        if (!isNaN(saved)) {
            const clamped = Math.min(Math.max(saved, sidebarMin), getSidebarMaxPx());
            root.style.setProperty('--sidebar-w', `${clamped}px`);
        }
    }

    let isDragging = false;
    let lastWidthPx = null;
    let rafId = null;

    const setSidebarWidth = (px) => {
        const clamped = Math.min(Math.max(px, sidebarMin), getSidebarMaxPx());
        if (clamped === lastWidthPx) return;
        lastWidthPx = clamped;
        root.style.setProperty('--sidebar-w', `${clamped}px`);
        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                try { map.resize(); } catch {}
            });
        }
    };

    const pointerX = (e) => (e.touches?.length ? e.touches[0].clientX : e.clientX);

    const onMove = (e) => {
        if (!isDragging) return;
        setSidebarWidth(pointerX(e));
        e.preventDefault();
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('is-resizing');
        if (lastWidthPx != null) localStorage.setItem(SIDEBAR_KEY, String(lastWidthPx));
        try { map.resize(); } catch {}
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove, { passive: false });
        window.removeEventListener('touchend', onEnd);
    };

    gutter.addEventListener('mousedown', () => {
        isDragging = true;
        document.body.classList.add('is-resizing');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
    });

    gutter.addEventListener('touchstart', () => {
        isDragging = true;
        document.body.classList.add('is-resizing');
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    });

    window.addEventListener('resize', () => {
        const current = parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-w')) || 0;
        setSidebarWidth(Math.min(current, getSidebarMaxPx()));
    });
}

// ---- boot ----
const map = startMapLibre(); // returns Map
map.once('load', () => {
    initFiltersPanel(map);
    initSplitter(map);
    initSummaryPane(map);
});