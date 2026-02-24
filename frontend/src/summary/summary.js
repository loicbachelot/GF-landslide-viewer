let _map;

export function initSummaryPane(map) {
    _map = map;
    console.log('[summary] initialized (left-panel mode)');
}

export function showSelectedDetailsFromFeatureProps(props) {
    console.log('[summary] map click props:', props);
    const gid = props?.gid ?? props?.GID ?? props?.id ?? props?.viewer_id;
    if (!gid) {
        console.warn('[summary] no gid/id found in feature props');
        return;
    }
    renderSelectedTable(props);
    // auto-collapse
    window.dispatchEvent(new CustomEvent('ls:selected', { detail: { gid } }));
}

export const numericRanges = {
    pga:   { elementId: 'pgaRange',   label: 'PGA (%g)',      unit: '%g',  tolerance: 0.1 },
    pgv:   { elementId: 'pgvRange',   label: 'PGV (cm/s)',    unit: 'cm/s',tolerance: 0.1 },
    psa03: { elementId: 'psa03Range', label: 'PSA 0.3s (%g)', unit: '%g',  tolerance: 0.1 },
    mmi:   { elementId: 'mmiRange',   label: 'MMI',           unit: '',    tolerance: 0.05 },
    rainfall:  { elementId: 'rainRange',   label: 'Annual rain (mm)',  unit: 'mm/year',  tolerance: 0.1 }
};

function renderSelectedTable(obj) {
    const empty = document.getElementById('selected-empty');
    const table = document.getElementById('selected-table');
    const tbody = document.getElementById('selected-tbody');
    if (!tbody || !table || !empty) {
        return;
    }

    tbody.innerHTML = '';
    if (!obj) {
        empty.classList.remove('d-none');
        table.classList.add('d-none');
        return;
    }

    empty.classList.add('d-none');
    table.classList.remove('d-none');

    const preferred = [
        'viewer_id','material','movement','confidence',
        'pga','pgv','psa03','mmi','rain', 'source', 'reference'
    ];
    const done = new Set();

    const addRow = (label, value) => {
        const tr = document.createElement('tr');
        const k = document.createElement('td');
        const v = document.createElement('td');

        k.textContent = label.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

        const unit = numericRanges[label]?.unit || '';

        let displayValue;
        if (typeof value === 'number') {
            const rounded = Math.round(value * 100) / 100;
            const pretty = rounded.toString();
            displayValue = unit ? `${pretty} ${unit}` : pretty;
        } else {
            displayValue = String(value);
        }

        if (typeof value === 'string' && /^https?:\/\/|^www\./i.test(value)) {
            const a = document.createElement('a');
            a.href = value;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = value;
            v.appendChild(a);
        } else {
            v.textContent = displayValue;
        }

        tr.append(k, v);
        tbody.appendChild(tr);
    };

    for (const key of preferred)
        if (obj[key] != null) {
            addRow(key, obj[key]);
            done.add(key);
        }

    const datasetLink = obj.dataset_link || obj.dataset_url || obj.details_url || obj.source_url || obj.url;
    if (datasetLink) addRow('dataset_link', datasetLink);

    Object.keys(obj).sort().forEach(k => {
        if (done.has(k)) return;
        const v = obj[k];
        if (v == null || typeof v === 'object') return;
        if (['dataset_link','dataset_url','details_url','source_url','url'].includes(k)) return;
        addRow(k, v);
    });

}

export function formatSummaryValue(key, value, { decimalsDefault = 2 } = {}) {
    if (value == null || value === "") return "—";

    const unit = numericRanges[key]?.unit || "";

    if (typeof value === "number" && Number.isFinite(value)) {
        // you currently hard-round to 2 decimals everywhere in the table:
        const rounded = Math.round(value * (10 ** decimalsDefault)) / (10 ** decimalsDefault);
        const pretty = rounded.toString();
        return unit ? `${pretty} ${unit}` : pretty;
    }

    // strings, booleans, etc
    return String(value);
}