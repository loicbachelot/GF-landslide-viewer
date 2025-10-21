let _map;

export function initSummaryPane(map) {
    _map = map;
    console.log('[summary] initialized (left-panel mode)');
}

export function showSelectedDetailsFromFeatureProps(props) {
    console.log('[summary] map click props:', props);
    const gid = props?.gid ?? props?.GID ?? props?.id;
    if (!gid) {
        console.warn('[summary] no gid/id found in feature props');
        return;
    }
    renderSelectedTable(props);
    // auto-collapse
    window.dispatchEvent(new CustomEvent('ls:selected', { detail: { gid } }));
}

function renderSelectedTable(obj) {
    const empty = document.getElementById('selected-empty');
    const table = document.getElementById('selected-table');
    const tbody = document.getElementById('selected-tbody');
    if (!tbody || !table || !empty) {
        console.error('[summary] missing #selected-* nodes');
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

    const preferred = ['gid','name','material','movement','confidence','area','length','pga','pgv','psa03','mmi','source','updated_at'];
    const done = new Set();

    const addRow = (label, value) => {
        const tr = document.createElement('tr');
        const k = document.createElement('td');
        const v = document.createElement('td');
        k.textContent = label.replace(/_/g,' ').replace(/\b\w/g, m => m.toUpperCase());
        if (typeof value === 'string' && /^https?:\/\/|^www\./i.test(value)) {
            const a = document.createElement('a'); a.href = value; a.target = '_blank'; a.rel = 'noopener'; a.textContent = value;
            v.appendChild(a);
        } else {
            v.textContent = String(value);
        }
        tr.append(k, v);
        tbody.appendChild(tr);
    };

    for (const key of preferred) if (obj[key] != null) { addRow(key, obj[key]); done.add(key); }

    const datasetLink = obj.dataset_link || obj.dataset_url || obj.details_url || obj.source_url || obj.url;
    if (datasetLink) addRow('dataset_link', datasetLink);

    Object.keys(obj).sort().forEach(k => {
        if (done.has(k)) return;
        const v = obj[k];
        if (v == null || typeof v === 'object') return;
        if (['dataset_link','dataset_url','details_url','source_url','url'].includes(k)) return;
        addRow(k, v);
    });

    console.log('[summary] details rendered for gid:', obj.gid ?? obj.GID ?? obj.id);
}