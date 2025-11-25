export class FiltersPanel {
    /**
     * @param {HTMLElement} mountEl
     * @param {{
     *   categorical: Record<string,{label:string, options:string[]}>,
     *   numeric: Record<string,{label:string,min:number,max:number,step:number,initialMin?:number,initialMax?:number}>,
     *   onApply: (filters)=>void,
     *   onReset?: ()=>void
     * }} config
     */
    constructor(mountEl, config) {
        this.mountEl = mountEl;
        this.config = config;
        this._sections = {}; // <-- store accordion section refs
        this._render();
    }

    _render() {
        const wrap = document.createElement('div');
        wrap.className = 'filters card shadow-sm';
        wrap.innerHTML = `
      <div class="card-body p-2">
        <h5 class="card-title mb-2">Filters</h5>
        <div class="accordion accordion-flush" id="filtersAccordion"></div>
        <div class="d-flex gap-2 mt-2">
          <button type="button" class="btn btn-primary flex-fill" id="applyFiltersBtn">Apply</button>
          <button type="button" class="btn btn-outline-secondary flex-fill" id="resetFiltersBtn">Reset</button>
        </div>
      </div>
    `;

        const acc = wrap.querySelector('#filtersAccordion');

        // Categorical
        if (this.config.categorical && Object.keys(this.config.categorical).length) {
            const content = this._renderCategoricalSection();
            acc.appendChild(this._accordionItem('cat', 'Categories', content));
        }

        // Numeric
        if (this.config.numeric && Object.keys(this.config.numeric).length) {
            const content = this._renderNumericSection();
            acc.appendChild(this._accordionItem('num', 'Numerical Ranges', content));
        }

        this.mountEl.innerHTML = '';
        this.mountEl.appendChild(wrap);

        // Buttons
        wrap.querySelector('#applyFiltersBtn').addEventListener('click', () => {
            this.config.onApply?.(this.getFilters());
        });

        wrap.querySelector('#resetFiltersBtn').addEventListener('click', () => {
            this.reset();
            this.expandAll();            // <--- OPEN all accordions on Reset
            this.config.onReset?.();
        });
    }

    _acordionIdCounter = 0;

    _acordionUid(prefix) {
        this._acordionIdCounter = (this._acordionIdCounter || 0) + 1;
        return `${prefix}-${this._acordionIdCounter}`;
    }

    _accordionItem(idBase, title, content) {
        const headingId = this._acordionUid(`heading-${idBase}`);
        const collapseId = this._acordionUid(`collapse-${idBase}`);

        const item = document.createElement('div');
        item.className = 'accordion-item';
        item.innerHTML = `
      <h2 class="accordion-header" id="${headingId}">
        <button class="accordion-button py-2" type="button"
                data-bs-toggle="collapse"
                data-bs-target="#${collapseId}"
                aria-expanded="true"
                aria-controls="${collapseId}">
          ${title}
        </button>
      </h2>
      <div id="${collapseId}" class="accordion-collapse collapse show" aria-labelledby="${headingId}">
        <div class="accordion-body"></div>
      </div>
    `;

        const body = item.querySelector('.accordion-body');
        body.appendChild(content);

        // Keep references to control later
        const collapseEl = item.querySelector(`#${collapseId}`);
        const buttonEl = item.querySelector('.accordion-button');

        // If Bootstrap JS is present, create a Collapse instance (no auto toggle)
        const bs = (window.bootstrap && window.bootstrap.Collapse)
            ? new window.bootstrap.Collapse(collapseEl, { toggle: false })
            : null;

        this._sections[idBase] = { item, buttonEl, collapseEl, bs };

        return item;
    }

    _renderCategoricalSection() {
        const section = document.createElement('div');
        section.className = 'vstack gap-3';

        for (const [key, {label, options}] of Object.entries(this.config.categorical)) {
            const group = document.createElement('div');
            group.className = 'mb-1';
            group.dataset.key = key;
            group.innerHTML = `<label class="form-label fw-semibold">${label}</label>`;

            const grid = document.createElement('div');
            grid.className = 'row row-cols-2 g-1';
            options.forEach((opt, i) => {
                const col = document.createElement('div');
                col.className = 'col';
                const id = `${key}__${i}`;
                col.innerHTML = `
          <div class="form-check">
            <input class="form-check-input" type="checkbox" value="${opt}" id="${id}">
            <label class="form-check-label" style="font-size: 14px" for="${id}">${opt}</label>
          </div>
        `;
                grid.appendChild(col);
            });

            group.appendChild(grid);
            section.appendChild(group);
        }
        return section;
    }

    _renderNumericSection() {
        const section = document.createElement('div');
        section.className = 'vstack gap-3';
        this._noUi = this._noUi || {};

        for (const [key, cfg] of Object.entries(this.config.numeric)) {
            const { label, min, max, step, initialMin = min, initialMax = max } = cfg;

            const group = document.createElement('div');
            group.className = 'mb-0';
            group.dataset.key = key;
            group.innerHTML = `
        <label class="form-label fw-semibold" style="font-size: 14px">${label}</label>
        <div id="ns_${key}" class="mb-2 slider-round"></div>
        <div class="row gx-2">
          <div class="col">
            <input type="number" class="form-control form-control-sm"
                   placeholder="Min" step="${step}" min="${min}" max="${max}">
          </div>
          <div class="col">
            <input type="number" class="form-control form-control-sm"
                   placeholder="Max" step="${step}" min="${min}" max="${max}">
          </div>
        </div>
      `;
            section.appendChild(group);

            const sliderEl = group.querySelector(`#ns_${key}`);
            const numInputs = group.querySelectorAll('input[type="number"]');
            const numMin = numInputs[0];
            const numMax = numInputs[1];

            (noUiSlider || window.noUiSlider).create(sliderEl, {
                start: [initialMin, initialMax],
                connect: true,
                range: { min, max },
                step,
                format: { to: v => v, from: v => parseFloat(v) }
            });

            const decimals = step < 1 ? (String(step).split('.')[1]?.length || 1) : 0;
            const slider = sliderEl.noUiSlider;

            slider.on('update', (vals) => {
                const [lo, hi] = vals.map(parseFloat);
                numMin.value = lo.toFixed(decimals);
                numMax.value = hi.toFixed(decimals);
            });

            const syncFromBoxes = () => {
                const lo = parseFloat(numMin.value);
                const hi = parseFloat(numMax.value);
                if (!isNaN(lo) && !isNaN(hi)) slider.set([lo, hi]);
            };
            numMin.addEventListener('change', syncFromBoxes);
            numMax.addEventListener('change', syncFromBoxes);

            this._noUi[key] = { slider, cfg, numMin, numMax };
        }

        return section;
    }

    // ---- Public API ----

    /** Collapse all accordion sections */
    collapseAll() {
        for (const sec of Object.values(this._sections)) {
            if (sec.bs) {
                sec.bs.hide();
            } else {
                sec.collapseEl.classList.remove('show');
                sec.buttonEl.setAttribute('aria-expanded', 'false');
            }
        }
    }

    /** Expand all accordion sections */
    expandAll() {
        for (const sec of Object.values(this._sections)) {
            if (sec.bs) {
                sec.bs.show();
            } else {
                sec.collapseEl.classList.add('show');
                sec.buttonEl.setAttribute('aria-expanded', 'true');
            }
        }
    }

    getFilters() {
        const out = { categorical: {}, numeric: {} };

        for (const [key] of Object.entries(this.config.categorical || {})) {
            const group = this.mountEl.querySelector(`.accordion-body [data-key="${key}"]`);
            if (!group) continue;
            const vals = Array.from(group.querySelectorAll('.form-check-input:checked')).map(i => i.value);
            if (vals.length) out.categorical[key] = vals;
        }

        for (const [key, obj] of Object.entries(this._noUi || {})) {
            const { slider, cfg } = obj;
            const [lo, hi] = slider.get().map(parseFloat);
            const isFull = lo <= cfg.min && hi >= cfg.max;
            if (!isFull) out.numeric[key] = { min: lo, max: hi };
        }

        return out;
    }

    reset() {
        // categorical
        this.mountEl.querySelectorAll('.form-check-input').forEach(cb => (cb.checked = false));
        // numeric -> back to full extent
        for (const [key, obj] of Object.entries(this._noUi || {})) {
            const { slider, cfg } = obj;
            slider.set([cfg.min, cfg.max]);
        }
        queueMicrotask(() => {
            this.config.onApply?.(this.getFilters());
        });
    }
}