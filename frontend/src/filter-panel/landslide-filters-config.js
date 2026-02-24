(function configureLandslideFilters() {
    const categorical = {
        material: {
            elementId: 'materialFilter',
            multi: true,
            size: 4,
            summaryLabel: 'Material',
            help:
                'Broad material class of the failed mass. This is a standardized label compiled from source inventories; definitions may vary slightly by dataset.',
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
                'Primary movement style (how the material moved). Labels are harmonized across inventories and may reflect mapper interpretation rather than a single universal taxonomy.',
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
                'Confidence in the mapped feature being a landslide (or ground-failure feature) as reported by the source inventory. This is not a probabilistic score and is not consistent across all datasets.',
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
                'Peak Ground Acceleration at the feature location, spatially interpolated from the ground-motion surface used by the viewer. Values represent shaking intensity, not landslide size.'
        },
        pgv: {
            elementId: 'pgvRange',
            label: 'PGV (cm/s)',
            unit: 'cm/s',
            tolerance: 0.1,
            help:
                'Peak Ground Velocity at the feature location, interpolated from the same ground-motion surface. Often correlates with damage potential for some structures and may relate to slope response.'
        },
        psa03: {
            elementId: 'psa03Range',
            label: 'PSA 0.3s (%g)',
            unit: '%g',
            tolerance: 0.1,
            help:
                'Pseudo-spectral acceleration at 0.3 s period (5% damping), interpolated from the ground-motion surface. Useful as an intensity proxy for short-period response.'
        },
        mmi: {
            elementId: 'mmiRange',
            label: 'MMI',
            unit: '',
            tolerance: 0.05,
            help:
                'Modified Mercalli Intensity (MMI) at the feature location, derived from the shaking field. This is an intensity estimate and can be model-based, not necessarily observed.'
        },
        rain: {
            elementId: 'rainRange',
            label: 'Annual rain (mm)',
            unit: 'mm',
            tolerance: 0.1,
            help:
                'Mean annual precipitation at the feature location (mm), interpolated from the rainfall/precipitation raster used by the viewer. This is climatology, not storm rainfall at event time.'
        }
    };

    window.LandslideFilterConfig = { categorical, numericRanges };
})();