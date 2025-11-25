const SRC_ID = 'cfm_faults';
const LAYER_LINE_ID = 'cfm-faults-line';
const LAYER_LABEL_ID = 'cfm-faults-labels';

/**
 * Merge multiple GeoJSON FeatureCollections into one.
 * @param {Array<Object>} collections
 * @returns {Object} GeoJSON FeatureCollection
 */
function mergeFeatureCollections(collections) {
    return {
        type: 'FeatureCollection',
        features: collections.flatMap(fc => (fc && fc.features) ? fc.features : [])
    };
}

/**
 * Fetch 1+ GeoJSON URLs and return a merged FeatureCollection.
 * @param {string|string[]} urls
 * @returns {Promise<Object>} GeoJSON FeatureCollection
 */
async function fetchAndMergeGeoJSON(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    const files = await Promise.all(
        list.map(u => fetch(u, { cache: 'no-cache' }).then(r => {
            if (!r.ok) throw new Error(`Failed to fetch ${u}: ${r.status}`);
            return r.json();
        }))
    );
    return mergeFeatureCollections(files);
}

/**
 * Ensure the source exists; if not, add it (with empty data first for speedy layer add).
 * @param {maplibregl.Map} map
 */
function ensureSource(map) {
    if (!map.getSource(SRC_ID)) {
        map.addSource(SRC_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }
}

/**
 * Add line + label layers if missing.
 * @param {maplibregl.Map} map
 * @param {Object} opts
 * @param {string} [opts.lineColor='#d9534f']
 * @param {number[]} [opts.lineWidthStops=[4,1,8,2,12,3.5]] // zoom/width pairs
 * @param {number} [opts.lineOpacity=0.9]
 * @param {string[]} [opts.labelProps=['name','fault_name']]
 * @param {number} [opts.labelSize=12]
 * @param {'none'|'visible'} [opts.initialVisibility='visible']
 */
function ensureLayers(map, opts = {}) {
    const {
        lineColor = '#d9534f',
        lineWidthStops = [4, 1, 8, 2, 12, 3.5],
        lineOpacity = 0.9,
        labelProps = ['name', 'fault_name'],
        labelSize = 12,
        initialVisibility = 'visible'
    } = opts;

    if (!map.getLayer(LAYER_LINE_ID)) {
        map.addLayer({
            id: LAYER_LINE_ID,
            type: 'line',
            source: SRC_ID,
            layout: { visibility: initialVisibility },
            paint: {
                'line-color': lineColor,
                'line-opacity': lineOpacity,
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    ...lineWidthStops
                ]
            }
        });
    }

    if (!map.getLayer(LAYER_LABEL_ID)) {
        map.addLayer({
            id: LAYER_LABEL_ID,
            type: 'symbol',
            source: SRC_ID,
            layout: {
                visibility: initialVisibility,
                'text-field': [
                    'coalesce',
                    ...labelProps.map(p => ['get', p]),
                    '' // fallback
                ],
                'text-size': labelSize,
                'symbol-placement': 'line'
            },
            paint: {
                'text-halo-color': '#ffffff',
                'text-halo-width': 1,
                'text-opacity': 0.85
            }
        });
    }
}

/**
 * Initialize the overlay: add source+layers and load data from one or many URLs.
 * Safe to call multiple times (idempotent).
 *
 * @param {maplibregl.Map} map
 * @param {string|string[]} urls  One or more GeoJSON URLs (e.g. raw GitHub links)
 * @param {Object} [opts]         Styling/config options (see ensureLayers)
 */
export async function initFaultOverlay(map, urls, opts = {}) {
    ensureSource(map);
    ensureLayers(map, opts);

    // Load/merge data and set it on the source
    const fc = await fetchAndMergeGeoJSON(urls);
    const src = map.getSource(SRC_ID);
    if (src) src.setData(fc);
}

/**
 * Toggle visibility of the faults overlay.
 * @param {maplibregl.Map} map
 * @param {boolean} visible
 */
export function setFaultsVisible(map, visible) {
    const vis = visible ? 'visible' : 'none';
    [LAYER_LINE_ID, LAYER_LABEL_ID].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
}

/**
 * Hot-reload/replace the overlay data from new URLs.
 * @param {maplibregl.Map} map
 * @param {string|string[]} urls
 */
export async function updateFaultData(map, urls) {
    const fc = await fetchAndMergeGeoJSON(urls);
    const src = map.getSource(SRC_ID);
    if (!src) throw new Error('Fault source not initialized. Call initFaultOverlay() first.');
    src.setData(fc);
}

/**
 * Remove layers + source entirely (useful when rebuilding style).
 * @param {maplibregl.Map} map
 */
export function removeFaultOverlay(map) {
    [LAYER_LABEL_ID, LAYER_LINE_ID].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);
}

// ===============================
// PGA Contours overlay (data-driven styling)
// ===============================

const SRC_PGA = 'pga_contours';
const LAYER_PGA = 'pga-contours-line';
const LAYER_PGA_LABEL = 'pga-contours-label';
/**
 * Initialize the PGA contour overlay.
 * @param {maplibregl.Map} map
 * @param {string} dataUrl - URL to GeoJSON (can be absolute, or use new URL(..., import.meta.url).href)
 */
export async function initPgaOverlay(map, dataUrl) {
    if (!map.getSource(SRC_PGA)) {
        map.addSource(SRC_PGA, {
            type: 'geojson',
            // let MapLibre fetch the file; Vite local works if you pass a resolved href
            data: dataUrl
        });
    } else {
        // hot-reload
        map.getSource(SRC_PGA).setData(dataUrl);
    }

    // Data-driven paint: use per-feature 'color' and 'weight'
    // We also scale width a bit with zoom so lines stay readable.
    if (!map.getLayer(LAYER_PGA)) {
        map.addLayer({
            id: LAYER_PGA,
            type: 'line',
            source: SRC_PGA,
            layout: {
                visibility: 'visible',
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                // color from feature property (fallback provided)
                'line-color': ['coalesce', ['get', 'color'], '#0057e7'],

                // zoom-safe expression: top-level interpolate uses ["zoom"]
                // outputs can be expressions (here: weight * factor)
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    4,  ['*', ['coalesce', ['get', 'weight'], 2], 0.4],
                    8,  ['*', ['coalesce', ['get', 'weight'], 2], 0.7],
                    12, ['*', ['coalesce', ['get', 'weight'], 2], 1.0],
                    14, ['*', ['coalesce', ['get', 'weight'], 2], 1.2]
                ],
                'line-opacity': 0.9
            }
        });
    }
    if (!map.getLayer(LAYER_PGA_LABEL)) {
        map.addLayer({
            id: LAYER_PGA_LABEL,
            type: 'symbol',
            source: SRC_PGA,
            layout: {
                visibility: 'visible',
                'symbol-placement': 'line',
                'symbol-spacing': 300,        // increase for fewer labels; decrease for more
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    4, 10,
                    8, 11.5,
                    12, 13
                ],
                'text-field': [
                    'concat',
                    // value
                    ['to-string', ['get', 'value']],
                    ' ',
                    // units: turn "pctg" into a percent sign for readability
                    ['case',
                        ['==', ['get', 'units'], 'pctg'], '%',
                        // fallback to whatever units string exists
                        ['coalesce', ['get', 'units'], '']
                    ]
                ],
                'text-rotation-alignment': 'map',
                'text-keep-upright': true,
                'text-allow-overlap': false,
                'text-max-angle': 30
            },
            paint: {
                // Match the line color (fallback to blue), plus a white halo for readability
                'text-color': ['coalesce', ['get', 'color'], '#0057e7'],
                'text-halo-color': '#000000',
                'text-halo-width': 1.25,
                'text-opacity': 0.95
            }
        });
    }
}

/**
 * Toggle visibility for the PGA contours.
 * @param {maplibregl.Map} map
 * @param {boolean} visible
 */
export function setPgaVisible(map, visible) {
    const vis = visible ? 'visible' : 'none';
    [LAYER_PGA, LAYER_PGA_LABEL].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
}