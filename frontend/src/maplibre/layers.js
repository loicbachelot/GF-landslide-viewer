import {
    MARTIN_URL, sourceNames, sourceLayers, styleIds,
    Z_RAW_POLYS, Z_RAW_POINTS
} from './config.js';

export function addVectorSources(style) {
    // POLYGON CLUSTERS (function)
    style.sources.polys_cluster = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.polysFn}/{z}/{x}/{y}?mode=cluster`],
        minzoom: 0, maxzoom: Z_RAW_POLYS
    };
    // RAW POLYGONS (table)
    style.sources.polys_raw = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.polysFn}/{z}/{x}/{y}?mode=raw`],
        minzoom: Z_RAW_POLYS, maxzoom: 22,
        promoteId: 'viewer_id'
    };

    // POINTS CLUSTERS (function)
    style.sources.points_cluster = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.pointsFn}/{z}/{x}/{y}?mode=cluster`],
        minzoom: 0, maxzoom: Z_RAW_POINTS
    };
    // RAW POINTS (table)
    style.sources.points_raw = {
        type: 'vector',
        tiles: [`${MARTIN_URL}/${sourceNames.pointsFn}/{z}/{x}/{y}?mode=raw`],
        minzoom: Z_RAW_POINTS, maxzoom: 22,
        promoteId: 'viewer_id'
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
        'source-layer': sourceLayers.polys.cluster,
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
            'source-layer': sourceLayers.polys.raw,
            minzoom: Z_RAW_POLYS,
            paint: {
                'fill-color': 'rgb(120, 200, 255)',

                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    0.85,  // selected
                    0.40   // default (same as your old rgba alpha)
                ],

                'fill-outline-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    'rgba(30, 120, 190, 1.0)',
                    'rgba(30, 120, 190, 0.8)'
                ]
            }
        },
        {
            id: styleIds.polysLine,
            type: 'line',
            source: 'polys_raw',
            'source-layer': sourceLayers.polys.raw,
            minzoom: Z_RAW_POLYS,
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    'rgba(46,111,244,0.9)',
                    'rgba(46,111,244,0.11)'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    3,
                    1
                ]
            }
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
        source: 'points_cluster',
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
        source: 'points_cluster',
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
    const sel = ['case', ['boolean', ['feature-state', 'selected'], false], 1.45, 1.0];

    style.layers.push({
        id: styleIds.pointsCircle,
        type: 'circle',
        source: 'points_raw',
        'source-layer': sourceLayers.points.raw,
        minzoom: Z_RAW_POINTS,
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                Z_RAW_POINTS,     ['*', 4,   sel],
                Z_RAW_POINTS + 2, ['*', 5.5, sel],
                22,               ['*', 7,   sel]
            ],

            'circle-color': 'rgb(120, 200, 255)',

            'circle-opacity': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                1.0,
                0.85
            ],

            'circle-stroke-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                'rgba(0,0,0,0.95)',
                '#124'
            ],

            'circle-stroke-width': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                2.0,
                0.75
            ]
        }
    });
}