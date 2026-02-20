const NA_COLOR = "#9ca3af";

function hashStringToHue(str) {
    // Simple stable hash -> 0..359 hue
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 360;
}

function colorForLabel(label) {
    const hue = hashStringToHue(label);
    // pleasant, readable swatches
    return `hsl(${hue}, 65%, 55%)`;
}

function buildGradientCSS() {
    // neutral but useful default ramp
    return "linear-gradient(90deg, hsl(210, 70%, 60%), hsl(60, 90%, 60%), hsl(0, 80%, 60%))";
}

function getNumericBounds(key) {
    // Prefer your existing DEFAULT_NUMERIC_BOUNDS if it exists globally
    const b = window.DEFAULT_NUMERIC_BOUNDS?.[key];
    if (b) return {min: b.min, max: b.max};

    // Otherwise, try to infer something reasonable (fallback)
    const fallback = {
        pga: {min: 0, max: 150},
        pgv: {min: 0, max: 150},
        psa03: {min: 0, max: 300},
        mmi: {min: 1, max: 10},
        rain: {min: 0, max: 5500},
    };
    return fallback[key] || {min: 0, max: 100};
}

function renderCategoricalLegend(bodyEl, options, compact) {
    const wrap = document.createElement("div");
    wrap.className = "ls-legend-items" + (compact ? "" : " is-wide");

    for (const opt of options) {
        const label = opt.label;

        const row = document.createElement("div");
        row.className = "ls-legend-item";

        const sw = document.createElement("span");
        sw.className = "ls-legend-swatch";
        sw.style.background = colorForLabel(label);

        const lab = document.createElement("span");
        lab.textContent = label;

        row.appendChild(sw);
        row.appendChild(lab);
        wrap.appendChild(row);
    }

// Always add NA at the end
    const naRow = document.createElement("div");
    naRow.className = "ls-legend-item";

    const naSw = document.createElement("span");
    naSw.className = "ls-legend-swatch";
    naSw.style.background = NA_COLOR;

    const naLab = document.createElement("span");
    naLab.textContent = "NA";

    naRow.appendChild(naSw);
    naRow.appendChild(naLab);
    wrap.appendChild(naRow);

    bodyEl.innerHTML = "";
    bodyEl.appendChild(wrap);
}

function renderNumericLegend(bodyEl, key, meta) {
    const {min, max} = getNumericBounds(key);

    const container = document.createElement("div");
    container.className = "legend-gradient-container";

    const grad = document.createElement("div");
    grad.className = "legend-gradient";
    grad.style.background = buildGradientCSS();

    const labels = document.createElement("div");
    labels.className = "legend-labels";

    const mk = (txt) => {
        const s = document.createElement("span");
        s.textContent = txt;
        return s;
    };

    // 4 ticks like your depth legend style
    const q1 = min + (max - min) * 0.33;
    const q2 = min + (max - min) * 0.66;

    const unit = meta?.unit ? ` ${meta.unit}` : "";
    labels.appendChild(mk(`${min}`));
    labels.appendChild(mk(`${Math.round(q1 * 10) / 10}`));
    labels.appendChild(mk(`${Math.round(q2 * 10) / 10}`));
    labels.appendChild(mk(`${max}`));

    container.appendChild(grad);
    container.appendChild(labels);

    bodyEl.innerHTML = "";
    bodyEl.appendChild(container);
}

function getFeatureValueExpr(key) {
    // Coalesce to empty string so 'match' doesn't explode on null
    return ["to-string", ["coalesce", ["get", key], ""]];
}

function buildCategoricalColorExpr(modeKey, options) {
    const input = ["to-string", ["coalesce", ["get", modeKey], ""]];

    const expr = ["match", input];
    const seen = new Set();

    function addLabel(label, color) {
        const key = String(label);
        if (seen.has(key)) return;
        seen.add(key);
        expr.push(key, color);
    }

    for (const opt of options) {
        const label = opt.label;
        const color = colorForLabel(label);

        addLabel(label, color);

        if (Array.isArray(opt.matchValues)) {
            for (const v of opt.matchValues) {
                addLabel(v, color);
            }
        }
    }

    // Explicit NA handling (only add if not already used)
    addLabel("", NA_COLOR);
    addLabel("NA", NA_COLOR);
    addLabel("null", NA_COLOR);

    // Final fallback
    expr.push(NA_COLOR);

    return expr;
}

function buildNumericColorExpr(modeKey) {
    const {min, max} = getNumericBounds(modeKey);
    const mid = min + (max - min) * 0.5;

    // numeric input, safe coercion
    const v = ["to-number", ["coalesce", ["get", modeKey], min]];

    // 3-stop ramp that matches your legend-ish vibe
    return [
        "interpolate",
        ["linear"],
        v,
        min, "hsl(210, 70%, 60%)",
        mid, "hsl(60, 90%, 60%)",
        max, "hsl(0, 80%, 60%)"
    ];
}

function withSelectedHighlight(baseColorExpr, selectedColor = "rgba(46,111,244,0.95)") {
    // Keep selected features visually obvious
    return [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        selectedColor,
        baseColorExpr
    ];
}

export function initLegend({map, defaultMode, layerIds} = {}) {
    const cfg = window.LandslideFilterConfig;
    if (!cfg) {
        console.warn("[legend] window.LandslideFilterConfig missing (import landslide-filters-config.js before legend init)");
        return;
    }

    const legend = document.getElementById("ls-legend");
    const titleEl = document.getElementById("ls-legend-title");
    const bodyEl = document.getElementById("ls-legend-body");

    const settingsBtn = document.getElementById("ls-legend-settings-btn");
    const settingsPanel = document.getElementById("ls-legend-settings-panel");
    const modeSelect = document.getElementById("ls-legend-mode");
    const compactChk = document.getElementById("ls-legend-compact");

    const opacitySlider = document.getElementById("ls-legend-opacity");
    const opacityVal = document.getElementById("ls-legend-opacity-val");

    if (!legend || !titleEl || !bodyEl || !settingsBtn || !settingsPanel || !modeSelect) {
        console.warn("[legend] Missing legend DOM nodes");
        return;
    }

    // --- Legend open/close toggle wiring ---
    const toggleBtn = document.getElementById("ls-toggle-legend");
    if (!toggleBtn) {
        console.warn("[legend] Missing #ls-toggle-legend button");
    } else {
        // Default open/closed (desktop open, mobile closed)
        if (!legend.classList.contains("is-open") && !legend.classList.contains("is-closed")) {
            if (window.innerWidth <= 760) {
                legend.classList.add("is-closed");
            } else {
                legend.classList.add("is-open");
            }
        }

        toggleBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const wasOpen = legend.classList.contains("is-open");

            legend.classList.toggle("is-open", !wasOpen);
            legend.classList.toggle("is-closed", wasOpen);

            toggleBtn.classList.toggle("is-active", !wasOpen);

            // If closing legend, also close settings
            if (wasOpen) settingsPanel.classList.remove("is-open");
        });
    }

    // --- drag positioning ----
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function enableLegendDragging() {
        const handle = legend.querySelector(".legend-header-row");
        if (!handle) return;

        const STORAGE_KEY = "lsLegendPosV1";

        // Restore position if previously dragged
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
                legend.classList.add("is-dragged");
                legend.style.left = `${saved.left}px`;
                legend.style.top = `${saved.top}px`;
            }
        } catch {}

        let dragging = false;
        let startX = 0, startY = 0;
        let startLeft = 0, startTop = 0;

        const getPoint = (e) => {
            if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        };

        const onDown = (e) => {
            // Don’t start drag when clicking the cog or interacting with controls
            const target = e.target;
            if (target.closest(".legend-settings-btn") || target.closest("select") || target.closest("input") || target.closest("button")) {
                return;
            }

            dragging = true;
            const p = getPoint(e);

            // Convert from centered default to explicit coords on first drag
            if (!legend.classList.contains("is-dragged")) {
                const rect = legend.getBoundingClientRect();
                legend.classList.add("is-dragged");
                legend.style.left = `${rect.left}px`;
                legend.style.top = `${rect.top}px`;
            }

            const rect = legend.getBoundingClientRect();
            startX = p.x;
            startY = p.y;
            startLeft = rect.left;
            startTop = rect.top;

            e.preventDefault();
        };

        const onMove = (e) => {
            if (!dragging) return;
            const p = getPoint(e);

            const dx = p.x - startX;
            const dy = p.y - startY;

            const rect = legend.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;

            const maxLeft = window.innerWidth - w;
            const maxTop = window.innerHeight - h;

            const left = clamp(startLeft + dx, 8, maxLeft - 8);
            const top = clamp(startTop + dy, 8, maxTop - 8);

            legend.style.left = `${left}px`;
            legend.style.top = `${top}px`;

            // Prevent page scroll while dragging on touch
            if (e.cancelable) e.preventDefault();
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;

            // Persist
            const rect = legend.getBoundingClientRect();
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
            } catch {}
        };

        handle.addEventListener("mousedown", onDown);
        handle.addEventListener("touchstart", onDown, { passive: false });

        window.addEventListener("mousemove", onMove);
        window.addEventListener("touchmove", onMove, { passive: false });

        window.addEventListener("mouseup", onUp);
        window.addEventListener("touchend", onUp);
    }

    enableLegendDragging();

    // ---- Build dropdown options from config ----
    // Order: categorical first, then numeric
    const modes = [];

    for (const [key, cat] of Object.entries(cfg.categorical || {})) {
        modes.push({
            key,
            type: "categorical",
            title: cat.summaryLabel || key,
            options: cat.options || [],
        });
    }

    for (const [key, num] of Object.entries(cfg.numericRanges || {})) {
        modes.push({
            key,
            type: "numeric",
            title: num.label || key,
            unit: num.unit || "",
            meta: num,
        });
    }

    // Fill dropdown
    modeSelect.innerHTML = "";
    for (const m of modes) {
        const opt = document.createElement("option");
        opt.value = m.key;
        opt.textContent = m.title;
        modeSelect.appendChild(opt);
    }

    // Default mode: prefer provided, else first categorical, else first overall
    const defaultKey =
        defaultMode ||
        modes.find((m) => m.type === "categorical")?.key ||
        modes[0]?.key;

    // Gear toggles settings panel
    settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        settingsPanel.classList.toggle("is-open");
    });
    document.addEventListener("click", () => settingsPanel.classList.remove("is-open"));
    settingsPanel.addEventListener("click", (e) => e.stopPropagation());

    let userOpacity = 0.40; // default polygons
    let userPointOpacity = 0.85; // default points

    function setOpacityFromUI() {
        if (!opacitySlider) return;
        const v = Number(opacitySlider.value);
        userOpacity = Math.min(1, Math.max(0, v / 100));
        userPointOpacity = userOpacity;
        if (opacityVal) opacityVal.textContent = `${v}%`;
    }

    function applyToMap(modeKey) {
        if (!map) return;

        const m = modes.find((x) => x.key === modeKey);
        if (!m) return;

        // Build base color expression from config-driven modes
        let baseExpr;
        if (m.type === "categorical") {
            baseExpr = buildCategoricalColorExpr(m.key, m.options);
        } else {
            baseExpr = buildNumericColorExpr(m.key);
        }

        const colorExpr = withSelectedHighlight(baseExpr);

        // IMPORTANT: pass these layer IDs in initLegend({ layerIds: ... })
        // so legend.js doesn't import your style module.

        try {
            const polyLayerId = layerIds?.polysFill;
            const ptLayerId = layerIds?.pointsCircle;

            if (polyLayerId && map.getLayer(polyLayerId)) {
                map.setPaintProperty(polyLayerId, "fill-color", colorExpr);
                map.setPaintProperty(polyLayerId, "fill-opacity", [
                    "case",
                    ["boolean", ["feature-state", "selected"], false],
                    Math.min(1, userOpacity + 0.35), // selected pops
                    userOpacity
                ]);
            }

            if (ptLayerId && map.getLayer(ptLayerId)) {
                map.setPaintProperty(ptLayerId, "circle-color", colorExpr);
                map.setPaintProperty(ptLayerId, "circle-opacity", [
                    "case",
                    ["boolean", ["feature-state", "selected"], false],
                    1.0,
                    userPointOpacity
                ]);
            }
        } catch (e) {
            console.warn("[legend] opacity update failed:", e);
        }
    }

    function setMode(modeKey) {
        const m = modes.find((x) => x.key === modeKey) || modes[0];
        if (!m) return;

        titleEl.textContent = m.title;

        const compact = compactChk ? compactChk.checked : true;
        legend.classList.toggle("is-wide", !compact);


        if (m.type === "categorical") {
            renderCategoricalLegend(bodyEl, m.options, compact);
        } else {
            renderNumericLegend(bodyEl, m.key, m.meta);
        }

        applyToMap(m.key);
    }

    modeSelect.value = defaultKey;
    modeSelect.addEventListener("change", () => setMode(modeSelect.value));
    if (compactChk) compactChk.addEventListener("change", () => setMode(modeSelect.value));

    // Init slider + listen
    if (opacitySlider) {
        // Set initial display
        setOpacityFromUI();

        opacitySlider.addEventListener("input", () => {
            setOpacityFromUI();
            // Re-apply current mode to update opacity immediately
            applyToMap(modeSelect.value);
        });
    }

    setMode(defaultKey);
}