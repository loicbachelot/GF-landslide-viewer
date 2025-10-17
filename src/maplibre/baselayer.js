export function addBasemap(style) {
    style.sources.osm = {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap'
    };
    style.layers.push({ id: 'osm', type: 'raster', source: 'osm' });
}