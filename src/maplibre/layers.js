import {
    MARTIN_URL, sourceNames, sourceLayers, styleIds,
    Z_RAW_POLYS
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