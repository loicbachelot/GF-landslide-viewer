import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { setSpatialSelection, clearSpatialSelection } from '../filter-panel/filterState.js';

import {INITIAL_VIEW, styleIds, Z_RAW_POLYS, Z_RAW_POINTS, CFM_URLS} from './config.js';
import {
    addBasemaps,
    addLabelsOverlay,
    listBasemaps,
    createBasemapController,
} from "./baselayer.js";

import {addVectorSources, addPolygonLayers, addPointLayers} from './layers.js';

import {showSelectedDetailsFromFeatureProps, formatSummaryValue} from '../summary/summary.js';

import {initFaultOverlay, initPgaOverlay, setFaultsVisible, setPgaVisible} from './overlay.js';


function baseStyle() {
    const style = {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {},
        layers: []
    };
    addBasemaps(style);
    addLabelsOverlay(style);
    addVectorSources(style);
    addPolygonLayers(style);
    addPointLayers(style);
    return style;
}

function bringLandslidesToFront(map) {
    const lsTopOrder = [
        styleIds.polysCluster,
        styleIds.polysClusterCount,
        styleIds.pointsCluster,
        styleIds.pointsClusterCount,

        styleIds.polysFill,
        styleIds.pointsCircle
    ].filter(id => !!map.getLayer(id)); // ignore missing ones

    for (const id of lsTopOrder) {
        map.moveLayer(id); // no beforeId => move to top
    }
}

// =========================
// Basemap selector control
// =========================
class BasemapControl {
    constructor(basemapCtl) {
        this.basemapCtl = basemapCtl;
    }

    onAdd(map) {
        this._map = map;

        const container = document.createElement("div");
        container.className = "maplibregl-ctrl maplibregl-ctrl-group";
        container.style.background = "white";
        container.style.padding = "8px 10px";
        container.style.fontSize = "12px";
        container.style.minWidth = "180px";

        const title = document.createElement("div");
        title.textContent = "Basemap";
        title.style.fontWeight = "600";
        title.style.marginBottom = "6px";

        const select = document.createElement("select");
        select.style.width = "100%";

        for (const bm of listBasemaps()) {
            const opt = document.createElement("option");
            opt.value = bm.key;
            opt.textContent = bm.label;
            select.appendChild(opt);
        }

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "6px";
        row.style.marginTop = "8px";

        const labelsCheck = document.createElement("input");
        labelsCheck.type = "checkbox";

        const labelsLabel = document.createElement("label");
        labelsLabel.textContent = "Names";

        row.appendChild(labelsCheck);
        row.appendChild(labelsLabel);

        container.appendChild(title);
        container.appendChild(select);
        container.appendChild(row);

        // UI -> state
        select.addEventListener("change", (e) => {
            this.basemapCtl.setBasemap(e.target.value);
        });
        labelsCheck.addEventListener("change", (e) => {
            this.basemapCtl.setLabelsEnabled(e.target.checked);
        });

        // state -> UI (this is the magic)
        this._unsubscribe = this.basemapCtl.onChange((st) => {
            select.value = st.basemapKey;
            labelsCheck.checked = st.labelsOn;
            // optional: disable toggle when basemap has labels (e.g., OSM)
            labelsCheck.disabled = st.basemapHasLabels;
            labelsLabel.style.opacity = st.basemapHasLabels ? "0.6" : "1";
        });

        this._container = container;
        return container;
    }

    onRemove() {
        if (this._unsubscribe) this._unsubscribe();
        this._container.remove();
        this._map = undefined;
    }
}

function popupHTML(props = {}) {
    const fields = ['viewer_id', 'material', 'movement', 'confidence', 'pga', 'pgv', 'psa03', 'mmi', 'rainfall'];

    const rows = fields
        .filter(k => k in props)
        .map(k => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
            const val = formatSummaryValue(k, props[k], { decimalsDefault: 2 });
            return `<div><b>${label}</b>: ${val}</div>`;
        })
        .join('');

    return `<div style="font:12px/1.35 sans-serif"><b>Landslide</b>${rows ? '<hr/>' + rows : ''}</div>`;
}

const styles=[{id:"gl-draw-polygon-fill",type:"fill",filter:["all",["==","$type","Polygon"],],paint:{"fill-color":["case",["==",["get","active"],"true"],"orange","blue",],"fill-opacity":.1}},{id:"gl-draw-lines",type:"line",filter:["any",["==","$type","LineString"],["==","$type","Polygon"],],layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["case",["==",["get","active"],"true"],"orange","blue",],"line-dasharray":["case",["==",["get","active"],"true"],["literal",[.2,2]],["literal",[.2,2]],],"line-width":2}},{id:"gl-draw-point-outer",type:"circle",filter:["all",["==","$type","Point"],["==","meta","feature"],],paint:{"circle-radius":["case",["==",["get","active"],"true"],7,5,],"circle-color":"white"}},{id:"gl-draw-point-inner",type:"circle",filter:["all",["==","$type","Point"],["==","meta","feature"],],paint:{"circle-radius":["case",["==",["get","active"],"true"],5,3,],"circle-color":["case",["==",["get","active"],"true"],"orange","blue",]}},{id:"gl-draw-vertex-outer",type:"circle",filter:["all",["==","$type","Point"],["==","meta","vertex"],["!=","mode","simple_select"],],paint:{"circle-radius":["case",["==",["get","active"],"true"],7,5,],"circle-color":"white"}},{id:"gl-draw-vertex-inner",type:"circle",filter:["all",["==","$type","Point"],["==","meta","vertex"],["!=","mode","simple_select"],],paint:{"circle-radius":["case",["==",["get","active"],"true"],5,3,],"circle-color":"orange"}},{id:"gl-draw-midpoint",type:"circle",filter:["all",["==","meta","midpoint"],],paint:{"circle-radius":3,"circle-color":"orange"}},];

/** Create and return the MapLibre map. No filter/apply logic here. */
export function startMapLibre() {
    let div = document.getElementById('map');
    if (!div) {
        div = document.createElement('div');
        div.id = 'map';
        document.body.appendChild(div);
    }

    const basemapCtl = createBasemapController({ defaultBasemap: "osm" });


    const map = new maplibregl.Map({
        container: 'map',
        style: baseStyle(),
        center: INITIAL_VIEW.center,
        zoom: INITIAL_VIEW.zoom
    });

    // Controls
    map.addControl(new maplibregl.NavigationControl({showCompass: true}), 'top-right');
    map.addControl(new maplibregl.ScaleControl({maxWidth: 120, unit: 'metric'}));

    map.on('load', async () => {
        basemapCtl.attach(map);
        // =========== Initialize CFM and PGA overlay ===========
        await initFaultOverlay(map, CFM_URLS, {initialVisibility: 'visible'});
        const PGA_URL = new URL('../resources/pga_contours.json', import.meta.url).href;
        await initPgaOverlay(map, PGA_URL);

        // make sure the landslide data is on top of the other layers
        bringLandslidesToFront(map);

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

        map.addControl(new BasemapControl(basemapCtl), 'top-left');

    });

    // =========================
    // Interactions: POLY CLUSTERS
    // =========================
    map.on('click', styleIds.polysCluster, e => {
        if (isDrawing(draw)) return;
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
    let selectedPoly = null; // { source, sourceLayer, id }

    map.on('click', styleIds.polysFill, (e) => {
        if (isDrawing(draw)) return;

        const f = e.features?.[0];
        if (!f) return;

        const key = {
            source: f.source,
            sourceLayer: f.sourceLayer,
            id: f.id
        };

        // Clear previous
        if (selectedPoly) {
            map.setFeatureState(selectedPoly, { selected: false });
        }

        // Set new
        map.setFeatureState(key, { selected: true });
        selectedPoly = key;

        new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(popupHTML(f.properties || {}))
            .addTo(map);

        showSelectedDetailsFromFeatureProps(f.properties || {});
    });
    map.on('mouseenter', styleIds.polysFill, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.polysFill, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: POINT CLUSTERS
    // =========================
    map.on('click', styleIds.pointsCluster, e => {
        if (isDrawing(draw)) return;
        const f = e.features?.[0];
        if (!f) return;
        map.easeTo({
            center: e.lngLat, zoom: Math.min(map.getZoom() + 2, Z_RAW_POINTS), duration: 1000
        });
    });
    map.on('mouseenter', styleIds.pointsCluster, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.pointsCluster, () => (map.getCanvas().style.cursor = ''));

    // celear selected feature
    map.on('click', (e) => {
        const feats = map.queryRenderedFeatures(e.point, { layers: [styleIds.pointsCircle, styleIds.polysFill] });
        if (feats.length) return;

        if (selectedPoint) { map.setFeatureState(selectedPoint, { selected: false }); selectedPoint = null; }
        if (selectedPoly)  { map.setFeatureState(selectedPoly,  { selected: false }); selectedPoly  = null; }
    });

    // =========================
    // Interactions: RAW POINTS
    // =========================
    let selectedPoint = null; // { source, sourceLayer, id }

    map.on('click', styleIds.pointsCircle, (e) => {
        if (isDrawing(draw)) return;

        const f = e.features?.[0];
        if (!f) return;

        const key = { source: f.source, sourceLayer: f.sourceLayer, id: f.id };

        if (selectedPoint) {
            map.setFeatureState(selectedPoint, { selected: false });
        }

        map.setFeatureState(key, { selected: true });
        selectedPoint = key;

        new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(popupHTML(f.properties || {}))
            .addTo(map);

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

    // --- Add MapboxDraw control, polygon + trash only ---
    const draw = new MapboxDraw({
        displayControlsDefault: false,
        styles: styles
    });

    function isDrawing(draw) {
        const mode = draw.getMode();
        return mode !== 'simple_select';
    }

    map.addControl(draw);

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;

        // Draw button
        if (target.id === 'spatial-draw-btn') {
            draw.deleteAll();
            clearSpatialSelection();

            draw.changeMode('draw_polygon');
            map.getCanvas().style.cursor = 'crosshair';
            return;
        }

        // Validate button
        if (target.id === 'spatial-validate-btn') {

            const data = draw.getAll();
            let geometry = null;

            if (data.features.length > 0) {
                const f = data.features[0];
                if (f && f.geometry && f.geometry.type === 'Polygon') {
                    geometry = f.geometry;
                }
            }

            if (geometry) {
                setSpatialSelection(geometry);
            } else {
                clearSpatialSelection();
            }

            draw.changeMode('simple_select');
            map.getCanvas().style.cursor = '';
            return;
        }

        // Reset button
        if (target.id === 'spatial-reset-btn') {
            clearSpatialSelection();
            draw.deleteAll();
            draw.changeMode('simple_select');
            map.getCanvas().style.cursor = '';
        }
    });

    return map
}