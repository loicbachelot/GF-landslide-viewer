// Martin base URL
export const MARTIN_URL = import.meta.env.VITE_MARTIN_URL ?? 'http://localhost:3000';

// Initial map view
export const INITIAL_VIEW = { center: [-123.0, 44.0], zoom: 6 };

// Endpoints (functions for clusters, tables for raw)
export const sourceNames = {
    // clusters (functions)
    polysClusterFn:  'ls_polygons_cluster_filtered',
    // raw (tables/views)
    polysTable:      'ls_polygons_raw_polygons_filtered'
};

// Vector layer ids *inside* the tiles (MVT layer names)
export const sourceLayers = {
    polys: {
        cluster: 'ls_polygons_cluster',   // <-- MVT layer id
        raw:     'ls_polygons_raw'        // <-- MVT layer id
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
};

// Zoom thresholds (clusters < Z, raw ≥ Z)
export const Z_RAW_POLYS  = 9;
