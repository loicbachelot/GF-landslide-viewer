export function flyToExtent(map, bbox4326 /* [minX,minY,maxX,maxY] */) {
    map.fitBounds([[bbox4326[0], bbox4326[1]], [bbox4326[2], bbox4326[3]]], {
        padding: 24,
        duration: 700
    });
}

export function goto(map, lng, lat, zoom = 10) {
    map.easeTo({ center: [lng, lat], zoom });
}
