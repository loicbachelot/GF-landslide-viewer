// baselayer.js

export const BASEMAPS = {
    osm: {
        label: "OpenStreetMap",
        hasLabels: true,
        source: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
        },
    },
    esri_imagery: {
        label: "Esri Imagery",
        hasLabels: false,
        source: {
            type: "raster",
            tiles: [
                "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "Tiles © Esri, Maxar",
        },
    },
    esri_hillshade: {
        label: "Esri Hillshade",
        hasLabels: false,
        source: {
            type: "raster",
            tiles: [
                "https://server.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "Tiles © Esri",
        },
    },

    esri_terrain: {
        label: "Esri Terrain",
        hasLabels: false,
        source: {
            type: "raster",
            tiles: [
                "https://server.arcgisonline.com/arcgis/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}"
            ],
            tileSize: 256,
            attribution: "Tiles © Esri",
        },
    },

    opentopo: {
        label: "OpenTopoMap",
        hasLabels: true,
        source: {
            type: "raster",
            tiles: [
                "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
                "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
                "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: "© OpenTopoMap (CC-BY-SA)",
        },
    },
};

export const LABELS_OVERLAY = {
    id: "overlay-labels",
    sourceId: "labels",
    source: {
        type: "raster",
        tiles: [
            "https://cartodb-basemaps-a.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png",
            "https://cartodb-basemaps-b.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png",
            "https://cartodb-basemaps-c.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png",
            "https://cartodb-basemaps-d.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© CARTO © OpenStreetMap contributors",
    },
};

export function listBasemaps() {
    return Object.entries(BASEMAPS).map(([key, cfg]) => ({ key, label: cfg.label }));
}

export function addBasemaps(style) {
    style.sources = style.sources || {};
    style.layers = style.layers || [];

    for (const [key, cfg] of Object.entries(BASEMAPS)) {
        style.sources[key] = cfg.source;
        style.layers.push({
            id: `basemap-${key}`,
            type: "raster",
            source: key,
            layout: { visibility: "none" },
        });
    }
}

export function addLabelsOverlay(style) {
    style.sources = style.sources || {};
    style.layers = style.layers || [];

    style.sources[LABELS_OVERLAY.sourceId] = LABELS_OVERLAY.source;
    style.layers.push({
        id: LABELS_OVERLAY.id,
        type: "raster",
        source: LABELS_OVERLAY.sourceId,
        layout: { visibility: "none" },
    });
}

// ------------------------------
// Stateful controller
// ------------------------------
export function createBasemapController({ defaultBasemap = "osm" } = {}) {
    let map = null;

    // state
    let basemapKey = defaultBasemap;
    let labelsOn = false;

    // listeners
    const listeners = new Set();
    const emit = () => {
        const snapshot = getState();
        for (const fn of listeners) fn(snapshot);
    };

    const getState = () => {
        const bm = BASEMAPS[basemapKey];
        return {
            basemapKey,
            labelsOn,
            basemapHasLabels: !!bm?.hasLabels,
        };
    };

    const apply = () => {
        if (!map) return;

        // basemap visibility
        for (const k of Object.keys(BASEMAPS)) {
            const id = `basemap-${k}`;
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", k === basemapKey ? "visible" : "none");
            }
        }

        // labels overlay visibility
        if (map.getLayer(LABELS_OVERLAY.id)) {
            map.setLayoutProperty(LABELS_OVERLAY.id, "visibility", labelsOn ? "visible" : "none");
        }
    };

    const enforceRule = () => {
        // If basemap already includes labels (OSM), force overlay off
        const bm = BASEMAPS[basemapKey];
        if (bm?.hasLabels) labelsOn = false;
    };

    return {
        attach(_map) {
            map = _map;
            enforceRule();
            apply();
            emit();
        },

        onChange(fn) {
            listeners.add(fn);
            // immediate sync
            fn(getState());
            return () => listeners.delete(fn);
        },

        setBasemap(key) {
            if (!BASEMAPS[key]) return;
            basemapKey = key;
            enforceRule();
            apply();
            emit();
        },

        setLabelsEnabled(on) {
            // allow user, but still enforce rule
            labelsOn = !!on;
            enforceRule();
            apply();
            emit();
        },

        getState,
    };
}
