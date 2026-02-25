(function configureLandslideFilters() {
    const categorical = {
        material: {
            elementId: 'materialFilter',
            multi: true,
            size: 4,
            summaryLabel: 'Material',
            help:
                "Material class describes the kind of material involved in the landslide (e.g., soil/earth, debris, rock). Definitions and mapping consistency can vary by original study.",
            options: [
                { label: 'Debris' },     // mixed coarse material, often poorly sorted
                { label: 'Earth' },      // soil/fine-grained regolith
                { label: 'Rock' },       // bedrock / rock mass
                { label: 'Complex' },    // multiple materials or uncertain dominant type
                { label: 'Water' },      // water-driven / watery mixture in some inventories
                { label: 'Submarine' }   // subaqueous / seafloor setting
            ]
        },

        movement: {
            elementId: 'movementFilter',
            multi: true,
            size: 4,
            summaryLabel: 'Movement',
            help:
                "Movement type describes how the landslide moved. (e.g., slides, flows, spreads, topples, falls, and complex). Categories reflect mapper interpretation from source materials and methods (e.g., lidar morphology mapping, aerial photos, field work) and can vary in detail by study.",
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
            help:
                "Confidence is the mapper’s confidence in identification (high, moderate, low). This is not a calibrated probability and may vary across different source datasets.",
            options: [{ label: 'High' }, { label: 'Medium' }, { label: 'Low' }]
        }
    };

    const numericRanges = {
        pga: {
            elementId: 'pgaRange',
            label: 'PGA (%g)',
            unit: '%g',
            tolerance: 0.1,
            help:
                'Peak Ground Acceleration (PGA) is the maximum ground acceleration recorded at a site during earthquake shaking, expressed as a fraction of gravity (g). Values shown here are extracted from the USGS Cascadia M9 scenario ground-motion model and spatially interpolated to each feature location. Because this represents a single hypothetical rupture scenario, it should not be interpreted as observed shaking or as a definitive prediction of future ground motion.'
        },
        pgv: {
            elementId: 'pgvRange',
            label: 'PGV (cm/s)',
            unit: 'cm/s',
            tolerance: 0.1,
            help:
                'Peak Ground Velocity (PGV) is the maximum ground velocity during shaking, measured in centimeters per second. PGV often correlates with structural damage and slope deformation potential. Values in this viewer are interpolated from the USGS Cascadia M9 scenario ground-motion surface and reflect modeled, not observed, shaking from a single hypothetical event.'
        },
        psa03: {
            elementId: 'psa03Range',
            label: 'PSA 0.3s (%g)',
            unit: '%g',
            tolerance: 0.1,
            help:
                'Pseudo-Spectral Acceleration (PSA) at 0.3 seconds (typically 5% damping) represents the maximum acceleration response of a single-degree-of-freedom oscillator with a 0.3 s natural period subjected to earthquake motion. It is commonly used as an intensity measure for short-period response. Values shown are derived from the USGS Cascadia M9 scenario model and represent one simulated rupture, not ground-truth observations.'
        },
        mmi: {
            elementId: 'mmiRange',
            label: 'MMI',
            unit: '',
            tolerance: 0.05,
            help:
                'Modified Mercalli Intensity (MMI) is a qualitative intensity scale describing the effects of shaking on people, structures, and the natural environment. In this viewer, MMI values are derived from the USGS Cascadia M9 scenario shaking model and are therefore model-based intensity estimates for a single hypothetical earthquake, not reported observations from a real event.'
        },
        rain: {
            elementId: 'rainRange',
            label: 'Annual rain (mm)',
            unit: 'mm',
            tolerance: 0.1,
            help:
                'Mean annual precipitation (mm) at the feature location, derived from the 30-year (1990–2019) annual average DAYMET precipitation dataset for North America. Values are spatially interpolated from a gridded climatology product and represent long-term average climate conditions. This is not event-specific rainfall and should not be interpreted as rainfall at the time of landslide occurrence.'
        }
    };

    window.LandslideFilterConfig = { categorical, numericRanges };
})();