// Martin base URL
export const MARTIN_URL = import.meta.env.VITE_MARTIN_URL ?? 'http://localhost:3000';

// Initial map view
export const INITIAL_VIEW = { center: [-123.0, 44.0], zoom: 6 };

// Endpoints (functions for clusters, tables for raw)
export const sourceNames = {
    polysFn:  'landslide_v2.ls_polygons_q',  // <-- NEW: unified polygons endpoint
    pointsFn: 'landslide_v2.ls_points_q',    // <-- NEW: unified points endpoint
};

// Vector layer ids *inside* the tiles (MVT layer names)
export const sourceLayers = {
    polys: {
        cluster: 'ls_polygons_cluster',   // <-- MVT layer id
        raw:     'ls_polygons_raw'        // <-- MVT layer id
    },
    points: {
        cluster: 'ls_points_cluster',
        raw: 'ls_points_raw'
    }
};

// MapLibre style layer ids
export const styleIds = {
    basemap: 'osm',
    // polygon layers
    polysCluster: 'polys_cluster',
    polysClusterCount: 'polys_cluster-count',
    polysFill: 'polys_raw-fill',
    polysLine: 'polys_raw-line',
    // point layers
    pointsCluster:      'points-cluster',
    pointsClusterCount: 'points-cluster-count',
    pointsCircle:       'points-circle',
    pointsLabel:        'points-label'
};

// Zoom thresholds (clusters < Z, raw ≥ Z)
export const Z_RAW_POLYS  = 9;
export const Z_RAW_POINTS = 9;

export const CFM_URLS = [
    'https://raw.githubusercontent.com/cascadiaquakes/CRESCENT-CFM/main/crescent_cfm_files/crescent_cfm_crustal_traces.geojson',
];