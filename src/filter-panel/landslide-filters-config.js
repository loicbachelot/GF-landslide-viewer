// landslide-filters-config.js
(function configureLandslideFilters() {
    const categorical = {
        material: {
            elementId: 'materialFilter',
            multi: true,
            size: 4,
            summaryLabel: 'Material',
            options: [
                { label: 'Debris' },
                { label: 'Earth' },
                { label: 'Rock' },
                { label: 'Complex' },
                { label: 'Water' },
                { label: 'Submarine' }
            ]
        },
        movement: {
            elementId: 'movementFilter',
            multi: true,
            size: 4,
            summaryLabel: 'Movement',
            options: [
                { label: 'Flow' },
                { label: 'Complex' },
                { label: 'Slide' },
                { label: 'Slide-Rotational' },
                { label: 'Slide-Translational' },
                { label: 'Avalanche', matchValues: ['Avalance', 'Avalanche'] },
                { label: 'Flood' },
                { label: 'Deformation' },
                { label: 'Topple', matchValues: ['Topple', 'Toppple'] },
                { label: 'Spread' },
                { label: 'Submarine' }
            ]
        },
        confidence: {
            elementId: 'confidenceFilter',
            multi: true,
            size: 3,
            summaryLabel: 'Confidence',
            options: [
                { label: 'High' },
                { label: 'Medium' },
                { label: 'Low' }
            ]
        }
    };

    const numericRanges = {
        pga:   { elementId: 'pgaRange',   label: 'PGA (%g)',      unit: '%g',  tolerance: 0.1 },
        pgv:   { elementId: 'pgvRange',   label: 'PGV (cm/s)',    unit: 'cm/s',tolerance: 0.1 },
        psa03: { elementId: 'psa03Range', label: 'PSA 0.3s (%g)', unit: '%g',  tolerance: 0.1 },
        mmi:   { elementId: 'mmiRange',   label: 'MMI',           unit: '',    tolerance: 0.05 },
        rain:   { elementId: 'rainRange',   label: 'Annual rain (mm)', unit: 'mm',    tolerance: 0.1 }
    };

    window.LandslideFilterConfig = { categorical, numericRanges };
})();
