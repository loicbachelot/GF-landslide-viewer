import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {INITIAL_VIEW, styleIds, Z_RAW_POLYS, Z_RAW_POINTS, CFM_URLS} from './config.js';
import {addBasemap} from './baselayer.js';
import {addVectorSources, addPolygonLayers, addPointLayers} from './layers.js';

import {showSelectedDetailsFromFeatureProps} from '../summary/summary.js';

import {initFaultOverlay, initPgaOverlay, setFaultsVisible, setPgaVisible} from './overlay.js';


function baseStyle() {
    const style = {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {},
        layers: []
    };
    addBasemap(style);
    addVectorSources(style);
    addPolygonLayers(style);
    addPointLayers(style);
    return style;
}

function popupHTML(props) {
    // // Support both polygon and point clusters
    // if ('poly_count' in (props || {})) return `<b>Cluster</b><br/>Count: ${props.poly_count}`;
    // if ('pt_count'   in (props || {})) return `<b>Cluster</b><br/>Count: ${props.pt_count}`;

    const fields = ['gid', 'material', 'movement', 'confidence', 'pga', 'pgv', 'psa03', 'mmi'];
    const rows = fields
        .filter(k => k in (props || {}))
        .map(k => `<div><b>${k}</b>: ${props[k]}</div>`)
        .join('');
    return `<div style="font:12px/1.35 sans-serif"><b>Landslide</b>${rows ? '<hr/>' + rows : ''}</div>`;
}

function ensureFaultsToggle() {
    let el = document.getElementById('toggleFaults');
    if (el) return el;

    // Create a simple control and append to filters wrapper
    const wrapper = document.getElementById('filters-wrapper') || document.body;
    const label = document.createElement('label');
    label.className = 'form-check';
    label.style.display = 'block';
    label.style.margin = '8px 0';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'toggleFaults';
    input.className = 'form-check-input';
    input.checked = true;

    const span = document.createElement('span');
    span.className = 'form-check-label';
    span.textContent = 'CFM fault overlay';

    label.appendChild(input);
    label.appendChild(span);
    wrapper.appendChild(label);
    return input;
}

/** Create and return the MapLibre map. No filter/apply logic here. */
export function startMapLibre() {
    let div = document.getElementById('map');
    if (!div) {
        div = document.createElement('div');
        div.id = 'map';
        document.body.appendChild(div);
    }

    const map = new maplibregl.Map({
        container: 'map',
        style: baseStyle(),
        center: INITIAL_VIEW.center,
        zoom: INITIAL_VIEW.zoom
    });

    // Controls
    map.addControl(new maplibregl.NavigationControl({showCompass: true}), 'top-right');
    map.addControl(new maplibregl.ScaleControl({maxWidth: 120, unit: 'metric'}));

    // =========================
    // Interactions: POLY CLUSTERS
    // =========================
    map.on('click', styleIds.polysCluster, e => {
        const f = e.features?.[0];
        if (!f) return;
        map.easeTo({
            center: e.lngLat, zoom: Math.min(map.getZoom() + 2, Z_RAW_POLYS), duration: 1000
        });
    });
    map.on('mouseenter', styleIds.polysCluster, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.polysCluster, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: RAW POLYGONS
    // =========================
    map.on('click', styleIds.polysFill, e => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHTML(f.properties || {})).addTo(map);
        showSelectedDetailsFromFeatureProps(f.properties || {});
    });
    map.on('mouseenter', styleIds.polysFill, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.polysFill, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: POINT CLUSTERS
    // =========================
    map.on('click', styleIds.pointsCluster, e => {
        const f = e.features?.[0];
        if (!f) return;
        map.easeTo({
            center: e.lngLat, zoom: Math.min(map.getZoom() + 2, Z_RAW_POINTS), duration: 1000
        });
    });
    map.on('mouseenter', styleIds.pointsCluster, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.pointsCluster, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: RAW POINTS
    // =========================
    map.on('click', styleIds.pointsCircle, e => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHTML(f.properties || {})).addTo(map);
        showSelectedDetailsFromFeatureProps(f.properties || {});
    });
    map.on('mouseenter', styleIds.pointsCircle, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.pointsCircle, () => (map.getCanvas().style.cursor = ''));

    // Optional zoom indicator
    map.on('load', () => {
        const zoomBox = document.createElement('div');
        zoomBox.className = 'zoom-box';
        zoomBox.textContent = `Zoom: ${map.getZoom().toFixed(2)}`;
        map.getContainer().appendChild(zoomBox);
        const updateZoom = () => {
            zoomBox.textContent = `Zoom: ${map.getZoom().toFixed(2)}`;
        };
        map.on('zoom', updateZoom);
        map.on('moveend', updateZoom);
    });

    map.on('load', async () => {
        // =========== Initialize CFM overlay ===========
        await initFaultOverlay(map, CFM_URLS, {initialVisibility: 'visible'});
        const PGA_URL = new URL('../resources/pga_contours.json', import.meta.url).href;
        await initPgaOverlay(map, PGA_URL);

        class OverlayToggleControl {
            onAdd(map) {
                this._map = map;
                const container = document.createElement('div');
                container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                container.style.background = 'white';
                container.style.padding = '6px 8px';
                container.style.fontSize = '12px';
                container.style.lineHeight = '16px';

                // --- Faults ---
                const faultBox = document.createElement('div');
                faultBox.style.display = 'flex';
                faultBox.style.alignItems = 'center';
                const faultCheck = document.createElement('input');
                faultCheck.type = 'checkbox';
                faultCheck.id = 'toggleFaults';
                faultCheck.checked = true;
                faultCheck.style.marginRight = '4px';
                const faultLabel = document.createElement('label');
                faultLabel.textContent = 'Faults';
                faultLabel.htmlFor = 'toggleFaults';
                faultBox.appendChild(faultCheck);
                faultBox.appendChild(faultLabel);

                // --- PGA ---
                const pgaBox = document.createElement('div');
                pgaBox.style.display = 'flex';
                pgaBox.style.alignItems = 'center';
                const pgaCheck = document.createElement('input');
                pgaCheck.type = 'checkbox';
                pgaCheck.id = 'togglePga';
                pgaCheck.checked = true;
                pgaCheck.style.marginRight = '4px';
                const pgaLabel = document.createElement('label');
                pgaLabel.textContent = 'PGA (USGS M9)';
                pgaLabel.htmlFor = 'togglePga';
                pgaBox.appendChild(pgaCheck);
                pgaBox.appendChild(pgaLabel);

                container.appendChild(faultBox);
                container.appendChild(pgaBox);

                // Handlers
                faultCheck.addEventListener('change', (e) => {
                    setFaultsVisible(this._map, e.target.checked);
                });
                pgaCheck.addEventListener('change', (e) => {
                    setPgaVisible(this._map, e.target.checked);
                });

                this._container = container;
                return container;
            }

            onRemove() {
                this._container.remove();
                this._map = undefined;
            }
        }

        map.addControl(new OverlayToggleControl(), 'top-left');
    });

    return map;
}