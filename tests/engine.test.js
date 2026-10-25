// CarbonTrace Pro engine tests — run with: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CT = require('./load.js');
const { engine: E, optimizer: O, analysis: A, util: U } = CT;

const close = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} expected ${b}, got ${a}`);
const def = g => E.setGrade(CT.defaultScenario(), g || '304');

test('default scenarios for all grades are valid, feasible and hit the aim chemistry', () => {
  for (const g of ['304', '316', '430']) {
    const s = def(g), r = E.calculate(s);
    assert.ok(r.ok, g + ' ' + r.reason);
    assert.ok(r.feasible, g + ' violations: ' + JSON.stringify(r.violations));
    for (const e of CT.GRADES[g].solve) close(r.chemistry.pct[e], s.aim[e], 1e-6, g + ' ' + e);
    close(r.chemistry.pct.C, s.aim.C); close(r.chemistry.pct.Si, s.aim.Si);
  }
});

test('mass balance closes: steel elements sum to 1000 kg and input = steel + losses + oxidised C/Si', () => {
  const r = E.calculate(def('316'));
  const steel = U.sum(CT.ELEMENTS.map(e => r.balance.steel[e]));
  close(steel, 1000, 1e-9);
  const input = U.sum(['Fe', 'Cr', 'Ni', 'Mo', 'Mn', 'Si', 'C', 'Cu', 'other'].map(e => r.balance.input[e]));
  const out = steel + U.sum(CT.METALS.map(m => r.balance.lost[m])) + r.balance.siOx + (r.balance.input.C - r.balance.steel.C) + r.balance.input.other;
  close(input, out, 1e-9);
  close(r.charge.total, U.sum(Object.values(r.charge.masses)), 1e-12);
});

test('carbon balance: process CO2 = (charge C + coke C + electrode C − steel C) × 44/12', () => {
  const s = def(), r = E.calculate(s);
  const cIn = r.balance.input.C + s.adds.coke * 0.83 + s.adds.electrode * 0.82;
  const expected = (cIn - s.aim.C * 10) * CT.CONST.co2PerC;
  const lines = r.emissions.lines.filter(l => l.category === 'Process carbon');
  close(U.sum(lines.map(l => l.kg)), expected, 1e-9);
});

test('line items reconcile with scope and category totals and the per-slab KPI', () => {
  const s = def(), r = E.calculate(s);
  const tot = U.sum(r.emissions.lines.map(l => l.kg));
  close(U.sum(r.emissions.byScope), tot, 1e-12);
  close(U.sum(Object.values(r.emissions.byCategory)), tot, 1e-12);
  close(r.kpi.co2, tot / 1000 / s.energy.castYield, 1e-12);
  close(U.sum(r.emissions.byScopeSlab), r.kpi.co2, 1e-12);
  close(r.kpi.cost, U.sum(r.emissions.lines.map(l => l.cost)) / s.energy.castYield, 1e-12);
});

test('each line equals activity × factor (no hidden multipliers)', () => {
  const r = E.calculate(def('316'));
  for (const l of r.emissions.lines) close(l.kg, l.qty * l.factor, 1e-9, l.id);
});

test('electricity: switching to market-based RE removes purchased-power emissions; captive is scope 1', () => {
  const s = def(); s.limits.maxRE = 100; s.energy.mix = { grid: 0, captive: 0, solar: 50, wind: 50 };
  const r = E.calculate(s);
  assert.equal(r.emissions.byScope[1], 0);
  const c = def(); c.limits.maxCaptive = 100; c.energy.mix = { grid: 0, captive: 100, solar: 0, wind: 0 };
  const rc = E.calculate(c), line = rc.emissions.lines.find(l => l.id === 'power_captive');
  assert.equal(line.scope, 1);
  close(line.factor, 94.6 * 10.5 / 1000, 1e-12);
  close(line.qty, rc.energy.siteKwh, 1e-12);
});

test('more stainless scrap lowers alloy demand and CO2e (304)', () => {
  const lo = E.calculate(E.withShares(def(), 'ssScrap', 40)), hi = E.calculate(E.withShares(def(), 'ssScrap', 75));
  assert.ok(hi.charge.masses.feNi < lo.charge.masses.feNi);
  assert.ok(hi.charge.masses.feCr < lo.charge.masses.feCr);
  assert.ok(hi.kpi.co2 < lo.kpi.co2);
});

test('Ni cathode substitution keeps Ni at aim and lowers CO2e when its factor per kg Ni is lower', () => {
  const s = def(); s.niCathodeShare = 100;
  const r = E.calculate(s), r0 = E.calculate(def());
  close(r.chemistry.pct.Ni, s.aim.Ni, 1e-9);
  assert.equal(r.charge.masses.feNi, 0);
  assert.ok(r.charge.masses.niCathode > 0 && r.kpi.co2 < r0.kpi.co2);
});

test('heat balance responds to charge and supports metered override', () => {
  const s = def(), r = E.calculate(s);
  const h = r.energy.heat;
  close(r.energy.eafModelKwh, (h.demand - h.chemical - h.gas) / s.energy.etaEl, 1e-9);
  close(r.energy.siteKwh, r.energy.eafKwh + s.energy.auxKwh, 1e-12);
  const more = U.clone(s); more.energy.lossKwh += 50;
  close(E.calculate(more).energy.eafKwh - r.energy.eafKwh, 50 / s.energy.etaEl, 1e-9);
  const m = U.clone(s); m.energy.eafMode = 'metered'; m.energy.meteredKwh = 700;
  assert.equal(E.calculate(m).energy.eafKwh, 700);
});

test('auto lime meets the basicity target', () => {
  const r = E.calculate(def());
  close(r.slag.basicity, def().basicity, 1e-9);
});

test('manual mode normalises any batch size to one tonne of liquid steel (scale invariance)', () => {
  const s = def(), auto = E.calculate(s), m = E.toManual(s, auto), r1 = E.calculate(m);
  const m2 = U.clone(m); for (const k of CT.CHARGE_KEYS) m2.manual[k] *= 3.7;
  const r2 = E.calculate(m2);
  close(r1.kpi.co2, r2.kpi.co2, 1e-9); close(r1.chemistry.pct.Cr, r2.chemistry.pct.Cr, 1e-9);
  close(r1.kpi.co2, auto.kpi.co2, 1e-3, 'manual copy of auto charge reproduces the result');
  // removing FeNi in manual mode must break the Ni spec
  const m3 = U.clone(m); m3.manual.feNi = 0;
  const r3 = E.calculate(m3);
  assert.ok(r3.ok && !r3.feasible && r3.violations.some(v => v.type === 'chemistry'));
});

test('validation rejects NaN, out-of-range, share sums and empty manual charges', () => {
  const s = def(); s.energy.ngGJ = NaN;
  assert.equal(E.calculate(s).ok, false);
  const s2 = def(); s2.recovery.Cr = 1.4; assert.match(E.calculate(s2).reason, /Cr recovery/);
  const s3 = def(); s3.shares.ssScrap = 70; assert.match(E.calculate(s3).reason, /total 100/);
  const s4 = def(); s4.energy.mix.grid = 10; assert.match(E.calculate(s4).reason, /Electricity shares/);
  const s5 = def(); s5.mode = 'manual'; assert.match(E.calculate(s5).reason, /empty/);
  const s6 = def(); s6.assay.ssScrap.Cr = 95; assert.match(E.calculate(s6).reason, /SS scrap Cr must be between/);
  const s7 = def(); s7.assay.feCr.Si = 50; assert.match(E.calculate(s7).reason, /exceeds 100/);
});

test('sanitize ignores unknown keys and wrong types', () => {
  const raw = JSON.parse('{"grade":"316","__proto__":{"x":1},"shares":{"ssScrap":"80","csScrap":10},"evil":"<script>","energy":{"ngGJ":0.5}}');
  const s = E.sanitize(raw);
  assert.equal(s.grade, '316'); assert.equal(s.shares.ssScrap, 60); assert.equal(s.shares.csScrap, 10);
  assert.equal(s.energy.ngGJ, 0.5); assert.equal(s.evil, undefined); assert.equal({}.x, undefined);
});

test('rebalance keeps shares at 100% and proportional', () => {
  const r = U.rebalance({ a: 60, b: 20, c: 20 }, 'a', 80);
  close(r.a + r.b + r.c, 100, 1e-12); close(r.b, 10, 1e-12); close(r.c, 10, 1e-12);
  const z = U.rebalance({ a: 100, b: 0, c: 0 }, 'a', 40); close(z.b + z.c, 60, 1e-12);
});

test('constraints: availability cap, charge carbon and RE limits flag violations', () => {
  const s = def(); s.limits.cap.feNi = 100; assert.ok(E.calculate(s).violations.some(v => v.type === 'availability'));
  const p = E.withShares(def(), 'pigIron', 60); assert.ok(E.calculate(p).violations.some(v => v.type === 'process'));
  const q = def(); q.energy.mix = { grid: 40, captive: 0, solar: 60, wind: 0 }; assert.ok(E.calculate(q).violations.some(v => v.type === 'power'));
});

test('optimiser: best point is feasible, reproducible and no worse than any enumerated feasible point', () => {
  const s = def(), o = O.optimize(s, { objective: 'co2', step: 10 });
  assert.ok(o.ok && o.best && o.feasible > 0);
  assert.ok(o.bestResult.feasible, JSON.stringify(o.bestResult.violations));
  close(o.bestResult.kpi.co2, o.best.co2, 1e-9, 'fast-path objective equals full engine');
  close(o.bestResult.kpi.cost, o.best.cost, 1e-9);
  // brute-force check on the same space with the full engine
  let min = Infinity;
  for (const sh of O.shareGrid(s, 10, true)) for (const ni of O.nickelOptions(s, true)) for (const mix of O.powerOptions(s, true)) {
    const sc = U.clone(s); sc.shares = sh; sc.niCathodeShare = ni; sc.energy.mix = mix;
    const r = E.calculate(sc); if (r.ok && r.feasible) min = Math.min(min, r.kpi.co2);
  }
  close(o.best.co2, min, 1e-9);
  const base = E.calculate(s); assert.ok(o.best.co2 < base.kpi.co2);
});

test('optimiser respects the cost ceiling and the cost objective', () => {
  const s = def(), base = E.calculate(s);
  const o = O.optimize(s, { objective: 'co2', step: 10, maxCostIncreasePct: 0, refCost: base.kpi.cost });
  assert.ok(o.best.cost <= base.kpi.cost + 1e-6);
  const c = O.optimize(s, { objective: 'cost', step: 10 });
  for (const p of c.ranked) assert.ok(c.best.cost <= p.cost + 1e-9);
  // Pareto frontier: costs increase while CO2 strictly decreases
  for (let i = 1; i < o.pareto.length; i++) assert.ok(o.pareto[i].cost >= o.pareto[i - 1].cost && o.pareto[i].co2 < o.pareto[i - 1].co2);
});

test('optimiser with all levers disabled only evaluates the current recipe', () => {
  const s = def(), o = O.optimize(s, { levers: { charge: false, nickel: false, power: false } });
  assert.equal(o.evaluated, 1); close(o.best.co2, E.calculate(s).kpi.co2, 1e-9);
});

test('sensitivity, sweep, waterfall and attribution are consistent with the engine', () => {
  const s = def(), t = A.tornado(s, 20);
  const grid = t.rows.find(r => r.path === 'factors.ef_grid');
  assert.ok(grid.dHigh > 0 && grid.dLow < 0);
  const sw = A.sweep(s, 'ssShare', 11);
  const cur = sw.points.find(p => Math.abs(p.x - s.shares.ssScrap) < 1e-9);
  close(cur.co2, E.calculate(s).kpi.co2, 1e-12);
  const o = O.optimize(s, { step: 10 }), a = E.calculate(s), b = o.bestResult;
  const w = A.waterfall(a, b);
  close(w.start + U.sum(w.steps.map(x => x.delta)), w.end, 1e-9);
  const at = A.attribution(s, o.bestScenario);
  close(at.start + U.sum(at.steps.map(x => x.dCo2)), at.end, 1e-9);
  const c = E.compare(a, b);
  close(c.annualCo2, c.dCo2 * s.econ.annualTonnes, 1e-9);
  assert.ok(c.dCo2 < 0 && c.abatementCost !== null);
});
