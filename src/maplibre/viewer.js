import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { INITIAL_VIEW, styleIds, Z_RAW_POLYS, Z_RAW_POINTS } from './config.js';
import { addBasemap } from './baselayer.js';
import { addVectorSources, addPolygonLayers, addPointLayers } from './layers.js';

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
    // Support both polygon and point clusters
    if ('poly_count' in (props || {})) return `<b>Cluster</b><br/>Count: ${props.poly_count}`;
    if ('pt_count'   in (props || {})) return `<b>Cluster</b><br/>Count: ${props.pt_count}`;

    const fields = ['gid','material','movement','confidence','pga','pgv','psa03','mmi'];
    const rows = fields
        .filter(k => k in (props || {}))
        .map(k => `<div><b>${k}</b>: ${props[k]}</div>`)
        .join('');
    return `<div style="font:12px/1.35 sans-serif"><b>Landslide</b>${rows ? '<hr/>'+rows : ''}</div>`;
}

/** Create and return the MapLibre map. No filter/apply logic here. */
export function startMapLibre() {
    let div = document.getElementById('map');
    if (!div) { div = document.createElement('div'); div.id = 'map'; document.body.appendChild(div); }

    const map = new maplibregl.Map({
        container: 'map',
        style: baseStyle(),
        center: INITIAL_VIEW.center,
        zoom: INITIAL_VIEW.zoom
    });

    // Controls
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }));

    // =========================
    // Interactions: POLY CLUSTERS
    // =========================
    map.on('click', styleIds.polysCluster, e => {
        const f = e.features?.[0]; if (!f) return;
        map.easeTo({ center: e.lngLat, zoom: Math.max(map.getZoom() + 2, Z_RAW_POLYS) });
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHTML(f.properties || {})).addTo(map);
    });
    map.on('mouseenter', styleIds.polysCluster, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.polysCluster, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: RAW POLYGONS
    // =========================
    map.on('click', styleIds.polysFill, e => {
        const f = e.features?.[0]; if (!f) return;
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHTML(f.properties || {})).addTo(map);
    });
    map.on('mouseenter', styleIds.polysFill, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.polysFill, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: POINT CLUSTERS
    // =========================
    map.on('click', styleIds.pointsCluster, e => {
        const f = e.features?.[0]; if (!f) return;
        map.easeTo({ center: e.lngLat, zoom: Math.max(map.getZoom() + 2, Z_RAW_POINTS) });
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHTML(f.properties || {})).addTo(map);
    });
    map.on('mouseenter', styleIds.pointsCluster, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.pointsCluster, () => (map.getCanvas().style.cursor = ''));

    // =========================
    // Interactions: RAW POINTS
    // =========================
    map.on('click', styleIds.pointsCircle, e => {
        const f = e.features?.[0]; if (!f) return;
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHTML(f.properties || {})).addTo(map);
    });
    map.on('mouseenter', styleIds.pointsCircle, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', styleIds.pointsCircle, () => (map.getCanvas().style.cursor = ''));

    // Optional zoom indicator
    map.on('load', () => {
        const zoomBox = document.createElement('div');
        zoomBox.className = 'zoom-box';
        zoomBox.textContent = `Zoom: ${map.getZoom().toFixed(2)}`;
        map.getContainer().appendChild(zoomBox);
        const updateZoom = () => { zoomBox.textContent = `Zoom: ${map.getZoom().toFixed(2)}`; };
        map.on('zoom', updateZoom);
        map.on('moveend', updateZoom);
    });

    return map;
}