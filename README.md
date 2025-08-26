# Drug Dose Response Curve Fitting Demo

An interactive web-based tool for visualizing and fitting drug dose–response curves, aligned with the current R implementation (3‑parameter Hill and biphasic as product of two Hills). The app is organized with separate HTML, CSS, and modular JS files for clarity and maintainability.

## Features

- **Interactive plotting**: Click anywhere on the canvas to add data points
- **Automatic curve fitting**: After 5+ points (unique doses), curves are automatically fitted
- **Multiple fit types**:
  - Monophasic (Hill equation)
  - Biphasic (two-phase response)
- **Loss function toggle**:
  - Hill: standard least squares
  - Huber: robust Huber loss with endpoint/midpoint weighting (R-like)
- **Case 1 strategy (PharmacoGX3)**:
  - Data‑guided initial guess, robust Huber loss with endpoint/midpoint weighting
  - Attempt bounded gradient improvement; fallback to coarse mesh + pattern search
  - R² computed on percent viability; IC50 from Hill for biphasic
- **Real-time metrics**:
  - R-squared (goodness of fit)
  - IC50 (half-maximal inhibitory concentration)
  - AUC (Area Under the Curve)
  - Emax at max tested dose (in CSV export)
- **Export capabilities**:
  - PNG image export
  - CSV data export with fitted parameters

## Quick Start

1. **Open the application**:

   ```bash
   # Navigate to the project directory
   cd ddr_demo

   # Open in your default browser
   open index.html

   # Or use Python's built-in server for better performance
   python3 -m http.server 8000
   # Then navigate to http://localhost:8000
   ```

2. **Start plotting**:

   - Click anywhere on the plot to add data points
   - Points represent drug concentration (x-axis) vs cell viability (y-axis)
   - X-axis: Concentration in µM (log scale from 10^-3 to 10^2)
   - Y-axis: Cell viability (0-100%)

3. **Observe the fit**:

   - After adding 5 or more points (preferably at unique doses), a curve will automatically be fitted
   - The red line shows the fitted curve
   - Metrics update in real-time on the right panel

4. **Experiment with options**:

   - Toggle between **Monophasic** and **Biphasic** fits (Fit Type switch)
   - Toggle between **Hill** and **Huber** loss (Loss switch)

5. **Export your results**:
   - Click "Export as PNG" to save the plot
   - Click "Export Data as CSV" to download the raw data and fitted parameters

## Technical Details

### Configuration

All non-UI options live in `assets/js/config.js` as a single `DDRConfig` object that the app and models consume. Edit this file to change defaults without touching code.

- fitting:
  - `minPointsForFit`: Minimum points required before fitting.
  - `emaxMode`: How Emax is computed. Options:
    - `fromCurveAtMax` (default): evaluate the fitted curve at the maximum tested dose and report that %viability as Emax (smooths noise; Case‑1 style).
    - Other modes (e.g., using the observed value at max dose, or the minimum of the fitted curve across the tested range) can be added on request.
- rendering:
  - `curveResolution`: Number of line segments when drawing the curve.
- bounds:
  - `eInf`, `hillSlope`, `ec50` (log10): Parameter bounds used during fitting.
- optimizer:
  - `maxIterations`, `convergenceTolerance`: Nelder–Mead style settings (used by helpers).
  - `maxGDIter`, `gdAlpha`, `gdEps`, `gdBacktrackingMax`, `improvementTol`: Projected gradient controls for the Case‑1 phase.
- robust:
  - `huberDelta`: Huber loss delta (fractional residuals, default 0.05). Smaller values increase robustness and make Hill vs Huber more distinct.
  - `weights.endpoints`: Extra weight on first/last few points.
  - `weights.midpoint`: Extra weight on the midpoint (monophasic only).
  - `weights.enableMidpointForMonophasic`: Toggle midpoint weighting.
- mesh:
  - `densitiesMono`, `densitiesBiphasic`: Grid density per parameter for coarse mesh.
  - `stepScale`: Base factor to convert densities to step sizes (`step = stepScale/density`).
  - `span`, `precision`: Pattern search span and stopping precision.
  - `maxCandidates`: Limit candidates evaluated from the mesh (downsamples randomly when exceeded).
- initialParams:
  - `initialParamSets`: Number of initial sets when constructing a simplex.
  - `jitter.eInf`, `jitter.other`: Multiplicative jitter used to build local simplexes around seeds.

Example: to speed up fitting, reduce `mesh.maxCandidates` and `optimizer.maxGDIter`; to widen parameter search, adjust `bounds.*`.

### Curve Fitting Models

#### Monophasic (Hill Equation)

```
Viability = E_inf + (1 - E_inf) / (1 + (Conc/EC50)^HS)
```

- **HS**: Hill Slope (steepness of the curve)
- **E_inf**: Minimum viability (lower asymptote)
- **EC50**: Concentration at 50% effect

#### Biphasic Model

```
Viability = Phase1 × Phase2
```

Where each phase follows a Hill-like equation with independent parameters.

### Loss Options

- **Hill**: Standard least-squares fitting (SSE)
- **Huber**: Robust Huber regression (fractional residuals) with extra weight on endpoints and the mid-curve

### Implementation

- Pure JavaScript implementation with no external dependencies
- Uses a Case‑1–style pipeline: data‑guided start → bounded gradient attempt → mesh evaluation → pattern search (all with robust/SSE objective and bounds)
- Canvas-based visualization for smooth rendering
- Split into semantic files: styles in `assets/css/`, scripts in `assets/js/`

## File Structure

```
ddr_demo/
├── index.html                # Main application interface
├── assets/
│   ├── css/
│   │   └── styles.css        # All styles
│   └── js/
│       ├── config.js         # Centralized, non-UI configuration (DDRConfig)
│       ├── app.js            # UI, interactions, rendering orchestration
│       └── models.js         # Models, losses, optimizer, metrics
└── README.md                 # This file
```

## Tips for Best Results

1. **Data Point Placement**:

   - Distribute points across the concentration range
   - Include points in the transition region for better curve fitting
   - Aim for at least 3 unique dose levels

2. **Model Selection**:

   - Use **monophasic** for simple sigmoidal responses
   - Use **biphasic** when you observe two distinct response phases

3. **Loss Choice**:
   - Use **Hill** for clean, well-behaved data
   - Use **Huber** when data contains outliers or noise

## Understanding the Metrics

- **R-squared**: Measures goodness of fit (0-1, higher is better)

  - \> 0.9: Excellent fit (green)
  - 0.7-0.9: Good fit (yellow)
  - < 0.7: Poor fit (red)

- **IC50**: Drug concentration needed to inhibit 50% of biological activity

  - Displayed in scientific notation
  - Lower values indicate higher potency
  - For biphasic fits, IC50 is taken from a companion Hill fit for stability (as in Case 1)

- **AUC**: Area Under the Curve

  - Trapezoidal integral on log10(concentration) vs capped %viability, divided by 100
  - Not normalized by the x-range; values depend on the tested span

- **Emax**: Fitted %viability at the maximum tested dose (reported in CSV)

## Troubleshooting

- **Curve not appearing**: Ensure you have at least 5 points (preferably at unique doses)
- **Poor fit**: Try switching between monophasic/biphasic models or Hill/Huber loss
- **Export not working**: Check browser permissions for downloads

## License

This demo is provided as-is for educational and research purposes.

## Acknowledgments

Inspired by the curve fitting workflow in the PharmacoGX R package; this demo mirrors the 3‑parameter Hill model and a biphasic variant, with robust Huber weighting similar to the R code.
