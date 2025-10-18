import {
    MARTIN_URL, sourceNames, sourceLayers, styleIds,
    Z_RAW_POLYS, Z_RAW_POINTS
} from './config.js';

export function addVectorSources(style) {
    // POLYGON CLUSTERS (function)
    style.sources.polys_cluster = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.polysClusterFn}/{z}/{x}/{y}`],
        minzoom: 0, maxzoom: Z_RAW_POLYS
    };
    // RAW POLYGONS (table)
    style.sources.polys_raw = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.polysTable}/{z}/{x}/{y}`],
        minzoom: Z_RAW_POLYS, maxzoom: 22
    };

    // POINTS CLUSTERS (function)
    style.sources.pointsCluster = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.pointsClusterFn}/{z}/{x}/{y}`],
        minzoom: 0, maxzoom: Z_RAW_POINTS
    };
    // RAW POINTS (table)
    style.sources.points_raw = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.pointsTable}/{z}/{x}/{y}`],
        minzoom: Z_RAW_POINTS, maxzoom: 22
    };
}

export function addPolygonLayers(style) {
    const BLUE = '#1e90ff';
    const BLUE_DARK = '#094a8f';

    // Abbreviated labels for polygon clusters
    const abbrev = [
        'case',
        ['>=', ['get','poly_count'], 1000000],
        ['concat', ['to-string', ['round', ['/', ['get','poly_count'], 1000000]]], 'M'],
        ['>=', ['get','poly_count'], 1000],
        ['concat', ['to-string', ['round', ['/', ['get','poly_count'], 1000]]], 'k'],
        ['to-string', ['get','poly_count']]
    ];

    const radius = [
        'min',
        ['max', ['*', ['sqrt', ['max', 1, ['get','poly_count']]], 0.75], 6],
        26
    ];
    // Polygon clusters (centroid points) at low zooms
    style.layers.push({
        id: styleIds.polysCluster,
        type: 'circle',
        source: 'polys_cluster',
        'source-layer': sourceLayers.polys.cluster, // "ls_polygons_cluster"
        minzoom: 0, maxzoom: Z_RAW_POLYS,
        paint: {
            'circle-radius': radius,
            'circle-color': BLUE,
            'circle-opacity': 0.9,
            'circle-stroke-color': BLUE_DARK,
            'circle-stroke-width': 1,
            'circle-blur': 0.2
        }
    });

    style.layers.push({
        id: styleIds.polysClusterCount,
        type: 'symbol',
        source: 'polys_cluster',
        'source-layer': sourceLayers.polys.cluster,
        minzoom: 0, maxzoom: Z_RAW_POLYS,
        layout: {
            'text-field': abbrev,
            'text-font': ['Open Sans Regular','Arial Unicode MS Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 0,10, 6,12, 10,14],
            'text-allow-overlap': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': BLUE_DARK,
            'text-halo-width': 1.2
        }
    });

    // Raw polygons (high zooms) direct from table
    style.layers.push(
        {
            id: styleIds.polysFill,
            type: 'fill',
            source: 'polys_raw',
            'source-layer': sourceLayers.polys.raw, // "ls_polygons"
            minzoom: Z_RAW_POLYS,
            paint: { 'fill-color': '#236', 'fill-opacity': 0.25 }
        },
        {
            id: styleIds.polysLine,
            type: 'line',
            source: 'polys_raw',
            'source-layer': sourceLayers.polys.raw,
            minzoom: Z_RAW_POLYS,
            paint: { 'line-color': '#124', 'line-width': 1 }
        }
    );
}

export function addPointLayers(style) {
    // Same palette as polygons
    const BLUE = '#1e90ff';
    const BLUE_DARK = '#094a8f';

    // Safe numeric getter for point cluster counts
    const PT_COUNT = ['to-number', ['coalesce', ['get','pt_count'], 0]];

    // Abbreviated labels — identical logic to polygons
    const abbrev = [
        'case',
        ['>=', PT_COUNT, 1000000],
        ['concat', ['to-string', ['round', ['/', PT_COUNT, 1000000]]], 'M'],
        ['>=', PT_COUNT, 1000],
        ['concat', ['to-string', ['round', ['/', PT_COUNT, 1000]]], 'k'],
        ['to-string', PT_COUNT]
    ];

    // Circle radius — identical logic to polygons
    const radius = [
        'min',
        ['max', ['*', ['sqrt', ['max', 1, PT_COUNT]], 0.75], 6],
        26
    ];

    // POINT CLUSTERS (low zooms) — same visuals as polygon clusters
    style.layers.push({
        id: styleIds.pointsCluster,
        type: 'circle',
        source: 'pointsCluster',
        'source-layer': sourceLayers.points.cluster, // "ls_points_cluster"
        minzoom: 0, maxzoom: Z_RAW_POINTS,
        paint: {
            'circle-radius': radius,
            'circle-color': BLUE,
            'circle-opacity': 0.9,
            'circle-stroke-color': BLUE_DARK,
            'circle-stroke-width': 1,
            'circle-blur': 0.2
        }
    });

    style.layers.push({
        id: styleIds.pointsClusterCount,
        type: 'symbol',
        source: 'pointsCluster',
        'source-layer': sourceLayers.points.cluster,
        minzoom: 0, maxzoom: Z_RAW_POINTS,
        layout: {
            'text-field': abbrev,
            'text-font': ['Open Sans Regular','Arial Unicode MS Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 0,10, 6,12, 10,14],
            'text-allow-overlap': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': BLUE_DARK,
            'text-halo-width': 1.2
        }
    });

    // RAW POINTS (high zooms) — neutral dots so fills/lines still read
    style.layers.push({
        id: styleIds.pointsCircle,
        type: 'circle',
        source: 'points_raw',
        'source-layer': sourceLayers.points.raw, // "ls_points"
        minzoom: Z_RAW_POINTS,
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                Z_RAW_POINTS, 2.5,
                Z_RAW_POINTS + 2, 3.5,
                22, 5
            ],
            'circle-color': '#236',
            'circle-opacity': 0.85,
            'circle-stroke-color': '#124',
            'circle-stroke-width': 0.75
        }
    });
}