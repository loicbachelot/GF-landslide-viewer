let currentFilterSummary = {
    categorical: { material: [], movement: [], confidence: [] },
    numeric: { pga: null, pgv: null, psa03: null, mmi: null, rain: null },
    spatial: null
};

export function setCurrentFilterSummary(summary) {
    const base = summary || {
        categorical: { material: [], movement: [], confidence: [] },
        numeric: { pga: null, pgv: null, psa03: null, mmi: null, rain: null }
    };

    currentFilterSummary = {
        ...currentFilterSummary, // this keeps the other filters, for now just spatial
        categorical: base.categorical,
        numeric: base.numeric,
    };
}


export function getCurrentFilterSummary() {
    return currentFilterSummary;
}

export function setSpatialSelection(selection) {
    console.log(selection);
    currentFilterSummary.spatial = selection;
}

export function clearSpatialSelection() {
    currentFilterSummary.spatial = null;
}

export function getSpatialSelection() {
    return currentFilterSummary.spatial;
}