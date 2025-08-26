class DDRCurveFitting {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.dataPoints = [];
        this.fittedCurve = null;
        this.fitType = 'monophasic';
        this.algorithm = 'hill';
        this.metrics = {
            rSquared: null,
            ic50: null,
            auc: null
        };
        
        // Advanced configuration parameters
        this.advancedConfig = {
            maxIterations: 1000,
            convergenceTolerance: 1e-6,
            huberDelta: 10,
            minPointsForFit: 5,
            curveResolution: 200,
            initialParamSets: 5,
            bounds: {
                eInf: { min: 0, max: 0.3 },
                eMax: { min: 0.8, max: 1.2 },
                hillSlope: { min: 0.5, max: 3 },
                ec50: { min: -2, max: 2 }  // log10 scale
            }
        };
        
        // Cache fitted parameters for consistent toggling
        this.cachedFits = {
            monophasic: null,
            biphasic: null
        };
        this.dataPointsHash = null;
        
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

        document.getElementById('algorithmSelect').addEventListener('change', (e) => {
            this.algorithm = e.target.value;
            this.fitCurve();
            this.draw();
        });

        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
        document.getElementById('exportPngBtn').addEventListener('click', () => this.exportPng());
        document.getElementById('exportCsvBtn').addEventListener('click', () => this.exportCsv());
        
        // Advanced configuration toggle
        const advancedConfigToggle = document.getElementById('advancedConfigToggle');
        const advancedConfig = document.getElementById('advancedConfig');
        advancedConfigToggle.addEventListener('click', () => {
            advancedConfig.classList.toggle('expanded');
        });
        
        // Advanced configuration inputs
        document.getElementById('maxIterations').addEventListener('change', (e) => {
            this.advancedConfig.maxIterations = parseInt(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('convergenceTolerance').addEventListener('change', (e) => {
            this.advancedConfig.convergenceTolerance = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('huberDelta').addEventListener('change', (e) => {
            this.advancedConfig.huberDelta = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('minPointsForFit').addEventListener('change', (e) => {
            this.advancedConfig.minPointsForFit = parseInt(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('curveResolution').addEventListener('change', (e) => {
            this.advancedConfig.curveResolution = parseInt(e.target.value);
            this.draw();
        });
        
        document.getElementById('initialParamSets').addEventListener('change', (e) => {
            this.advancedConfig.initialParamSets = parseInt(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        // Bounds inputs
        document.getElementById('eInfMin').addEventListener('change', (e) => {
            this.advancedConfig.bounds.eInf.min = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('eInfMax').addEventListener('change', (e) => {
            this.advancedConfig.bounds.eInf.max = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('eMaxMin').addEventListener('change', (e) => {
            this.advancedConfig.bounds.eMax.min = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('eMaxMax').addEventListener('change', (e) => {
            this.advancedConfig.bounds.eMax.max = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('hillSlopeMin').addEventListener('change', (e) => {
            this.advancedConfig.bounds.hillSlope.min = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('hillSlopeMax').addEventListener('change', (e) => {
            this.advancedConfig.bounds.hillSlope.max = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('ec50Min').addEventListener('change', (e) => {
            this.advancedConfig.bounds.ec50.min = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('ec50Max').addEventListener('change', (e) => {
            this.advancedConfig.bounds.ec50.max = parseFloat(e.target.value);
            this.fitCurve();
            this.draw();
        });
        
        document.getElementById('resetAdvancedBtn').addEventListener('click', () => {
            this.resetAdvancedConfig();
        });
    }

    handleCanvasClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const concentration = this.pixelToConcentration(x);
        const viability = this.pixelToViability(y);
        
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

    hillFunction(x, params) {
        const [hs, eInf, ec50, eMax] = params;
        const logX = Math.log10(x);
        const logEC50 = Math.log10(ec50);
        return eInf + (eMax - eInf) / (1 + Math.pow(10, hs * (logX - logEC50)));
    }

    biphasicFunction(x, params) {
        const [hs1, eInf1, ec501, eMax1, hs2, eInf2, ec502, eMax2] = params;
        const logX = Math.log10(x);
        const logEC501 = Math.log10(ec501);
        const logEC502 = Math.log10(ec502);
        
        const phase1 = eInf1 + (eMax1 - eInf1) / (1 + Math.pow(10, hs1 * (logX - logEC501)));
        const phase2 = eInf2 + (eMax2 - eInf2) / (1 + Math.pow(10, hs2 * (logX - logEC502)));
        
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

    objectiveFunction(params, dataPoints, fitType, useHuber = false) {
        let totalLoss = 0;
        const delta = this.advancedConfig.huberDelta;
        
        for (const point of dataPoints) {
            const predicted = fitType === 'biphasic' 
                ? this.biphasicFunction(point.concentration, params) * 100
                : this.hillFunction(point.concentration, params) * 100;
            
            const residual = point.viability - predicted;
            
            if (useHuber) {
                totalLoss += this.huberLoss(residual, delta);
            } else {
                totalLoss += residual * residual;
            }
        }
        
        return totalLoss;
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
        
        // Use data hash as seed for deterministic initial parameters
        const dataHash = this.createDataHash();
        
        for (let i = 0; i < numSets; i++) {
            if (type === 'biphasic') {
                params.push([
                    this.randomInRange(bounds.hillSlope.min, bounds.hillSlope.max, dataHash + i * 1000),
                    this.randomInRange(bounds.eInf.min, bounds.eInf.max, dataHash + i * 1000 + 1),
                    Math.pow(10, this.randomInRange(bounds.ec50.min, bounds.ec50.max, dataHash + i * 1000 + 2)),
                    this.randomInRange(bounds.eMax.min, bounds.eMax.max, dataHash + i * 1000 + 3),
                    this.randomInRange(bounds.hillSlope.min, bounds.hillSlope.max, dataHash + i * 1000 + 4),
                    this.randomInRange(bounds.eInf.min, bounds.eInf.max, dataHash + i * 1000 + 5),
                    Math.pow(10, this.randomInRange(bounds.ec50.min, bounds.ec50.max, dataHash + i * 1000 + 6)),
                    this.randomInRange(bounds.eMax.min, bounds.eMax.max, dataHash + i * 1000 + 7)
                ]);
            } else {
                params.push([
                    this.randomInRange(bounds.hillSlope.min, bounds.hillSlope.max, dataHash + i * 1000),
                    this.randomInRange(bounds.eInf.min, bounds.eInf.max, dataHash + i * 1000 + 1),
                    Math.pow(10, this.randomInRange(bounds.ec50.min, bounds.ec50.max, dataHash + i * 1000 + 2)),
                    this.randomInRange(bounds.eMax.min, bounds.eMax.max, dataHash + i * 1000 + 3)
                ]);
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
    
    createDataHash() {
        // Create a simple hash of data points for caching
        let hash = 0;
        const str = this.dataPoints.map(p => `${p.concentration.toFixed(6)},${p.viability.toFixed(2)}`).join('|');
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    fitCurve() {
        if (this.dataPoints.length < this.advancedConfig.minPointsForFit) {
            this.fittedCurve = null;
            this.cachedFits.monophasic = null;
            this.cachedFits.biphasic = null;
            this.dataPointsHash = null;
            return;
        }

        const currentHash = this.createDataHash();
        const useHuber = this.algorithm === 'huber';
        
        // Check if we have cached results for this data and can reuse them
        if (this.dataPointsHash === currentHash && this.cachedFits[this.fitType]) {
            this.fittedCurve = this.cachedFits[this.fitType];
        } else {
            // Fit the curve
            if (this.fitType === 'biphasic') {
                const initialParams = this.generateInitialParams('biphasic');
                
                const objFn = (params) => this.objectiveFunction(params, this.dataPoints, 'biphasic', useHuber);
                this.fittedCurve = {
                    type: 'biphasic',
                    params: this.nelderMead(objFn, initialParams)
                };
                
                // Cache the result
                this.cachedFits.biphasic = this.fittedCurve;
            } else {
                const initialParams = this.generateInitialParams('monophasic');
                
                const objFn = (params) => this.objectiveFunction(params, this.dataPoints, 'monophasic', useHuber);
                this.fittedCurve = {
                    type: 'monophasic',
                    params: this.nelderMead(objFn, initialParams)
                };
                
                // Cache the result
                this.cachedFits.monophasic = this.fittedCurve;
            }
            
            this.dataPointsHash = currentHash;
        }

        this.calculateMetrics();
        this.updateStats();
    }

    calculateMetrics() {
        if (!this.fittedCurve || this.dataPoints.length < 5) {
            this.metrics = { rSquared: null, ic50: null, auc: null };
            return;
        }

        let sumSquaredResiduals = 0;
        let sumSquaredTotal = 0;
        const meanViability = this.dataPoints.reduce((sum, p) => sum + p.viability, 0) / this.dataPoints.length;

        for (const point of this.dataPoints) {
            const predicted = this.fittedCurve.type === 'biphasic'
                ? this.biphasicFunction(point.concentration, this.fittedCurve.params) * 100
                : this.hillFunction(point.concentration, this.fittedCurve.params) * 100;
            
            sumSquaredResiduals += Math.pow(point.viability - predicted, 2);
            sumSquaredTotal += Math.pow(point.viability - meanViability, 2);
        }

        this.metrics.rSquared = sumSquaredTotal > 0 ? 1 - (sumSquaredResiduals / sumSquaredTotal) : 0;

        if (this.fittedCurve.type === 'monophasic') {
            const [hs, eInf, ec50, eMax] = this.fittedCurve.params;
            const n = 0.5;
            
            if (n >= eInf && n <= eMax) {
                this.metrics.ic50 = ec50 * Math.pow((n - eMax) / (eInf - n), 1 / hs);
            } else {
                this.metrics.ic50 = null;
            }
        } else {
            const monophasicParams = this.fitMonophasicForIC50();
            if (monophasicParams) {
                const [hs, eInf, ec50, eMax] = monophasicParams;
                const n = 0.5;
                
                if (n >= eInf && n <= eMax) {
                    this.metrics.ic50 = ec50 * Math.pow((n - eMax) / (eInf - n), 1 / hs);
                } else {
                    this.metrics.ic50 = null;
                }
            }
        }

        const xValues = this.dataPoints.map(p => Math.log10(p.concentration)).sort((a, b) => a - b);
        const yValues = this.dataPoints.map(p => Math.min(p.viability, 100));
        
        let auc = 0;
        for (let i = 0; i < xValues.length - 1; i++) {
            const x1 = xValues[i];
            const x2 = xValues[i + 1];
            const y1 = yValues[i];
            const y2 = yValues[i + 1];
            auc += ((y1 + y2) / 2) * (x2 - x1);
        }
        this.metrics.auc = auc / 100;
    }

    fitMonophasicForIC50() {
        const initialParams = [
            [1.5, 0.1, 1.0, 1.0],
            [2.0, 0.2, 0.5, 0.95]
        ];
        
        const objFn = (params) => this.objectiveFunction(params, this.dataPoints, 'monophasic', false);
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
        this.cachedFits.monophasic = null;
        this.cachedFits.biphasic = null;
        this.dataPointsHash = null;
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
        
        for (const point of this.dataPoints) {
            csv += `${point.concentration},${point.viability}\n`;
        }
        
        csv += '\nMetrics\n';
        csv += `R-squared,${this.metrics.rSquared !== null ? this.metrics.rSquared.toFixed(4) : 'N/A'}\n`;
        csv += `IC50,${this.metrics.ic50 !== null && !isNaN(this.metrics.ic50) ? this.metrics.ic50.toExponential(2) : 'N/A'}\n`;
        csv += `AUC,${this.metrics.auc !== null ? this.metrics.auc.toFixed(3) : 'N/A'}\n`;
        csv += `Fit Type,${this.fitType}\n`;
        csv += `Algorithm,${this.algorithm}\n`;
        
        if (this.fittedCurve) {
            csv += '\nFitted Parameters\n';
            if (this.fittedCurve.type === 'monophasic') {
                csv += 'Hill Slope,E_inf,EC50,E_max\n';
                csv += `${this.fittedCurve.params[0]},${this.fittedCurve.params[1]},${this.fittedCurve.params[2]},${this.fittedCurve.params[3]}\n`;
            } else {
                csv += 'HS1,E_inf1,EC50_1,E_max1,HS2,E_inf2,EC50_2,E_max2\n';
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
        
        this.dataPoints.forEach((point, index) => {
            const row = tbody.insertRow();
            
            const cellNum = row.insertCell(0);
            cellNum.className = 'point-number';
            cellNum.textContent = index + 1;
            
            const cellConc = row.insertCell(1);
            cellConc.textContent = point.concentration.toExponential(2);
            
            const cellViab = row.insertCell(2);
            cellViab.textContent = point.viability.toFixed(1);
        });
    }
    
    loadAdvancedConfig() {
        // Load values into UI
        document.getElementById('maxIterations').value = this.advancedConfig.maxIterations;
        document.getElementById('convergenceTolerance').value = this.advancedConfig.convergenceTolerance;
        document.getElementById('huberDelta').value = this.advancedConfig.huberDelta;
        document.getElementById('minPointsForFit').value = this.advancedConfig.minPointsForFit;
        document.getElementById('curveResolution').value = this.advancedConfig.curveResolution;
        document.getElementById('initialParamSets').value = this.advancedConfig.initialParamSets;
        
        document.getElementById('eInfMin').value = this.advancedConfig.bounds.eInf.min;
        document.getElementById('eInfMax').value = this.advancedConfig.bounds.eInf.max;
        document.getElementById('eMaxMin').value = this.advancedConfig.bounds.eMax.min;
        document.getElementById('eMaxMax').value = this.advancedConfig.bounds.eMax.max;
        document.getElementById('hillSlopeMin').value = this.advancedConfig.bounds.hillSlope.min;
        document.getElementById('hillSlopeMax').value = this.advancedConfig.bounds.hillSlope.max;
        document.getElementById('ec50Min').value = this.advancedConfig.bounds.ec50.min;
        document.getElementById('ec50Max').value = this.advancedConfig.bounds.ec50.max;
    }
    
    resetAdvancedConfig() {
        // Reset to defaults
        this.advancedConfig = {
            maxIterations: 1000,
            convergenceTolerance: 1e-6,
            huberDelta: 10,
            minPointsForFit: 5,
            curveResolution: 200,
            initialParamSets: 5,
            bounds: {
                eInf: { min: 0, max: 0.3 },
                eMax: { min: 0.8, max: 1.2 },
                hillSlope: { min: 0.5, max: 3 },
                ec50: { min: -2, max: 2 }
            }
        };
        
        this.loadAdvancedConfig();
        this.fitCurve();
        this.draw();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DDRCurveFitting('plotCanvas');
});