/* CarbonTrace Pro — constrained recipe optimiser.
 * Exhaustive enumeration of a declared discrete design space, every point evaluated by the same engine:
 *   base-feed shares (SS / CS / pig iron) on a grid × Ni source split × electricity-mix options.
 * Alloy additions are re-solved for the grade aim at every point, so electricity demand, slag,
 * oxygen and carbon all respond to the charge. A point is feasible only if it passes every chemistry,
 * availability, decarburisation and power-availability check, plus the optional cost ceiling.
 * Result = best point for the objective, ranked alternatives and the cost–CO2e Pareto frontier.
 * This is the optimum of the searched grid, not a continuous global optimum.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};
  const E = () => CT.engine, U = () => CT.util;

  function shareGrid(s, step, enabled) {
    const out = [], seen = new Set(), add = (ss, cs) => {
      const pig = 100 - ss - cs; if (pig < -1e-9) return;
      const key = ss.toFixed(4) + '|' + cs.toFixed(4); if (seen.has(key)) return; seen.add(key);
      out.push({ ssScrap: ss, csScrap: cs, pigIron: Math.max(0, pig) });
    };
    add(s.shares.ssScrap, s.shares.csScrap);
    if (enabled) for (let i = 0; i * step <= 100 + 1e-9; i++) for (let j = 0; (i + j) * step <= 100 + 1e-9; j++) add(i * step, j * step);
    return out;
  }

  function nickelOptions(s, enabled) {
    const usesNi = CT.GRADES[s.grade].solve.includes('Ni');
    const set = new Set([s.niCathodeShare]);
    if (enabled && usesNi) [0, 25, 50, 75, 100].forEach(v => set.add(v));
    return [...set];
  }

  function powerOptions(s, enabled) {
    const cur = s.energy.mix, out = [], seen = new Set();
    const push = m => {
      const key = ['grid', 'captive', 'solar', 'wind'].map(k => m[k].toFixed(3)).join('|');
      if (!seen.has(key)) { seen.add(key); out.push(m); }
    };
    push(Object.assign({}, cur));
    if (!enabled) return out;
    const curRE = cur.solar + cur.wind, maxRE = s.limits.maxRE, maxCap = s.limits.maxCaptive;
    const reLevels = new Set([0, maxRE, curRE]);
    for (let v = 0; v <= maxRE + 1e-9; v += 10) reLevels.add(v);
    for (const re of reLevels) {
      if (re > maxRE + 1e-9) continue;
      const splits = [[1, 0], [0, 1]];
      if (curRE > 0) splits.push([cur.solar / curRE, cur.wind / curRE]);
      const rest = 100 - re, curNon = cur.grid + cur.captive;
      const captives = new Set([0, Math.min(maxCap, rest), Math.min(maxCap, curNon > 0 ? rest * cur.captive / curNon : 0)]);
      for (const [fs, fw] of splits) for (const cap of captives)
        push({ grid: Math.max(0, rest - cap), captive: cap, solar: re * fs, wind: re * fw });
    }
    return out;
  }

  function optimize(s, opts) {
    opts = Object.assign({ objective: 'co2', step: 5, levers: { charge: true, nickel: true, power: true }, maxCostIncreasePct: null, refCost: null, keepPoints: 2500 }, opts || {});
    const t0 = Date.now();
    const base = U().clone(s); base.mode = 'auto';
    const errs = E().validate(base);
    if (errs.length) return { ok: false, reason: errs[0].msg, evaluated: 0, feasible: 0 };
    const shares = shareGrid(base, opts.step, opts.levers.charge);
    const nis = nickelOptions(base, opts.levers.nickel);
    const mixes = powerOptions(base, opts.levers.power);
    const costCap = opts.maxCostIncreasePct !== null && opts.refCost !== null && Number.isFinite(opts.maxCostIncreasePct)
      ? opts.refCost * (1 + opts.maxCostIncreasePct / 100) : null;
    const y = base.energy.castYield, cp = base.econ.carbonPrice;
    const mixCoef = mixes.map(m => {
      let ef = 0, price = 0, re = 0;
      for (const k of Object.keys(CT.POWER_SOURCES)) {
        const f = m[k] / 100; ef += f * E().powerEF(base, k); price += f * base.prices[CT.POWER_SOURCES[k].price];
        if (CT.POWER_SOURCES[k].renewable) re += m[k];
      }
      return { ef, price, re, ok: re <= base.limits.maxRE + 1e-6 && m.captive <= base.limits.maxCaptive + 1e-6 };
    });
    const score = p => opts.objective === 'cost' ? p.cost : opts.objective === 'costCarbon' ? p.cost + p.co2 * cp : p.co2;
    const second = p => opts.objective === 'co2' ? p.cost : p.co2;
    let evaluated = 0, cores = 0, best = null;
    const points = [], reasons = {};
    for (const sh of shares) for (const ni of nis) {
      const sc = U().clone(base); sc.shares = sh; sc.niCathodeShare = ni;
      const c = E().core(sc); cores++;
      if (!c.ok) { evaluated += mixes.length; reasons[c.reason] = (reasons[c.reason] || 0) + mixes.length; continue; }
      // Constraint checks that do not depend on the electricity mix (evaluated once per charge).
      const fin = E().finish(sc, c);
      const fixedFail = fin.violations.filter(v => v.type !== 'power');
      if (fixedFail.length) { evaluated += mixes.length; reasons[fixedFail[0].type] = (reasons[fixedFail[0].type] || 0) + mixes.length; continue; }
      const nonPowerKg = U().sum(c.lines.map(l => l.kg)), nonPowerCost = U().sum(c.lines.map(l => l.cost)), kwh = c.pr.siteKwh;
      mixes.forEach((m, i) => {
        evaluated++;
        const mc = mixCoef[i];
        if (!mc.ok) { reasons.power = (reasons.power || 0) + 1; return; }
        const p = { shares: sh, ni, mix: m, co2: (nonPowerKg + kwh * mc.ef) / 1000 / y, cost: (nonPowerCost + kwh * mc.price) / y, re: mc.re };
        if (costCap !== null && p.cost > costCap + 1e-6) { reasons.cost = (reasons.cost || 0) + 1; return; }
        p.score = score(p);
        points.push(p);
        if (!best || p.score < best.score - 1e-9 || (Math.abs(p.score - best.score) <= 1e-9 && second(p) < second(best) - 1e-9)) best = p;
      });
    }
    const toScenario = p => { const n = U().clone(base); n.shares = Object.assign({}, p.shares); n.niCathodeShare = p.ni; n.energy.mix = Object.assign({}, p.mix); return n; };
    // Pareto frontier on (cost, co2): sort by cost then co2, keep strictly improving co2.
    const sorted = points.slice().sort((a, b) => a.cost - b.cost || a.co2 - b.co2), pareto = [];
    let minCo2 = Infinity;
    for (const p of sorted) if (p.co2 < minCo2 - 1e-9) { pareto.push(p); minCo2 = p.co2; }
    const ranked = points.slice().sort((a, b) => a.score - b.score || second(a) - second(b)).slice(0, 10);
    let sample = points;
    if (points.length > opts.keepPoints) { const k = points.length / opts.keepPoints; sample = []; for (let i = 0; i < points.length; i += k) sample.push(points[Math.floor(i)]); }
    const bestScenario = best ? toScenario(best) : null;
    return {
      ok: true, objective: opts.objective, step: opts.step, levers: opts.levers, costCap,
      evaluated, cores, feasible: points.length, ms: Date.now() - t0,
      best, bestScenario, bestResult: bestScenario ? E().calculate(bestScenario) : null,
      ranked: ranked.map(p => Object.assign({}, p, { scenario: toScenario(p) })), pareto, points: sample, reasons,
      space: { shares: shares.length, nickel: nis.length, power: mixes.length },
      reason: best ? '' : 'No combination in the searched space satisfies all constraints. Relax availability, chemistry, power or cost limits.'
    };
  }

  CT.optimizer = { optimize, shareGrid, powerOptions, nickelOptions };
})(typeof globalThis !== 'undefined' ? globalThis : this);
