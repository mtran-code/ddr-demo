// Centralized configuration for the DDR demo. Adjust values here.
// This object is loaded before models/app and passed around as `config`.

window.DDRConfig = {
  // General fitting controls
  fitting: {
    minPointsForFit: 5, // minimum points required to attempt a fit
    // emaxMode controls how Emax is derived in metrics:
    // - 'fromCurveAtMax' (default): evaluate the fitted curve at the maximum tested dose
    //   and report that %viability as Emax. This smooths noise and mirrors Case 1.
    // Note: Other modes (e.g., using the observed value at max dose, or the minimum
    // over the fitted curve across the tested range) can be added if needed.
    emaxMode: 'fromCurveAtMax',
  },

  // Rendering controls
  rendering: {
    curveResolution: 200, // segments for the plotted curve
  },

  // Parameter bounds (Case 1-aligned)
  bounds: {
    eInf: { min: 0.0, max: 1.0 },
    hillSlope: { min: 0.0, max: 5.0 },
    ec50: { min: -8, max: 8 }, // bounds in log10 space
  },

  // Optimizer controls
  optimizer: {
    // Nelder–Mead (if used elsewhere)
    maxIterations: 100000,
    convergenceTolerance: 1e-6,

    // Projected gradient attempt (Case 1 analogue)
    maxGDIter: 200,
    gdAlpha: 1.0, // initial step scale
    gdEps: 1e-6, // finite-difference perturbation
    gdBacktrackingMax: 10, // backtracking steps
    improvementTol: 1e-6, // improvement threshold to accept GD over gritty guess
  },

  // Robust loss / residuals
  robust: {
    huberDelta: 0.05, // Huber delta in fractional space (0..1). Smaller => more robust (visible difference vs Hill)
    weights: {
      endpoints: 10, // extra weight on the first/last points
      midpoint: 10, // extra weight on central point (monophasic only)
      enableMidpointForMonophasic: true,
    },
  },

  // Mesh + pattern search (Case 1 fallback)
  mesh: {
    // grid densities per-parameter (log10 for EC50), then converted to linear for evaluation
    densitiesMono: [2, 10, 5],
    densitiesBiphasic: [2, 10, 5, 2, 10, 5],
    stepScale: 0.5, // step size base used to derive per-dimension step = stepScale / density
    span: 1.0, // initial span for pattern search
    precision: 1e-4, // stopping precision for span halving
    maxCandidates: 5000, // limit candidates evaluated from mesh (downsample if larger)
  },

  // Initial parameter generation helpers
  initialParams: {
    initialParamSets: 8, // if simplex-based methods are used elsewhere
    jitter: {
      eInf: 0.02, // multiplicative jitter for eInf entries when building a simplex
      other: 0.1, // multiplicative jitter for other parameters
    },
  },
};
