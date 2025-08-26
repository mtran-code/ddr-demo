// Wrapped in IIFE to attach to window as DDRModels (for file:// compatibility)
(function (global) {
  function hillFunction(x, params) {
    const [hs, eInf, ec50] = params;
    const logX = Math.log10(x);
    const logEC50 = Math.log10(ec50);
    return eInf + (1 - eInf) / (1 + Math.pow(10, hs * (logX - logEC50)));
  }

  function biphasicFunction(x, params) {
    const [hs1, eInf1, ec501, hs2, eInf2, ec502] = params;
    const phase1 = hillFunction(x, [hs1, eInf1, ec501]);
    const phase2 = hillFunction(x, [hs2, eInf2, ec502]);
    return phase1 * phase2;
  }

  function huberLoss(residual, delta = 1.0) {
    const a = Math.abs(residual);
    return a <= delta ? 0.5 * residual * residual : delta * (a - 0.5 * delta);
  }

  function squaredLoss(residual) {
    return residual * residual;
  }

  function lossByName(name, residual, delta) {
    switch (name) {
      case 'huber':
        return huberLoss(residual, delta);
      case 'hill':
      case 'ols':
      default:
        return squaredLoss(residual);
    }
  }

  function objectiveFunction(params, dataPoints, fitType, config, algo) {
    const bounds = config.bounds;
    const huberDelta = (config.robust && config.robust.huberDelta) || config.huberDelta || 1.0;
    const inRange = (v, lo, hi) => v >= lo && v <= hi;

    if (fitType === 'biphasic') {
      const [hs1, eInf1, ec501, hs2, eInf2, ec502] = params;
      if (
        !(
          inRange(hs1, bounds.hillSlope.min, bounds.hillSlope.max) &&
          inRange(hs2, bounds.hillSlope.min, bounds.hillSlope.max) &&
          inRange(eInf1, bounds.eInf.min, bounds.eInf.max) &&
          inRange(eInf2, bounds.eInf.min, bounds.eInf.max) &&
          inRange(Math.log10(ec501), bounds.ec50.min, bounds.ec50.max) &&
          inRange(Math.log10(ec502), bounds.ec50.min, bounds.ec50.max)
        )
      )
        return 1e12;
    } else {
      const [hs, eInf, ec50] = params;
      if (
        !(
          inRange(hs, bounds.hillSlope.min, bounds.hillSlope.max) &&
          inRange(eInf, bounds.eInf.min, bounds.eInf.max) &&
          inRange(Math.log10(ec50), bounds.ec50.min, bounds.ec50.max)
        )
      )
        return 1e12;
    }

    let total = 0;
    const n = dataPoints.length;
    for (let i = 0; i < n; i++) {
      const p = dataPoints[i];
      const pred =
        fitType === 'biphasic'
          ? biphasicFunction(p.concentration, params)
          : hillFunction(p.concentration, params);
      const obs = p.viability / 100;
      const r = obs - pred;

      const weights = (config.robust && config.robust.weights) || {};
      let w = 1;
      if (i === 0 || i === 1 || i === n - 2 || i === n - 1) w = weights.endpoints || 10;
      if (fitType !== 'biphasic' && (weights.enableMidpointForMonophasic ?? true)) {
        const mid = Math.floor(n / 2);
        if (i === mid) w = weights.midpoint || 10;
      }

      total += w * lossByName(algo, r, huberDelta);
    }
    return total;
  }

  function nelderMead(fn, initialSimplex, config) {
    const maxIterations = (config.optimizer && config.optimizer.maxIterations) || config.maxIterations || 50000;
    const tolerance = (config.optimizer && config.optimizer.convergenceTolerance) || config.convergenceTolerance || 1e-6;
    const alpha = 1.0,
      gamma = 2.0,
      rho = 0.5,
      sigma = 0.5;

    let simplex = initialSimplex.map((pt) => ({ point: pt, value: fn(pt) }));

    for (let iter = 0; iter < maxIterations; iter++) {
      simplex.sort((a, b) => a.value - b.value);
      const best = simplex[0];
      const worst = simplex[simplex.length - 1];
      const secondWorst = simplex[simplex.length - 2];

      const centroid = [];
      for (let i = 0; i < best.point.length; i++) {
        let s = 0;
        for (let j = 0; j < simplex.length - 1; j++) s += simplex[j].point[i];
        centroid[i] = s / (simplex.length - 1);
      }

      const reflect = centroid.map((c, i) => c + alpha * (c - worst.point[i]));
      const fReflect = fn(reflect);

      if (fReflect < best.value) {
        const expand = centroid.map((c, i) => c + gamma * (reflect[i] - c));
        const fExpand = fn(expand);
        if (fExpand < fReflect) {
          worst.point = expand;
          worst.value = fExpand;
        } else {
          worst.point = reflect;
          worst.value = fReflect;
        }
      } else if (fReflect < secondWorst.value) {
        worst.point = reflect;
        worst.value = fReflect;
      } else {
        const contract = centroid.map((c, i) =>
          fReflect < worst.value ? c + rho * (reflect[i] - c) : c + rho * (worst.point[i] - c)
        );
        const fContract = fn(contract);
        if (fContract < worst.value) {
          worst.point = contract;
          worst.value = fContract;
        } else {
          for (let i = 1; i < simplex.length; i++) {
            for (let j = 0; j < simplex[i].point.length; j++) {
              simplex[i].point[j] = best.point[j] + sigma * (simplex[i].point[j] - best.point[j]);
            }
            simplex[i].value = fn(simplex[i].point);
          }
        }
      }

      if (worst.value - best.value < tolerance) break;
    }

    simplex.sort((a, b) => a.value - b.value);
    return simplex[0].point;
  }

  // Compute SSE and R^2 using plain squared error on % viability (for model selection)
  function r2ForParams(params, fitType, sortedPoints) {
    if (!sortedPoints || sortedPoints.length === 0) return { sse: Infinity, r2: -Infinity };
    let ssr = 0;
    let sst = 0;
    const meanY = sortedPoints.reduce((s, p) => s + p.viability, 0) / sortedPoints.length;
    for (const p of sortedPoints) {
      const pred =
        (fitType === 'biphasic'
          ? biphasicFunction(p.concentration, params)
          : hillFunction(p.concentration, params)) * 100;
      ssr += Math.pow(p.viability - pred, 2);
      sst += Math.pow(p.viability - meanY, 2);
    }
    const r2 = sst > 0 ? 1 - ssr / sst : 0;
    return { sse: ssr, r2 };
  }

  // Build a small simplex around a center point by multiplicative jittering
  function buildJitteredSimplex(center, fitType, jitter = 0.1) {
    const dim = fitType === 'biphasic' ? 6 : 3;
    const simplex = [center.slice()];
    for (let j = 0; j < dim; j++) {
      const p = center.slice();
      // Smaller jitter for eInf parameters (index 1 and 4) to keep within [0,1]
      const localJitter = j === 1 || j === 4 ? Math.min(0.05, jitter) : jitter;
      p[j] = Math.max(1e-9, p[j] * (1 + localJitter));
      simplex.push(p);
    }
    return simplex;
  }


  // Case 1 (PharmacoGX3) style strategy: gradient attempt with bounds, then mesh + pattern search fallback
  function computeGrittyGuess(fitType, sortedPoints, config) {
    const xs = sortedPoints.map((p) => Math.log10(p.concentration));
    const ys = sortedPoints.map((p) => Math.min(Math.max(p.viability / 100, 0), 1));
    const meanLogX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const eInf = Math.min(0.9, Math.max(0.0, Math.min(...ys) * 0.9));

    // Try to estimate log10(EC50) by bracketing 0.5
    let logEC50 = meanLogX;
    for (let i = 0; i < xs.length - 1; i++) {
      const y1 = ys[i];
      const y2 = ys[i + 1];
      if ((y1 - 0.5) * (y2 - 0.5) <= 0) {
        const t = (0.5 - y1) / (y2 - y1 || 1e-9);
        logEC50 = xs[i] + t * (xs[i + 1] - xs[i]);
        break;
      }
    }
    const ec50 = Math.max(1e-9, Math.pow(10, logEC50));

    if (fitType === 'biphasic') {
      // Use lower and upper quartiles as rough EC50s to induce two phases
      const sortedX = xs.slice().sort((a, b) => a - b);
      const q1 = sortedX[Math.floor(sortedX.length * 0.25)];
      const q3 = sortedX[Math.floor(sortedX.length * 0.75)];
      const ec1 = Math.max(1e-9, Math.pow(10, q1));
      const ec2 = Math.max(1e-9, Math.pow(10, q3));
      const e2 = Math.min(0.95, Math.max(eInf + 0.05, 0.0));
      return [1.2, eInf, ec1, 1.5, e2, ec2];
    }
    return [1.5, eInf, ec50];
  }

  function projectToBounds(p, fitType, config) {
    const b = config.bounds;
    const out = p.slice();
    if (fitType === 'biphasic') {
      // [hs1, e1, ec1, hs2, e2, ec2]
      out[0] = Math.min(b.hillSlope.max, Math.max(b.hillSlope.min, out[0]));
      out[1] = Math.min(b.eInf.max, Math.max(b.eInf.min, out[1]));
      out[2] = Math.pow(10, Math.min(b.ec50.max, Math.max(b.ec50.min, Math.log10(out[2]))));
      out[3] = Math.min(b.hillSlope.max, Math.max(b.hillSlope.min, out[3]));
      out[4] = Math.min(b.eInf.max, Math.max(b.eInf.min, out[4]));
      out[5] = Math.pow(10, Math.min(b.ec50.max, Math.max(b.ec50.min, Math.log10(out[5]))));
    } else {
      out[0] = Math.min(b.hillSlope.max, Math.max(b.hillSlope.min, out[0]));
      out[1] = Math.min(b.eInf.max, Math.max(b.eInf.min, out[1]));
      out[2] = Math.pow(10, Math.min(b.ec50.max, Math.max(b.ec50.min, Math.log10(out[2]))));
    }
    return out;
  }

  function finiteDiffGrad(obj, p, eps = 1e-6) {
    const g = new Array(p.length).fill(0);
    const f0 = obj(p);
    for (let i = 0; i < p.length; i++) {
      const pp = p.slice();
      pp[i] = pp[i] * (1 + eps) + (pp[i] === 0 ? eps : 0);
      const fi = obj(pp);
      g[i] = (fi - f0) / (pp[i] - p[i]);
    }
    return { f0, g };
  }

  function projectedGradDescent(obj, p0, fitType, config) {
    let p = projectToBounds(p0, fitType, config);
    let alpha = (config.optimizer && config.optimizer.gdAlpha) || 1.0;
    let fPrev = obj(p);
    const maxIter = Math.min(400, (config.optimizer && config.optimizer.maxGDIter) || config.maxGDIter || 200);
    for (let k = 0; k < maxIter; k++) {
      const { f0, g } = finiteDiffGrad(obj, p, (config.optimizer && config.optimizer.gdEps) || 1e-6);
      // simple diagonal scaling
      const step = g.map((gi) => -alpha * gi);
      let trial = p.map((pi, i) => pi + step[i]);
      trial = projectToBounds(trial, fitType, config);
      let fTrial = obj(trial);
      // backtracking line search
      let bt = 0;
      const btMax = (config.optimizer && config.optimizer.gdBacktrackingMax) || 10;
      while (fTrial > f0 && bt < btMax) {
        alpha *= 0.5;
        trial = projectToBounds(p.map((pi, i) => pi - alpha * g[i]), fitType, config);
        fTrial = obj(trial);
        bt++;
      }
      const tol = (config.optimizer && config.optimizer.improvementTol) || (config.convergenceTolerance || 1e-6);
      if (fTrial < fPrev - tol) {
        p = trial;
        fPrev = fTrial;
      } else {
        break;
      }
    }
    return p;
  }

  function meshEval(fitType, guess, sortedPoints, config, algo) {
    const inBounds = (p) => projectToBounds(p, fitType, config);
    let densities, steps;
    if (fitType === 'biphasic') {
      densities = (config.mesh && config.mesh.densitiesBiphasic) || [2, 10, 5, 2, 10, 5];
    } else {
      densities = (config.mesh && config.mesh.densitiesMono) || [2, 10, 5];
    }
    const stepScale = (config.mesh && config.mesh.stepScale) || 0.5;
    steps = densities.map((d) => stepScale / d);
    const b = config.bounds;
    const grid = [];
    const rangeFor = (idx) => {
      if (fitType === 'biphasic') {
        if (idx === 0 || idx === 3) return [b.hillSlope.min, b.hillSlope.max];
        if (idx === 1 || idx === 4) return [b.eInf.min, b.eInf.max];
        if (idx === 2 || idx === 5) return [b.ec50.min, b.ec50.max];
      } else {
        if (idx === 0) return [b.hillSlope.min, b.hillSlope.max];
        if (idx === 1) return [b.eInf.min, b.eInf.max];
        if (idx === 2) return [b.ec50.min, b.ec50.max];
      }
      return [0, 1];
    };
    const levels = densities.map((d, i) => {
      const [lo, hi] = rangeFor(i);
      const arr = [];
      for (let k = 0; k <= d; k++) arr.push(lo + (k / d) * (hi - lo));
      return arr;
    });
    // Build candidates from log-space for EC50 and direct for others
    function buildCandidates(idx, prefix) {
      if (idx === densities.length) {
        const p = prefix.slice();
        // convert ec50 log to linear
        if (fitType === 'biphasic') {
          p[2] = Math.pow(10, p[2]);
          p[5] = Math.pow(10, p[5]);
        } else {
          p[2] = Math.pow(10, p[2]);
        }
        grid.push(inBounds(p));
        return;
      }
      for (const v of levels[idx]) buildCandidates(idx + 1, prefix.concat([v]));
    }
    buildCandidates(0, []);
    // Downsample grid if too large (especially for biphasic)
    let candidates = grid;
    const maxCands = (config.mesh && config.mesh.maxCandidates) || 5000;
    if (candidates.length > maxCands) {
      const idxs = new Set();
      while (idxs.size < maxCands) idxs.add(Math.floor(Math.random() * candidates.length));
      candidates = Array.from(idxs).map((i) => grid[i]);
    }
    const obj = (p) => objectiveFunction(p, sortedPoints, fitType, config, algo);
    let best = { p: guess, val: obj(guess) };
    for (const cand of candidates) {
      const val = obj(cand);
      if (val < best.val) best = { p: cand, val };
    }
    const span = (config.mesh && config.mesh.span) || 1.0;
    const precision = (config.mesh && config.mesh.precision) || 1e-4;
    return { best: best.p, steps, span, precision };
  }

  function patternSearch(fitType, start, sortedPoints, config, algo, steps, span, precision) {
    const obj = (p) => objectiveFunction(p, sortedPoints, fitType, config, algo);
    let guess = start.slice();
    let guessVal = obj(guess);
    while (span > precision) {
      let improved = false;
      for (let i = 0; i < guess.length; i++) {
        for (const dir of [1, -1]) {
          let trial = guess.slice();
          const delta = dir * span * steps[i];
          trial[i] = trial[i] + delta;
          trial = projectToBounds(trial, fitType, config);
          const v = obj(trial);
          if (v < guessVal) {
            guess = trial;
            guessVal = v;
            improved = true;
          }
        }
      }
      if (!improved) span *= 0.5;
    }
    return guess;
  }

  function fitCase1Strategy(fitType, sortedPoints, config, algo) {
    const obj = (p) => objectiveFunction(p, sortedPoints, fitType, config, algo);
    // gritty guess from data
    let guess = computeGrittyGuess(fitType, sortedPoints, config);
    const guessVal = obj(guess);
    // Attempt gradient-like bounded improvement
    const pGD = projectedGradDescent(obj, guess, fitType, config);
    const pGDVal = obj(pGD);
    let current = pGDVal < guessVal ? pGD : guess;
    let currentVal = Math.min(pGDVal, guessVal);

    // If gradient attempt did not improve sufficiently, do mesh + pattern search
    const tol = (config.optimizer && config.optimizer.improvementTol) || 1e-6;
    if (!(currentVal < guessVal * (1 - tol))) {
      const { best, steps, span, precision } = meshEval(fitType, guess, sortedPoints, config, algo);
      current = patternSearch(fitType, best, sortedPoints, config, algo, steps, span, precision);
    }
    return current;
  }

  function calculateMetrics(fittedCurve, sortedPoints, config, algo, fitMonophasicForIC50Fn) {
    const minPts = (config.fitting && config.fitting.minPointsForFit) || config.minPointsForFit || 5;
    if (!fittedCurve || sortedPoints.length < minPts) {
      return { rSquared: null, ic50: null, auc: null, emax: null };
    }

    let ssr = 0;
    let sst = 0;
    const meanY = sortedPoints.reduce((s, p) => s + p.viability, 0) / sortedPoints.length;

    for (const p of sortedPoints) {
      const pred =
        (fittedCurve.type === 'biphasic'
          ? biphasicFunction(p.concentration, fittedCurve.params)
          : hillFunction(p.concentration, fittedCurve.params)) * 100;
      ssr += Math.pow(p.viability - pred, 2);
      sst += Math.pow(p.viability - meanY, 2);
    }
    const r2 = sst > 0 ? 1 - ssr / sst : 0;

    let ic50 = null;
    if (fittedCurve.type === 'monophasic') {
      const [hs, eInf, ec50] = fittedCurve.params;
      if (0.5 >= eInf && 0.5 <= 1.0 && 0.5 - eInf > 0) {
        ic50 = ec50 * Math.pow(0.5 / (0.5 - eInf), 1 / hs);
      }
    } else {
      const mono = fitMonophasicForIC50Fn(sortedPoints, config, algo);
      if (mono) ic50 = mono[2];
    }

    const xs = sortedPoints.map((p) => Math.log10(p.concentration));
    const ys = sortedPoints.map((p) => Math.min(p.viability, 100));
    let auc = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      auc += ((ys[i] + ys[i + 1]) / 2) * (xs[i + 1] - xs[i]);
    }
    auc /= 100;

    let emax = null;
    const emaxMode = (config.fitting && config.fitting.emaxMode) || config.emaxMode || 'fromCurveAtMax';
    if (emaxMode === 'fromCurveAtMax') {
      const maxConc = Math.max(...sortedPoints.map((p) => p.concentration));
      emax =
        (fittedCurve.type === 'biphasic'
          ? biphasicFunction(maxConc, fittedCurve.params)
          : hillFunction(maxConc, fittedCurve.params)) * 100;
    }

    return { rSquared: r2, ic50, auc, emax };
  }

  function fitMonophasicForIC50(sortedPoints, config, algo) {
    if (!sortedPoints || sortedPoints.length < 2) return null;
    // Small, targeted multi-start for IC50 estimation (monophasic only)
    const seeds = [];
    const xs = sortedPoints.map((p) => Math.log10(p.concentration));
    const ys = sortedPoints.map((p) => Math.min(Math.max(p.viability / 100, 0), 1));
    const meanLogX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const geoEC50 = Math.pow(10, meanLogX);
    const minY = Math.min(...ys);
    seeds.push([1.5, Math.min(0.9, Math.max(0.0, minY * 0.9)), Math.max(1e-6, geoEC50)]);
    seeds.push([1.0, 0.1, Math.pow(10, -1.0)]);
    seeds.push([2.5, 0.2, Math.pow(10, 0.0)]);

    const obj = (p) => objectiveFunction(p, sortedPoints, 'monophasic', config, algo);
    let best = null;
    for (const s of seeds) {
      const jOther = (config.initialParams && config.initialParams.jitter && config.initialParams.jitter.other) || 0.1;
      const simplex = buildJitteredSimplex(s, 'monophasic', jOther);
      const params = nelderMead(obj, simplex, config);
      const { sse } = r2ForParams(params, 'monophasic', sortedPoints);
      if (!best || sse < best.sse) best = { params, sse };
    }
    return best ? best.params : null;
  }

  global.DDRModels = {
    hillFunction,
    biphasicFunction,
    huberLoss,
    squaredLoss,
    lossByName,
    objectiveFunction,
    nelderMead,
    r2ForParams,
    buildJitteredSimplex,
    computeGrittyGuess,
    projectToBounds,
    fitCase1Strategy,
    calculateMetrics,
    fitMonophasicForIC50,
  };
})(window);
