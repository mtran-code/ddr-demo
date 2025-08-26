# Drug Dose Response Curve Fitting Demo

An interactive web-based tool for visualizing and fitting drug dose-response curves with support for both monophasic and biphasic models.

## Features

- **Interactive plotting**: Click anywhere on the canvas to add data points
- **Automatic curve fitting**: After 5+ points, curves are automatically fitted
- **Multiple fit types**: 
  - Monophasic (Hill equation)
  - Biphasic (two-phase response)
- **Algorithm options**:
  - Hill (standard least squares)
  - Huber (robust fitting with outlier resistance)
- **Real-time metrics**:
  - R-squared (goodness of fit)
  - IC50 (half-maximal inhibitory concentration)
  - AUC (Area Under the Curve)
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
   - After adding 5 or more points, a curve will automatically be fitted
   - The red line shows the fitted curve
   - Metrics update in real-time on the right panel

4. **Experiment with options**:
   - Toggle between **Monophasic** and **Biphasic** fits
   - Switch between **Hill** and **Huber** algorithms
   - Compare how different models and algorithms handle your data

5. **Export your results**:
   - Click "Export as PNG" to save the plot
   - Click "Export Data as CSV" to download the raw data and fitted parameters

## Technical Details

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

### Algorithm Options

- **Hill**: Standard least-squares fitting
- **Huber**: Robust regression that reduces the influence of outliers

### Implementation

- Pure JavaScript implementation with no external dependencies
- Uses Nelder-Mead optimization for parameter estimation
- Canvas-based visualization for smooth rendering
- Responsive design that works on desktop and mobile

## File Structure

```
ddr_demo/
├── index.html           # Main application interface
├── ddr-curve-fitting.js # Core fitting algorithms and visualization
├── README.md           # This file
├── SPEC.md            # Original specification
└── PharmacoGX3/       # Reference R implementation
```

## Browser Compatibility

Works on all modern browsers:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Tips for Best Results

1. **Data Point Placement**: 
   - Distribute points across the concentration range
   - Include points in the transition region for better curve fitting

2. **Model Selection**:
   - Use **monophasic** for simple sigmoidal responses
   - Use **biphasic** when you observe two distinct response phases

3. **Algorithm Choice**:
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

- **AUC**: Area Under the Curve
  - Normalized measure of overall drug effect
  - Range: 0-1 (lower values indicate stronger effect)

## Troubleshooting

- **Curve not appearing**: Ensure you have at least 5 data points
- **Poor fit**: Try switching between monophasic/biphasic models or Hill/Huber algorithms
- **Export not working**: Check browser permissions for downloads

## License

This demo is provided as-is for educational and research purposes.

## Acknowledgments

Based on the curve fitting algorithms from the PharmacoGX R package and optimized implementations for drug dose-response analysis.