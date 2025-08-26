class DDRCurveFitting {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.dataPoints = [];
        this.fittedCurve = null;
        this.fitType = 'monophasic';
        this.algorithm = 'huber';
        this.metrics = {
            rSquared: null,
            ic50: null,
            auc: null,
            emax: null
        };
        
        // Advanced configuration parameters
        this.advancedConfig = {
            maxIterations: 1000,
            convergenceTolerance: 1e-6,
            // Huber delta on fractional scale (0..1), aligned with R
            huberDelta: 1.0,
            // Align with R minimum requirement of >=3 points
            minPointsForFit: 3,
            curveResolution: 200,
            initialParamSets: 5,
            // Emax metric mode: 'fromCurveAtMax' to mimic R (default), or 'none'
            emaxMode: 'fromCurveAtMax',
            bounds: {
                // Parameter bounds aligned to R helpers (3PL and biphasic)
                eInf: { min: 0, max: 1.0 },
                hillSlope: { min: 0.0, max: 4.0 },
                // log10(EC50) bounds; we sample in log space and exponentiate
                ec50: { min: -6, max: 6 }
            }
        };
        
        // No caching: always refit after any change
        
        this.setupCanvas();
        this.setupEventListeners();
        this.loadAdvancedConfig();
        this.draw();
    }

    setupCanvas() {
        const resizeCanvas = () => {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.draw();
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        
        const fitTypeToggle = document.getElementById('fitTypeToggle');
        fitTypeToggle.addEventListener('click', () => {
            fitTypeToggle.classList.toggle('right');
            const isRight = fitTypeToggle.classList.contains('right');
            this.fitType = isRight ? 'biphasic' : 'monophasic';
            fitTypeToggle.querySelector('.toggle-slider').textContent = isRight ? 'Biphasic' : 'Monophasic';
            this.fitCurve();
            this.draw();
        });

        const algo = document.getElementById('algorithmSelect');
        if (algo) {
            algo.addEventListener('change', (e) => {
                this.algorithm = e.target.value;
                this.fitCurve();
                this.draw();
            });
        }

        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
        document.getElementById('exportPngBtn').addEventListener('click', () => this.exportPng());
        document.getElementById('exportCsvBtn').addEventListener('click', () => this.exportCsv());
        // No advanced configuration handlers (parity with R)
    }

    handleCanvasClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const round5 = (v) => Math.round(v * 1e5) / 1e5;
        const concentration = round5(this.pixelToConcentration(x));
        const viability = round5(this.pixelToViability(y));
        
        this.dataPoints.push({ concentration, viability });
        this.updateStats();
        this.fitCurve();
        this.draw();
    }

    pixelToConcentration(x) {
        const padding = 60;
        const plotWidth = this.canvas.width - 2 * padding;
        const logMin = -3;
        const logMax = 2;
        const logValue = logMin + (x - padding) / plotWidth * (logMax - logMin);
        return Math.pow(10, logValue);
    }

    pixelToViability(y) {
        const padding = 40;
        const plotHeight = this.canvas.height - 2 * padding;
        return 100 * (1 - (y - padding) / plotHeight);
    }

    concentrationToPixel(concentration) {
        const padding = 60;
        const plotWidth = this.canvas.width - 2 * padding;
        const logMin = -3;
        const logMax = 2;
        const logValue = Math.log10(concentration);
        return padding + (logValue - logMin) / (logMax - logMin) * plotWidth;
    }

    viabilityToPixel(viability) {
        const padding = 40;
        const plotHeight = this.canvas.height - 2 * padding;
        return padding + (1 - viability / 100) * plotHeight;
    }

    // 3-parameter Hill (top fixed at 1.0), returns fraction in [0,1]
    hillFunction(x, params) {
        const [hs, eInf, ec50] = params;
        const logX = Math.log10(x);
        const logEC50 = Math.log10(ec50);
        // Equivalent to: eInf + (1 - eInf) / (1 + (x/ec50)^hs)
        return eInf + (1 - eInf) / (1 + Math.pow(10, hs * (logX - logEC50)));
    }

    // 6-parameter biphasic: product of two 3PL Hill curves, returns fraction
    biphasicFunction(x, params) {
        const [hs1, eInf1, ec501, hs2, eInf2, ec502] = params;
        const phase1 = this.hillFunction(x, [hs1, eInf1, ec501]);
        const phase2 = this.hillFunction(x, [hs2, eInf2, ec502]);
        return phase1 * phase2;
    }

    huberLoss(residual, delta = 1.0) {
        const absResidual = Math.abs(residual);
        if (absResidual <= delta) {
            return 0.5 * residual * residual;
        } else {
            return delta * (absResidual - 0.5 * delta);
        }
    }

    // Objective on fractional residuals (0..1); supports Huber or SSE and bound penalties
    objectiveFunction(params, dataPoints, fitType, useHuber = true) {
        const { bounds, huberDelta } = this.advancedConfig;
        // Bounds check
        const inRange = (v, lo, hi) => v >= lo && v <= hi;
        if (fitType === 'biphasic') {
            const [hs1, eInf1, ec501, hs2, eInf2, ec502] = params;
            if (!(
                inRange(hs1, bounds.hillSlope.min, bounds.hillSlope.max) &&
                inRange(hs2, bounds.hillSlope.min, bounds.hillSlope.max) &&
                inRange(eInf1, bounds.eInf.min, bounds.eInf.max) &&
                inRange(eInf2, bounds.eInf.min, bounds.eInf.max) &&
                inRange(Math.log10(ec501), bounds.ec50.min, bounds.ec50.max) &&
                inRange(Math.log10(ec502), bounds.ec50.min, bounds.ec50.max)
            )) return 1e12;
        } else {
            const [hs, eInf, ec50] = params;
            if (!(
                inRange(hs, bounds.hillSlope.min, bounds.hillSlope.max) &&
                inRange(eInf, bounds.eInf.min, bounds.eInf.max) &&
                inRange(Math.log10(ec50), bounds.ec50.min, bounds.ec50.max)
            )) return 1e12;
        }

        let total = 0;
        const n = dataPoints.length;
        for (let i = 0; i < n; i++) {
            const point = dataPoints[i];
            const predictedFrac = fitType === 'biphasic'
                ? this.biphasicFunction(point.concentration, params)
                : this.hillFunction(point.concentration, params);
            const observedFrac = point.viability / 100;
            const r = observedFrac - predictedFrac;
            // endpoint/midpoint weighting similar to R
            let w = 1;
            if (i === 0 || i === 1 || i === n - 2 || i === n - 1) w = 10;
            if (fitType !== 'biphasic') {
                const mid = Math.floor(n / 2);
                if (i === mid) w = 10;
            }
            const loss = useHuber ? this.huberLoss(r, huberDelta) : (r * r);
            total += w * loss;
        }
        return total;
    }

    

    nelderMead(fn, initialSimplex, maxIterations = null, tolerance = null) {
        if (!maxIterations) maxIterations = this.advancedConfig.maxIterations;
        if (!tolerance) tolerance = this.advancedConfig.convergenceTolerance;
        const alpha = 1.0;
        const gamma = 2.0;
        const rho = 0.5;
        const sigma = 0.5;
        
        let simplex = initialSimplex.map(point => ({
            point: point,
            value: fn(point)
        }));
        
        for (let iteration = 0; iteration < maxIterations; iteration++) {
            simplex.sort((a, b) => a.value - b.value);
            
            const best = simplex[0];
            const worst = simplex[simplex.length - 1];
            const secondWorst = simplex[simplex.length - 2];
            
            const centroid = [];
            for (let i = 0; i < best.point.length; i++) {
                let sum = 0;
                for (let j = 0; j < simplex.length - 1; j++) {
                    sum += simplex[j].point[i];
                }
                centroid[i] = sum / (simplex.length - 1);
            }
            
            const reflection = [];
            for (let i = 0; i < centroid.length; i++) {
                reflection[i] = centroid[i] + alpha * (centroid[i] - worst.point[i]);
            }
            const reflectionValue = fn(reflection);
            
            if (reflectionValue < best.value) {
                const expansion = [];
                for (let i = 0; i < centroid.length; i++) {
                    expansion[i] = centroid[i] + gamma * (reflection[i] - centroid[i]);
                }
                const expansionValue = fn(expansion);
                
                if (expansionValue < reflectionValue) {
                    worst.point = expansion;
                    worst.value = expansionValue;
                } else {
                    worst.point = reflection;
                    worst.value = reflectionValue;
                }
            } else if (reflectionValue < secondWorst.value) {
                worst.point = reflection;
                worst.value = reflectionValue;
            } else {
                const contraction = [];
                if (reflectionValue < worst.value) {
                    for (let i = 0; i < centroid.length; i++) {
                        contraction[i] = centroid[i] + rho * (reflection[i] - centroid[i]);
                    }
                } else {
                    for (let i = 0; i < centroid.length; i++) {
                        contraction[i] = centroid[i] + rho * (worst.point[i] - centroid[i]);
                    }
                }
                const contractionValue = fn(contraction);
                
                if (contractionValue < worst.value) {
                    worst.point = contraction;
                    worst.value = contractionValue;
                } else {
                    for (let i = 1; i < simplex.length; i++) {
                        for (let j = 0; j < simplex[i].point.length; j++) {
                            simplex[i].point[j] = best.point[j] + sigma * (simplex[i].point[j] - best.point[j]);
                        }
                        simplex[i].value = fn(simplex[i].point);
                    }
                }
            }
            
            const range = worst.value - best.value;
            if (range < tolerance) {
                break;
            }
        }
        
        simplex.sort((a, b) => a.value - b.value);
        return simplex[0].point;
    }

    generateInitialParams(type) {
        const { bounds } = this.advancedConfig;
        const numSets = this.advancedConfig.initialParamSets;
        const params = [];
        // Randomized initial params (no deterministic seeding)
        
        for (let i = 0; i < numSets; i++) {
            if (type === 'biphasic') {
                params.push([
                    this.randomInRange(bounds.hillSlope.min, bounds.hillSlope.max),
                    this.randomInRange(bounds.eInf.min, bounds.eInf.max),
                    Math.pow(10, this.randomInRange(bounds.ec50.min, bounds.ec50.max)),
                    this.randomInRange(bounds.hillSlope.min, bounds.hillSlope.max),
                    this.randomInRange(bounds.eInf.min, bounds.eInf.max),
                    Math.pow(10, this.randomInRange(bounds.ec50.min, bounds.ec50.max))
                ]);
            } else {
                params.push([
                    this.randomInRange(bounds.hillSlope.min, bounds.hillSlope.max),
                    this.randomInRange(bounds.eInf.min, bounds.eInf.max),
                    Math.pow(10, this.randomInRange(bounds.ec50.min, bounds.ec50.max))
                ]);
            }
        }
        // Ensure simplex has at least dim+1 vertices for Nelder–Mead
        const dim = (type === 'biphasic') ? 6 : 3;
        const need = Math.max(0, (dim + 1) - params.length);
        if (need > 0) {
            const base = params[0] || (type === 'biphasic'
                ? [1.0, 0.1, 1.0, 1.5, 0.2, 10.0]
                : [1.0, 0.1, 1.0]);
            for (let k = 0; k < need; k++) {
                const p = base.slice();
                const j = k % dim;
                const eps = (j === 1) ? 0.02 : 0.1; // smaller step for E_inf
                p[j] = p[j] * (1 + eps);
                // keep EC50 positive
                if (type === 'biphasic') {
                    if (j === 2 || j === 5) p[j] = Math.max(p[j], 1e-6);
                } else {
                    if (j === 2) p[j] = Math.max(p[j], 1e-6);
                }
                params.push(p);
            }
        }

        return params;
    }
    
    randomInRange(min, max, seed = null) {
        if (seed !== null) {
            // Simple deterministic pseudo-random based on seed
            const x = Math.sin(seed) * 10000;
            const pseudo = x - Math.floor(x);
            return min + pseudo * (max - min);
        }
        return min + Math.random() * (max - min);
    }
    
    // No data hashing / cache fingerprinting — always refit

    fitCurve() {
        if (this.dataPoints.length < this.advancedConfig.minPointsForFit) {
            this.fittedCurve = null;
            return;
        }

        const sortedPoints = this.getSortedDataPoints();
        const useHuber = this.algorithm === 'huber';
        // Always fit the curve (no caching)
        if (this.fitType === 'biphasic') {
            const initialParams = this.generateInitialParams('biphasic');
            const objFn = (params) => this.objectiveFunction(params, sortedPoints, 'biphasic', useHuber);
            this.fittedCurve = {
                type: 'biphasic',
                params: this.nelderMead(objFn, initialParams)
            };
        } else {
            const initialParams = this.generateInitialParams('monophasic');
            const objFn = (params) => this.objectiveFunction(params, sortedPoints, 'monophasic', useHuber);
            this.fittedCurve = {
                type: 'monophasic',
                params: this.nelderMead(objFn, initialParams)
            };
        }

        this.calculateMetrics(sortedPoints);
        this.updateStats();
    }

    calculateMetrics(sortedPoints) {
        if (!this.fittedCurve || sortedPoints.length < this.advancedConfig.minPointsForFit) {
            this.metrics = { rSquared: null, ic50: null, auc: null, emax: null };
            return;
        }

        let sumSquaredResiduals = 0;
        let sumSquaredTotal = 0;
        const meanViability = sortedPoints.reduce((sum, p) => sum + p.viability, 0) / sortedPoints.length;

        for (const point of sortedPoints) {
            const predicted = this.fittedCurve.type === 'biphasic'
                ? this.biphasicFunction(point.concentration, this.fittedCurve.params) * 100
                : this.hillFunction(point.concentration, this.fittedCurve.params) * 100;
            
            sumSquaredResiduals += Math.pow(point.viability - predicted, 2);
            sumSquaredTotal += Math.pow(point.viability - meanViability, 2);
        }

        this.metrics.rSquared = sumSquaredTotal > 0 ? 1 - (sumSquaredResiduals / sumSquaredTotal) : 0;

        if (this.fittedCurve.type === 'monophasic') {
            const [hs, eInf, ec50] = this.fittedCurve.params;
            const n = 0.5; // target fraction
            if (n >= eInf && n <= 1.0 && (0.5 - eInf) > 0) {
                // EC50 * (0.5/(0.5 - e_inf))^(1/hs)
                this.metrics.ic50 = ec50 * Math.pow(0.5 / (0.5 - eInf), 1 / hs);
            } else {
                this.metrics.ic50 = null;
            }
        } else {
            // For biphasic, mirror R: use EC50 from Hill (monophasic) fit
            const mono = this.fitMonophasicForIC50(sortedPoints);
            if (mono) {
                const [, , ec50] = mono;
                this.metrics.ic50 = ec50;
            }
        }

        // AUC on sorted paired x/y
        const xs = sortedPoints.map(p => Math.log10(p.concentration));
        const ys = sortedPoints.map(p => Math.min(p.viability, 100));
        let auc = 0;
        for (let i = 0; i < xs.length - 1; i++) {
            const x1 = xs[i];
            const x2 = xs[i + 1];
            const y1 = ys[i];
            const y2 = ys[i + 1];
            auc += ((y1 + y2) / 2) * (x2 - x1);
        }
        this.metrics.auc = auc / 100;

        // Emax metric like R: fitted value at max tested concentration
        if (this.advancedConfig.emaxMode === 'fromCurveAtMax') {
            const maxConc = Math.max(...sortedPoints.map(p => p.concentration));
            const emaxPct = (this.fittedCurve.type === 'biphasic'
                ? this.biphasicFunction(maxConc, this.fittedCurve.params)
                : this.hillFunction(maxConc, this.fittedCurve.params)) * 100;
            this.metrics.emax = emaxPct;
        } else {
            this.metrics.emax = null;
        }
    }

    fitMonophasicForIC50(sortedPoints) {
        const { bounds } = this.advancedConfig;
        const initialParams = [
            [1.5, 0.1, 1.0],
            [2.0, 0.2, Math.pow(10, -1.0)]
        ];
        const useHuber = this.algorithm === 'huber';
        const objFn = (params) => this.objectiveFunction(params, sortedPoints, 'monophasic', useHuber);
        return this.nelderMead(objFn, initialParams);
    }

    updateStats() {
        document.getElementById('pointCount').textContent = this.dataPoints.length;
        
        this.updateDataTable();
        
        if (this.metrics.rSquared !== null) {
            const r2Element = document.getElementById('rSquaredValue');
            r2Element.textContent = this.metrics.rSquared.toFixed(4);
            
            if (this.metrics.rSquared > 0.9) {
                r2Element.className = 'stat-value good';
            } else if (this.metrics.rSquared > 0.7) {
                r2Element.className = 'stat-value medium';
            } else {
                r2Element.className = 'stat-value poor';
            }
        } else {
            document.getElementById('rSquaredValue').textContent = '--';
            document.getElementById('rSquaredValue').className = 'stat-value';
        }

        if (this.metrics.ic50 !== null && !isNaN(this.metrics.ic50) && isFinite(this.metrics.ic50)) {
            document.getElementById('ic50Value').textContent = this.metrics.ic50.toExponential(2);
        } else {
            document.getElementById('ic50Value').textContent = '--';
        }

        if (this.metrics.auc !== null) {
            document.getElementById('aucValue').textContent = this.metrics.auc.toFixed(3);
        } else {
            document.getElementById('aucValue').textContent = '--';
        }

        const statusElement = document.getElementById('fitStatus');
        if (this.dataPoints.length < this.advancedConfig.minPointsForFit) {
            statusElement.textContent = `Need ${this.advancedConfig.minPointsForFit - this.dataPoints.length} more points`;
            statusElement.style.color = '#6c757d';
        } else if (this.fittedCurve) {
            statusElement.textContent = 'Curve fitted';
            statusElement.style.color = '#28a745';
        } else {
            statusElement.textContent = 'Fitting failed';
            statusElement.style.color = '#dc3545';
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.drawAxes();
        this.drawGrid();
        
        if (this.fittedCurve) {
            this.drawFittedCurve();
        }
        
        this.drawDataPoints();
    }

    drawAxes() {
        const padding = 60;
        const topPadding = 40;
        const rightPadding = 40;
        
        this.ctx.strokeStyle = '#212529';
        this.ctx.lineWidth = 2;
        
        this.ctx.beginPath();
        this.ctx.moveTo(padding, topPadding);
        this.ctx.lineTo(padding, this.canvas.height - topPadding);
        this.ctx.lineTo(this.canvas.width - rightPadding, this.canvas.height - topPadding);
        this.ctx.stroke();
        
        this.ctx.fillStyle = '#212529';
        this.ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'center';
        
        for (let logConc = -3; logConc <= 2; logConc++) {
            const x = this.concentrationToPixel(Math.pow(10, logConc));
            this.ctx.fillText(`10^${logConc}`, x, this.canvas.height - topPadding + 20);
        }
        
        this.ctx.textAlign = 'right';
        for (let viability = 0; viability <= 100; viability += 25) {
            const y = this.viabilityToPixel(viability);
            this.ctx.fillText(`${viability}%`, padding - 10, y + 5);
        }
        
        this.ctx.save();
        this.ctx.translate(15, this.canvas.height / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.fillText('Viability (%)', 0, 0);
        this.ctx.restore();
        
        this.ctx.textAlign = 'center';
        this.ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.fillText('Concentration (µM)', this.canvas.width / 2, this.canvas.height - 10);
    }

    drawGrid() {
        const padding = 60;
        const topPadding = 40;
        const rightPadding = 40;
        
        this.ctx.strokeStyle = '#e9ecef';
        this.ctx.lineWidth = 1;
        
        for (let logConc = -3; logConc <= 2; logConc++) {
            const x = this.concentrationToPixel(Math.pow(10, logConc));
            this.ctx.beginPath();
            this.ctx.moveTo(x, topPadding);
            this.ctx.lineTo(x, this.canvas.height - topPadding);
            this.ctx.stroke();
        }
        
        for (let viability = 0; viability <= 100; viability += 25) {
            const y = this.viabilityToPixel(viability);
            this.ctx.beginPath();
            this.ctx.moveTo(padding, y);
            this.ctx.lineTo(this.canvas.width - rightPadding, y);
            this.ctx.stroke();
        }
    }

    drawDataPoints() {
        this.ctx.fillStyle = '#212529';
        
        for (const point of this.dataPoints) {
            const x = this.concentrationToPixel(point.concentration);
            const y = this.viabilityToPixel(point.viability);
            
            this.ctx.beginPath();
            this.ctx.arc(x, y, 5, 0, 2 * Math.PI);
            this.ctx.fill();
        }
    }

    drawFittedCurve() {
        const padding = 60;
        const rightPadding = 40;
        const numPoints = this.advancedConfig.curveResolution;
        
        this.ctx.strokeStyle = 'rgba(220, 53, 69, 0.8)';
        this.ctx.lineWidth = 3;
        
        this.ctx.beginPath();
        
        for (let i = 0; i <= numPoints; i++) {
            const x = padding + (i / numPoints) * (this.canvas.width - padding - rightPadding);
            const concentration = this.pixelToConcentration(x);
            
            const viability = this.fittedCurve.type === 'biphasic'
                ? this.biphasicFunction(concentration, this.fittedCurve.params) * 100
                : this.hillFunction(concentration, this.fittedCurve.params) * 100;
            
            const y = this.viabilityToPixel(viability);
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.stroke();
    }

    reset() {
        this.dataPoints = [];
        this.fittedCurve = null;
        this.metrics = { rSquared: null, ic50: null, auc: null };
        this.updateStats();
        this.draw();
    }

    exportPng() {
        const link = document.createElement('a');
        link.download = 'dose_response_curve.png';
        link.href = this.canvas.toDataURL();
        link.click();
    }

    exportCsv() {
        let csv = 'Concentration (µM),Viability (%)\n';
        
        const sortedPoints = this.getSortedDataPoints();
        for (const point of sortedPoints) {
            csv += `${point.concentration.toFixed(5)},${point.viability.toFixed(5)}\n`;
        }
        
        csv += '\nMetrics\n';
        csv += `R-squared,${this.metrics.rSquared !== null ? this.metrics.rSquared.toFixed(4) : 'N/A'}\n`;
        csv += `IC50,${this.metrics.ic50 !== null && !isNaN(this.metrics.ic50) ? this.metrics.ic50.toExponential(2) : 'N/A'}\n`;
        csv += `AUC,${this.metrics.auc !== null ? this.metrics.auc.toFixed(3) : 'N/A'}\n`;
        csv += `Fit Type,${this.fitType}\n`;
        csv += `Algorithm,${this.algorithm}\n`;
        if (this.metrics.emax !== null) {
            csv += `Emax_at_max_dose,${this.metrics.emax.toFixed(3)}\n`;
        }
        
        if (this.fittedCurve) {
            csv += '\nFitted Parameters\n';
            if (this.fittedCurve.type === 'monophasic') {
                csv += 'Hill Slope,E_inf,EC50\n';
                csv += `${this.fittedCurve.params[0]},${this.fittedCurve.params[1]},${this.fittedCurve.params[2]}\n`;
            } else {
                csv += 'HS1,E_inf1,EC50_1,HS2,E_inf2,EC50_2\n';
                csv += this.fittedCurve.params.join(',') + '\n';
            }
        }
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'dose_response_data.csv';
        link.click();
    }

    updateDataTable() {
        const tbody = document.getElementById('dataPointsTableBody');
        tbody.innerHTML = '';
        const sortedPoints = this.getSortedDataPoints();
        sortedPoints.forEach((point, index) => {
            const row = tbody.insertRow();
            
            const cellNum = row.insertCell(0);
            cellNum.className = 'point-number';
            cellNum.textContent = index + 1;
            
            const cellConc = row.insertCell(1);
            cellConc.textContent = point.concentration.toFixed(5);
            
            const cellViab = row.insertCell(2);
            cellViab.textContent = point.viability.toFixed(5);
        });
    }

    getSortedDataPoints() {
        // Always work on a sorted copy for computations and UI
        const copy = this.dataPoints.slice();
        copy.sort((a, b) => a.concentration - b.concentration);
        return copy;
    }
    
    loadAdvancedConfig() {
        // Advanced configuration removed for parity with R; nothing to load
    }
    
    resetAdvancedConfig() {
        // No-op
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DDRCurveFitting('plotCanvas');
});
