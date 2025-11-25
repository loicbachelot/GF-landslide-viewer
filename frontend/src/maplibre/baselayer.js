export function addBasemap(style) {
    // style.sources.osm = {
    //     type: 'raster',
    //     tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    //     tileSize: 256,
    //     attribution: '© OpenStreetMap'
    // };
    // style.layers.push({ id: 'osm', type: 'raster', source: 'osm' });
    style.sources.esri = {
        type: 'raster',
        tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics'
    };
    style.layers.push({ id: 'esri', type: 'raster', source: 'esri' });
}