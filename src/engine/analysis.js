/* CarbonTrace Pro — sensitivity, sweeps, waterfall decomposition and lever attribution.
 * Everything re-runs the full engine; nothing here has its own emission equations.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};
  const E = () => CT.engine, U = () => CT.util;

  const TORNADO_PARAMS = [
    { path: 'factors.ef_grid', label: 'Grid emission factor' },
    { path: 'factors.ef_feNi', label: 'FeNi emission factor' },
    { path: 'factors.ef_niCathode', label: 'Ni cathode emission factor' },
    { path: 'factors.ef_feCr', label: 'FeCr emission factor' },
    { path: 'factors.ef_pigIron', label: 'Pig iron emission factor' },
    { path: 'factors.ef_ssScrap', label: 'SS scrap emission factor' },
    { path: 'factors.ef_feMo', label: 'FeMo emission factor' },
    { path: 'energy.heatRate', label: 'Captive heat rate' },
    { path: 'energy.lossKwh', label: 'Furnace thermal losses' },
    { path: 'energy.etaEl', label: 'Electrical efficiency' },
    { path: 'energy.auxKwh', label: 'Auxiliary electricity' },
    { path: 'recovery.Cr', label: 'Cr recovery (±3 pts)', absolute: 0.03 },
    { path: 'recovery.Fe', label: 'Fe recovery (±3 pts)', absolute: 0.03 },
    { path: 'shares.ssScrap', label: 'SS scrap share (±pts)', absolute: 10 }
  ];

  function fieldOf(path) { return CT.FIELDS.find(f => f.path === path); }

  function variant(s, path, value) {
    if (path.startsWith('shares.')) return E().withShares(s, path.split('.')[1], value);
    if (path.startsWith('energy.mix.')) return E().withMix(s, path.split('.')[2], value);
    const n = U().clone(s); U().set(n, path, value); return n;
  }

  // One-at-a-time ± perturbation of each parameter; alloys are re-solved (auto mode).
  function tornado(s, pct) {
    pct = pct || 20;
    const baseRes = E().calculate(s);
    if (!baseRes.ok) return { ok: false, reason: baseRes.reason, rows: [] };
    const rows = [];
    for (const p of TORNADO_PARAMS) {
      const v = U().get(s, p.path), f = fieldOf(p.path);
      if (typeof v !== 'number') continue;
      const lo = p.absolute ? v - p.absolute : v * (1 - pct / 100), hi = p.absolute ? v + p.absolute : v * (1 + pct / 100);
      const clamp = x => Math.min(f ? f.max : Infinity, Math.max(f ? f.min : -Infinity, x));
      const run = x => { const r = E().calculate(variant(s, p.path, clamp(x))); return r.ok ? r : null; };
      const rl = run(lo), rh = run(hi);
      if (!rl || !rh) continue;
      const dl = rl.kpi.co2 - baseRes.kpi.co2, dh = rh.kpi.co2 - baseRes.kpi.co2;
      if (Math.abs(dl) < 1e-7 && Math.abs(dh) < 1e-7) continue;
      rows.push({ path: p.path, label: p.label, low: clamp(lo), high: clamp(hi), base: v, coLow: rl.kpi.co2, coHigh: rh.kpi.co2, dLow: dl, dHigh: dh,
        feasibleLow: rl.feasible, feasibleHigh: rh.feasible, swing: Math.abs(dh - dl) });
    }
    rows.sort((a, b) => b.swing - a.swing);
    return { ok: true, base: baseRes.kpi.co2, pct, rows };
  }

  const SWEEPS = {
    ssShare: { label: 'SS scrap share of base feed', unit: '%', min: 0, max: 100, apply: (s, x) => E().withShares(s, 'ssScrap', x), current: s => s.shares.ssScrap },
    pigShare: { label: 'Pig iron share of base feed', unit: '%', min: 0, max: 100, apply: (s, x) => E().withShares(s, 'pigIron', x), current: s => s.shares.pigIron },
    niCathode: { label: 'Ni supplied as cathode', unit: '%', min: 0, max: 100, apply: (s, x) => { const n = U().clone(s); n.niCathodeShare = x; return n; }, current: s => s.niCathodeShare },
    reShare: { label: 'Renewable electricity share', unit: '%', min: 0, max: 100, current: s => s.energy.mix.solar + s.energy.mix.wind,
      apply: (s, x) => {
        const n = U().clone(s), m = n.energy.mix, re = m.solar + m.wind, non = m.grid + m.captive;
        const fs = re > 0 ? m.solar / re : 1, fg = non > 0 ? m.grid / non : 1;
        n.energy.mix = { solar: x * fs, wind: x * (1 - fs), grid: (100 - x) * fg, captive: (100 - x) * (1 - fg) };
        return n;
      } },
    gridEF: { label: 'Grid emission factor', unit: 'kg CO2/kWh', min: 0, max: 1.2, apply: (s, x) => { const n = U().clone(s); n.factors.ef_grid = x; return n; }, current: s => s.factors.ef_grid },
    ngGJ: { label: 'Natural gas use', unit: 'GJ/t', min: 0, max: 2, apply: (s, x) => { const n = U().clone(s); n.energy.ngGJ = x; return n; }, current: s => s.energy.ngGJ }
  };

  function sweep(s, key, n) {
    const def = SWEEPS[key]; if (!def) throw new Error('Unknown sweep parameter');
    n = n || 26;
    const xs = new Set(); for (let i = 0; i < n; i++) xs.add(def.min + (def.max - def.min) * i / (n - 1));
    const cur = def.current(s); xs.add(cur);
    const points = [...xs].sort((a, b) => a - b).map(x => {
      const r = E().calculate(def.apply(s, x));
      return r.ok ? { x, co2: r.kpi.co2, cost: r.kpi.cost, energy: r.kpi.energyGJ, feasible: r.feasible, reason: r.feasible ? '' : r.violations[0].msg }
        : { x, co2: null, cost: null, energy: null, feasible: false, reason: r.reason };
    });
    return { key, label: def.label, unit: def.unit, current: cur, points };
  }

  const CATEGORY_ORDER = ['Base metallics', 'Ferroalloys', 'Electricity', 'Process carbon', 'Fuels', 'Fluxes', 'Industrial gases'];
  // Category deltas (t CO2e / t slab) that sum exactly to the total change from a → b.
  function waterfall(a, b) {
    if (!a || !b || !a.ok || !b.ok) return null;
    const ya = a.scenario.energy.castYield, yb = b.scenario.energy.castYield;
    const steps = CATEGORY_ORDER.map(cat => ({ category: cat,
      delta: ((b.emissions.byCategory[cat] || 0) / yb - (a.emissions.byCategory[cat] || 0) / ya) / 1000 }));
    return { start: a.kpi.co2, end: b.kpi.co2, steps };
  }

  // Sequential lever attribution from a → b: charge mix, then Ni source, then electricity mix.
  function attribution(fromScenario, toScenario) {
    const s0 = U().clone(fromScenario); s0.mode = 'auto';
    const r0 = E().calculate(s0);
    const s1 = U().clone(s0); s1.shares = Object.assign({}, toScenario.shares);
    const s2 = U().clone(s1); s2.niCathodeShare = toScenario.niCathodeShare;
    const s3 = U().clone(s2); s3.energy.mix = Object.assign({}, toScenario.energy.mix);
    const rs = [r0, E().calculate(s1), E().calculate(s2), E().calculate(s3)];
    if (rs.some(r => !r.ok)) return null;
    const labels = ['Charge mix (scrap / pig iron)', 'Nickel source', 'Electricity mix'];
    return { start: r0.kpi.co2, end: rs[3].kpi.co2, steps: labels.map((label, i) => ({ label, dCo2: rs[i + 1].kpi.co2 - rs[i].kpi.co2, dCost: rs[i + 1].kpi.cost - rs[i].kpi.cost })) };
  }

  CT.analysis = { tornado, sweep, waterfall, attribution, SWEEPS, TORNADO_PARAMS, CATEGORY_ORDER };
})(typeof globalThis !== 'undefined' ? globalThis : this);
