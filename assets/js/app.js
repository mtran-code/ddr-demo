// Uses global DDRModels loaded via <script src="assets/js/models.js"></script>

class DDRCurveFittingApp {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    this.dataPoints = [];
    this.fittedCurve = null;
    this.fitType = 'monophasic'; // or 'biphasic'
    this.algorithm = 'huber'; // 'hill' (OLS) or 'huber'
    this.metrics = { rSquared: null, ic50: null, auc: null, emax: null };

    // Centralized configuration (see assets/js/config.js)
    this.config = DDRConfig;

    this.setupCanvas();
    this.setupUI();
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
    this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
  }

  setupUI() {
    const fitTypeToggle = document.getElementById('fitTypeToggle');
    fitTypeToggle.addEventListener('click', () => {
      fitTypeToggle.classList.toggle('right');
      const isRight = fitTypeToggle.classList.contains('right');
      this.fitType = isRight ? 'biphasic' : 'monophasic';
      fitTypeToggle.querySelector('.toggle-slider').textContent = isRight
        ? 'Biphasic'
        : 'Monophasic';
      this.fitCurve();
      this.draw();
    });

    const algoToggle = document.getElementById('algoToggle');
    if (algoToggle) {
      // Initialize visual to match default (Huber => right)
      if (!algoToggle.classList.contains('right')) algoToggle.classList.add('right');
      algoToggle.querySelector('.toggle-slider').textContent = 'Huber';
      algoToggle.addEventListener('click', () => {
        algoToggle.classList.toggle('right');
        const isRight = algoToggle.classList.contains('right');
        this.algorithm = isRight ? 'huber' : 'hill';
        algoToggle.querySelector('.toggle-slider').textContent = isRight ? 'Huber' : 'Hill';
        this.fitCurve();
        this.draw();
      });
    }

    document.getElementById('resetBtn').addEventListener('click', () => this.reset());
    document.getElementById('exportPngBtn').addEventListener('click', () => this.exportPng());
    document.getElementById('exportCsvBtn').addEventListener('click', () => this.exportCsv());
  }

  onCanvasClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const concentration = this.pixelToConcentration(x);
    const viability = this.pixelToViability(y);

    const r5 = (v) => Math.round(v * 1e5) / 1e5;
    this.dataPoints.push({ concentration: r5(concentration), viability: r5(viability) });
    this.updateStats();
    this.fitCurve();
    this.draw();
  }

  // Coordinate transforms
  pixelToConcentration(x) {
    const padding = 60;
    const plotWidth = this.canvas.width - 2 * padding;
    const logMin = -3;
    const logMax = 2;
    const logValue = logMin + ((x - padding) / plotWidth) * (logMax - logMin);
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
    return padding + ((logValue - logMin) / (logMax - logMin)) * plotWidth;
  }
  viabilityToPixel(viability) {
    const padding = 40;
    const plotHeight = this.canvas.height - 2 * padding;
    return padding + (1 - viability / 100) * plotHeight;
  }

  // Fitting
  fitCurve() {
    if (this.dataPoints.length < this.config.fitting.minPointsForFit) {
      this.fittedCurve = null;
      this.updateStats();
      return;
    }
    const sorted = this.getSortedDataPoints();

    if (this.fitType === 'biphasic') {
      const params = DDRModels.fitCase1Strategy('biphasic', sorted, this.config, this.algorithm);
      this.fittedCurve = { type: 'biphasic', params };
    } else {
      const params = DDRModels.fitCase1Strategy('monophasic', sorted, this.config, this.algorithm);
      this.fittedCurve = { type: 'monophasic', params };
    }

    this.metrics = DDRModels.calculateMetrics(
      this.fittedCurve,
      sorted,
      this.config,
      this.algorithm,
      (pts, cfg, algo) => DDRModels.fitMonophasicForIC50(pts, cfg, algo)
    );
    this.updateStats();
  }

  // Rendering
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawAxes();
    this.drawGrid();
    if (this.fittedCurve) this.drawFittedCurve();
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
    this.ctx.fillStyle = '#212529'; // black-ish
    for (const p of this.dataPoints) {
      const x = this.concentrationToPixel(p.concentration);
      const y = this.viabilityToPixel(p.viability);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 5, 0, 2 * Math.PI);
      this.ctx.fill();
    }
  }

  drawFittedCurve() {
    const padding = 60;
    const rightPadding = 40;
    const n = this.config.rendering.curveResolution;
    this.ctx.strokeStyle = 'rgba(220, 53, 69, 0.8)'; // light red
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = padding + (i / n) * (this.canvas.width - padding - rightPadding);
      const conc = this.pixelToConcentration(x);
      const v =
        (this.fitType === 'biphasic'
          ? DDRModels.biphasicFunction(conc, this.fittedCurve.params)
          : DDRModels.hillFunction(conc, this.fittedCurve.params)) * 100;
      const y = this.viabilityToPixel(v);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
  }

  // Stats and export
  updateStats() {
    document.getElementById('pointCount').textContent = this.dataPoints.length;
    this.updateDataTable();

    const r2El = document.getElementById('rSquaredValue');
    if (this.metrics.rSquared !== null) {
      r2El.textContent = this.metrics.rSquared.toFixed(4);
      if (this.metrics.rSquared > 0.9) r2El.className = 'stat-value good';
      else if (this.metrics.rSquared > 0.7) r2El.className = 'stat-value medium';
      else r2El.className = 'stat-value poor';
    } else {
      r2El.textContent = '--';
      r2El.className = 'stat-value';
    }

    const ic50El = document.getElementById('ic50Value');
    if (this.metrics.ic50 !== null && isFinite(this.metrics.ic50))
      ic50El.textContent = this.metrics.ic50.toExponential(2);
    else ic50El.textContent = '--';

    document.getElementById('aucValue').textContent =
      this.metrics.auc !== null ? this.metrics.auc.toFixed(3) : '--';

    const statusEl = document.getElementById('fitStatus');
    if (this.dataPoints.length < this.config.fitting.minPointsForFit) {
      statusEl.textContent = `Need ${this.config.fitting.minPointsForFit - this.dataPoints.length} more points`;
      statusEl.style.color = '#6c757d';
    } else if (this.fittedCurve) {
      statusEl.textContent = 'Curve fitted';
      statusEl.style.color = '#28a745';
    } else {
      statusEl.textContent = 'Fitting failed';
      statusEl.style.color = '#dc3545';
    }
  }

  exportPng() {
    const link = document.createElement('a');
    link.download = 'dose_response_curve.png';
    link.href = this.canvas.toDataURL();
    link.click();
  }

  exportCsv() {
    let csv = 'Concentration (µM),Viability (%)\n';
    const sorted = this.getSortedDataPoints();
    for (const p of sorted) csv += `${p.concentration.toFixed(5)},${p.viability.toFixed(5)}\n`;

    csv += '\nMetrics\n';
    csv += `R-squared,${this.metrics.rSquared !== null ? this.metrics.rSquared.toFixed(4) : 'N/A'}\n`;
    csv += `IC50,${this.metrics.ic50 !== null && !isNaN(this.metrics.ic50)
        ? this.metrics.ic50.toExponential(2)
        : 'N/A'
      }\n`;
    csv += `AUC,${this.metrics.auc !== null ? this.metrics.auc.toFixed(3) : 'N/A'}\n`;
    csv += `Fit Type,${this.fitType}\n`;
    csv += `Algorithm,${this.algorithm}\n`;
    if (this.metrics.emax !== null) csv += `Emax_at_max_dose,${this.metrics.emax.toFixed(3)}\n`;

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
    const sorted = this.getSortedDataPoints();
    sorted.forEach((p, idx) => {
      const row = tbody.insertRow();
      const c0 = row.insertCell(0);
      c0.className = 'point-number';
      c0.textContent = idx + 1;
      row.insertCell(1).textContent = p.concentration.toFixed(5);
      row.insertCell(2).textContent = p.viability.toFixed(5);
    });
  }

  getSortedDataPoints() {
    const copy = this.dataPoints.slice();
    copy.sort((a, b) => a.concentration - b.concentration);
    return copy;
  }

  reset() {
    this.dataPoints = [];
    this.fittedCurve = null;
    this.metrics = { rSquared: null, ic50: null, auc: null, emax: null };
    this.updateStats();
    this.draw();
  }
}

function initDDR() {
  new DDRCurveFittingApp('plotCanvas');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDDR);
} else {
  initDDR();
}
