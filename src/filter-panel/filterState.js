let currentFilterSummary = {
    categorical: { material: [], movement: [], confidence: [] },
    numeric: { pga: null, pgv: null, psa03: null, mmi: null, rain: null }
};

export function setCurrentFilterSummary(summary) {
    currentFilterSummary = summary || {
        categorical: { material: [], movement: [], confidence: [] },
        numeric: { pga: null, pgv: null, psa03: null, mmi: null, rain: null }
    };
}

export function getCurrentFilterSummary() {
    return currentFilterSummary;
}