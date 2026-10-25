/* CarbonTrace Pro — calculation engine (no DOM).
 * Functional unit: 1 t of cast stainless slab. Internal balances use 1 t of liquid steel,
 * converted with the casting yield. Boundary: cradle-to-gate melt shop (EAF → AOD → LRF → CC).
 * Pipeline: validate → charge (solve or normalise) → element / carbon / slag / O2 balance
 *           → heat balance (electricity) → emissions & cost line items → constraint checks.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};
  const VERSION = '1.0.0';
  const EPS = 1e-9;

  const clone = o => JSON.parse(JSON.stringify(o));
  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  function set(o, path, v) {
    const ks = path.split('.'); let a = o;
    for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]];
    a[ks[ks.length - 1]] = v;
  }
  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* ---------- Validation & sanitising ---------- */
  function validate(s) {
    const errors = [];
    if (!isPlain(s)) return [{ path: '', msg: 'A scenario object is required.' }];
    if (!Object.prototype.hasOwnProperty.call(CT.GRADES, s.grade)) errors.push({ path: 'grade', msg: 'Grade must be 304, 316 or 430.' });
    if (!['auto', 'manual'].includes(s.mode)) errors.push({ path: 'mode', msg: 'Mode must be auto or manual.' });
    if (!['auto', 'manual'].includes(s.limeMode)) errors.push({ path: 'limeMode', msg: 'Lime mode must be auto or manual.' });
    if (!s.energy || !['model', 'metered'].includes(s.energy.eafMode)) errors.push({ path: 'energy.eafMode', msg: 'EAF energy mode must be model or metered.' });
    for (const f of CT.FIELDS) {
      const v = get(s, f.path);
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push({ path: f.path, msg: `${f.label} must be a number.` });
      else if (v < f.min - EPS || v > f.max + EPS) errors.push({ path: f.path, msg: `${f.label} must be between ${f.min} and ${f.max} ${f.unit}.` });
    }
    if (errors.length) return errors;
    const shareSum = sum(CT.BASE_FEEDS.map(k => s.shares[k]));
    if (Math.abs(shareSum - 100) > 0.01) errors.push({ path: 'shares', msg: `Base-feed shares must total 100% (now ${shareSum.toFixed(2)}%).` });
    const mixSum = sum(Object.keys(CT.POWER_SOURCES).map(k => s.energy.mix[k]));
    if (Math.abs(mixSum - 100) > 0.01) errors.push({ path: 'energy.mix', msg: `Electricity shares must total 100% (now ${mixSum.toFixed(2)}%).` });
    for (const k of CT.CHARGE_KEYS) {
      const a = s.assay && s.assay[k];
      if (!isPlain(a)) { errors.push({ path: 'assay.' + k, msg: `Assay for ${k} missing.` }); continue; }
      let t = 0;
      for (const e of ['Cr', 'Ni', 'Mo', 'Mn', 'Si', 'C', 'Cu', 'other']) {
        const v = a[e] === undefined ? 0 : a[e];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errors.push({ path: `assay.${k}.${e}`, msg: `${k} ${e} assay must be ≥ 0.` });
        t += v;
      }
      if (t > 100 + EPS) errors.push({ path: 'assay.' + k, msg: `${CT.MATERIALS[k].short} assay exceeds 100% (${t.toFixed(2)}%).` });
    }
    if (CT.ASSAYS.feNi && !(s.assay.feNi.Ni > 0)) errors.push({ path: 'assay.feNi.Ni', msg: 'FeNi must contain Ni.' });
    if (!(s.assay.niCathode.Ni > 0)) errors.push({ path: 'assay.niCathode.Ni', msg: 'Ni cathode must contain Ni.' });
    if (s.mode === 'manual' && !(sum(CT.CHARGE_KEYS.map(k => s.manual[k])) > 0)) errors.push({ path: 'manual', msg: 'Manual charge is empty — enter at least one material.' });
    return errors;
  }

  // Merge untrusted input onto defaults: only known keys, only matching primitive types.
  function sanitize(obj) {
    const grade = isPlain(obj) && Object.prototype.hasOwnProperty.call(CT.GRADES, obj.grade) ? obj.grade : '304';
    const out = CT.defaultScenario(grade);
    (function merge(dst, src) {
      if (!isPlain(src)) return;
      for (const k of Object.keys(dst)) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        if (isPlain(dst[k])) merge(dst[k], src[k]);
        else if (typeof dst[k] === typeof src[k]) dst[k] = src[k];
      }
    })(out, obj);
    if (isPlain(obj) && typeof obj.name === 'string') out.name = obj.name.slice(0, 80);
    return out;
  }

  /* ---------- Small linear solver ---------- */
  function gauss(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /* ---------- Compositions ---------- */
  function composition(s, key) {
    const a = s.assay[key], c = {}; let t = 0;
    for (const e of ['Cr', 'Ni', 'Mo', 'Mn', 'Si', 'C', 'Cu']) { c[e] = (a[e] || 0) / 100; t += c[e]; }
    c.other = (a.other || 0) / 100; t += c.other;
    c.Fe = Math.max(0, 1 - t);
    return c;
  }
  const ALL = ['Fe', 'Cr', 'Ni', 'Mo', 'Mn', 'Si', 'C', 'Cu', 'other'];

  /* ---------- Auto-alloy solver: base-feed mass + alloy additions that hit the aim chemistry ----------
   * For each solved element e:  r_e (B·b_e + Σ_k u_k·v_k,e + F_e) = 10·aim_e        (kg per t liquid)
   * Mass closure:               Σ_metals r_m (B·b_m + Σ_k u_k·v_k,m + F_m) + 10(aimC + aimSi) = 1000
   * b = base-feed blend composition, v_k = alloy unit composition, F = fixed FeSi addition.
   * Alloys solved negative are removed (element then floats as a residual and is checked against spec).
   */
  function solveCharge(s, comps) {
    const g = CT.GRADES[s.grade], r = s.recovery, aim = s.aim;
    const blend = {};
    for (const e of ALL) blend[e] = sum(CT.BASE_FEEDS.map(k => (s.shares[k] / 100) * comps[k][e]));
    const phi = s.niCathodeShare / 100;
    const niMass = { feNi: (1 - phi) / comps.feNi.Ni, niCathode: phi / comps.niCathode.Ni };
    const niUnit = {};
    for (const e of ALL) niUnit[e] = niMass.feNi * comps.feNi[e] + niMass.niCathode * comps.niCathode[e];
    const unit = { base: blend, Cr: comps.feCr, Ni: niUnit, Mo: comps.feMo, Mn: comps.feMn };
    const F = {}; for (const e of ALL) F[e] = s.feSi * comps.feSi[e];

    let active = g.solve.filter(e => aim[e] > 0);
    const dropped = [];
    let x = null;
    for (let iter = 0; iter < 6; iter++) {
      const vars = ['base'].concat(active), n = vars.length, A = [], b = [];
      for (const e of active) {
        A.push(vars.map(v => r[e] * unit[v][e]));
        b.push(10 * aim[e] - r[e] * F[e]);
      }
      A.push(vars.map(v => sum(CT.METALS.map(m => r[m] * unit[v][m]))));
      b.push(1000 - 10 * (aim.C + aim.Si) - sum(CT.METALS.map(m => r[m] * F[m])));
      const sol = gauss(A, b);
      if (!sol) return { ok: false, reason: 'The chemistry equations are singular for this charge mix (e.g. no source of a required element).' };
      x = {}; vars.forEach((v, i) => { x[v] = sol[i]; });
      let worst = null;
      for (const e of active) if (x[e] < -1e-9 && (worst === null || x[e] < x[worst])) worst = e;
      if (worst === null) break;
      active = active.filter(e => e !== worst); dropped.push(worst);
    }
    if (!(x.base > 0)) return { ok: false, reason: 'Aim chemistry cannot be reached: alloy demand leaves no room for base metallic feed.' };
    const niKg = x.Ni || 0;
    const masses = {
      ssScrap: x.base * s.shares.ssScrap / 100, csScrap: x.base * s.shares.csScrap / 100, pigIron: x.base * s.shares.pigIron / 100,
      feCr: x.Cr || 0, feNi: niKg * niMass.feNi, niCathode: niKg * niMass.niCathode, feMo: x.Mo || 0, feMn: x.Mn || 0, feSi: s.feSi
    };
    for (const k in masses) if (Math.abs(masses[k]) < 1e-9) masses[k] = 0;
    return { ok: true, masses, solved: active, dropped, baseKg: x.base };
  }

  /* ---------- Element, carbon and silicon balance per tonne liquid ---------- */
  function evaluateCharge(s, massesIn, comps) {
    const r = s.recovery, aim = s.aim;
    const input = {};
    for (const e of ALL) input[e] = sum(CT.CHARGE_KEYS.map(k => (massesIn[k] || 0) * comps[k][e]));
    const metalsRec = sum(CT.METALS.map(m => r[m] * input[m]));
    const fC = aim.C / 100, fSi = aim.Si / 100;
    let L = metalsRec / (1 - fC - fSi), siFinal = fSi * L, siShort = false;
    if (input.Si < siFinal - 1e-9) { siShort = true; L = (metalsRec + input.Si) / (1 - fC); siFinal = input.Si; }
    if (!(L > 1e-6)) return { ok: false, reason: 'The charge contains no recoverable metal, so no liquid steel is produced.' };
    const scale = 1000 / L;
    const masses = {}; for (const k of CT.CHARGE_KEYS) masses[k] = (massesIn[k] || 0) * scale;
    const inT = {}; for (const e of ALL) inT[e] = input[e] * scale;
    const steel = {}; for (const m of CT.METALS) steel[m] = r[m] * inT[m];
    steel.Si = siFinal * scale; steel.C = 10 * aim.C;
    const pct = {}; for (const e of CT.ELEMENTS) pct[e] = steel[e] / 10;
    const lost = {}; for (const m of CT.METALS) lost[m] = (1 - r[m]) * inT[m];
    const cokeC = s.adds.coke * 0.83, electrodeC = s.adds.electrode * 0.82; // IPCC Table 4.3 carbon contents
    const cIn = inT.C + cokeC + electrodeC, cOut = steel.C;
    const cShort = cIn < cOut - 1e-9;
    const cOx = Math.max(0, cIn - cOut);
    const chargeKg = sum(CT.CHARGE_KEYS.map(k => masses[k]));
    const recycledKg = sum(CT.CHARGE_KEYS.filter(k => CT.MATERIALS[k].recycled).map(k => masses[k]));
    return {
      ok: true, masses, scale, input: inT, steel, pct, lost, siShort, cShort,
      carbon: { charge: inT.C, coke: cokeC, electrode: electrodeC, in: cIn, out: cOut, oxidised: cOx },
      siOx: Math.max(0, inT.Si - steel.Si), chargeKg, chargeCPct: chargeKg > 0 ? inT.C / chargeKg * 100 : 0,
      recycledPct: chargeKg > 0 ? recycledKg / chargeKg * 100 : 0, metallicYield: chargeKg > 0 ? 1000 / chargeKg : 0
    };
  }

  /* ---------- Slag, oxygen and heat balance ---------- */
  function processModel(s, ch) {
    const E = s.energy, K = CT.CONST, A = s.adds;
    const oxides = {
      SiO2: ch.siOx * K.oxide.Si, Cr2O3: ch.lost.Cr * K.oxide.Cr, FeO: ch.lost.Fe * K.oxide.Fe,
      MnO: ch.lost.Mn * K.oxide.Mn, NiO: ch.lost.Ni * K.oxide.Ni, MoO3: ch.lost.Mo * K.oxide.Mo
    };
    const doloCaO = A.dolomite * 0.304, doloResidue = A.dolomite * (1 - 0.477);
    const lime = s.limeMode === 'auto' ? Math.max(0, s.basicity * oxides.SiO2 - doloCaO) / 0.92 : A.limeKg;
    const slagKg = sum(Object.values(oxides)) + doloResidue + lime + ch.input.other;
    const basicity = oxides.SiO2 > 1e-9 ? (lime * 0.92 + doloCaO) / oxides.SiO2 : null;

    const pc = E.postComb, H = K.heat;
    const chemMJ = {
      carbon: ch.carbon.oxidised * ((1 - pc) * H.C_CO + pc * H.C_CO2),
      silicon: ch.siOx * H.Si, iron: ch.lost.Fe * H.Fe, chromium: ch.lost.Cr * H.Cr, manganese: ch.lost.Mn * H.Mn
    };
    const heat = {
      steel: 1000 * E.hSteel, slag: slagKg * E.hSlag, losses: E.lossKwh,
      chemical: sum(Object.values(chemMJ)) / 3.6 * E.chemUtil,
      gas: E.ngGJ * 1000 / 3.6 * E.burnerEff, chemMJ
    };
    heat.demand = heat.steel + heat.slag + heat.losses;
    heat.net = heat.demand - heat.chemical - heat.gas;
    const eafModelKwh = Math.max(0, heat.net) / E.etaEl;
    const eafKwh = E.eafMode === 'metered' ? E.meteredKwh : eafModelKwh;
    const siteKwh = eafKwh + E.auxKwh;

    const M = K.molar, o2Kmol = ch.carbon.oxidised / M.C * (0.5 + 0.5 * pc) + ch.siOx / M.Si
      + ch.lost.Fe / M.Fe * 0.5 + ch.lost.Cr / M.Cr * 0.75 + ch.lost.Mn / M.Mn * 0.5;
    const o2Nm3 = o2Kmol * K.nm3PerKmol / E.o2Util;
    const gasKwh = (o2Nm3 + A.argon) * s.factors.ef_o2Power;
    const GJ = { electricity: siteKwh * K.kwhToGJ, naturalGas: E.ngGJ, coke: A.coke * K.cokeNCV / 1000 };
    GJ.total = GJ.electricity + GJ.naturalGas + GJ.coke;
    return { oxides, lime, slagKg, basicity, heat, eafModelKwh, eafKwh, siteKwh, o2Nm3, gasKwh, GJ };
  }

  function captiveEF(s) { return s.factors.ef_coal * s.energy.heatRate / 1000; } // kg CO2/kWh
  function powerEF(s, key) { return key === 'captive' ? captiveEF(s) : s.factors[CT.POWER_SOURCES[key].factor]; }

  /* ---------- Core (everything except the electricity source mix) ---------- */
  function core(s) {
    const errors = validate(s);
    if (errors.length) return { ok: false, stage: 'input', errors, reason: errors[0].msg };
    const comps = {}; for (const k of CT.CHARGE_KEYS) comps[k] = composition(s, k);
    let solve = null, massesIn;
    if (s.mode === 'auto') {
      solve = solveCharge(s, comps);
      if (!solve.ok) return { ok: false, stage: 'chemistry', errors: [], reason: solve.reason };
      massesIn = solve.masses;
    } else massesIn = s.manual;
    const ch = evaluateCharge(s, massesIn, comps);
    if (!ch.ok) return { ok: false, stage: 'balance', errors: [], reason: ch.reason };
    const pr = processModel(s, ch);
    const lines = [];
    const add = (id, label, category, scope, qty, unit, factor, factorUnit, kg, cost) => lines.push({ id, label, category, scope, qty, unit, factor, factorUnit, kg, cost });
    for (const k of CT.CHARGE_KEYS) {
      const m = ch.masses[k]; if (m <= 0) continue;
      const mat = CT.MATERIALS[k], ef = s.factors[mat.ef];
      add(k, mat.label, mat.role === 'base' ? 'Base metallics' : 'Ferroalloys', 3, m, 'kg', ef, CT.FACTORS[mat.ef].unit, m * ef, m * s.prices[mat.price]);
    }
    const cox = ch.carbon.oxidised, cin = ch.carbon.in || 1, K = CT.CONST;
    add('carbonCharge', 'Carbon in metallic charge → CO2', 'Process carbon', 1, cox * ch.carbon.charge / cin, 'kg C', K.co2PerC, 'kg CO2/kg C', cox * ch.carbon.charge / cin * K.co2PerC, 0);
    add('carbonCoke', 'Charge carbon (coke) → CO2', 'Process carbon', 1, cox * ch.carbon.coke / cin, 'kg C', K.co2PerC, 'kg CO2/kg C', cox * ch.carbon.coke / cin * K.co2PerC, s.adds.coke * s.prices.price_coke);
    add('carbonElectrode', 'Graphite electrode → CO2', 'Process carbon', 1, cox * ch.carbon.electrode / cin, 'kg C', K.co2PerC, 'kg CO2/kg C', cox * ch.carbon.electrode / cin * K.co2PerC, s.adds.electrode * s.prices.price_electrode);
    const ngEF = s.factors.ef_ng + K.ngCH4 * K.gwpCH4 + K.ngN2O * K.gwpN2O;
    add('naturalGas', 'Natural gas combustion (CO2+CH4+N2O)', 'Fuels', 1, s.energy.ngGJ, 'GJ', ngEF, 'kg CO2e/GJ', s.energy.ngGJ * ngEF, s.energy.ngGJ * s.prices.price_ng);
    add('dolomite', 'Raw dolomite calcination', 'Fluxes', 1, s.adds.dolomite, 'kg', s.factors.ef_dolomite, 'kg CO2/kg', s.adds.dolomite * s.factors.ef_dolomite, s.adds.dolomite * s.prices.price_dolomite);
    add('lime', 'Burnt lime (upstream calcination)', 'Fluxes', 3, pr.lime, 'kg', s.factors.ef_lime, 'kg CO2/kg', pr.lime * s.factors.ef_lime, pr.lime * s.prices.price_lime);
    add('gases', 'Oxygen & argon (ASU electricity, grid)', 'Industrial gases', 3, pr.gasKwh, 'kWh', s.factors.ef_grid, 'kg CO2/kWh', pr.gasKwh * s.factors.ef_grid,
      pr.o2Nm3 * s.prices.price_o2 + s.adds.argon * s.prices.price_ar);
    return { ok: true, scenario: s, solve, ch, pr, lines };
  }

  /* ---------- Finish: electricity mix, totals, KPIs, constraints ---------- */
  function finish(s, c) {
    const lines = c.lines.slice(), pr = c.pr, ch = c.ch;
    for (const key of Object.keys(CT.POWER_SOURCES)) {
      const share = s.energy.mix[key] / 100; if (share <= 0) continue;
      const src = CT.POWER_SOURCES[key], kwh = pr.siteKwh * share, ef = powerEF(s, key);
      lines.push({ id: 'power_' + key, label: src.label + ' electricity', category: 'Electricity', scope: src.scope, qty: kwh, unit: 'kWh',
        factor: ef, factorUnit: 'kg CO2/kWh', kg: kwh * ef, cost: kwh * s.prices[src.price] });
    }
    const y = s.energy.castYield;
    const byScope = [1, 2, 3].map(sc => sum(lines.filter(l => l.scope === sc).map(l => l.kg)));
    const byCategory = {};
    for (const l of lines) byCategory[l.category] = (byCategory[l.category] || 0) + l.kg;
    const totalKg = sum(byScope), costLiquid = sum(lines.map(l => l.cost));
    const co2 = totalKg / 1000 / y;                 // t CO2e per t slab
    const cost = costLiquid / y;                    // INR per t slab
    const re = sum(Object.keys(CT.POWER_SOURCES).filter(k => CT.POWER_SOURCES[k].renewable).map(k => s.energy.mix[k]));

    // Chemistry & constraint checks
    const g = CT.GRADES[s.grade], checks = [];
    for (const e of ['C', 'Si', 'Mn', 'Cr', 'Ni', 'Mo']) {
      const lim = g.spec[e], v = ch.pct[e];
      checks.push({ el: e, value: v, aim: s.aim[e], min: lim ? lim[0] : null, max: lim ? lim[1] : null,
        pass: !lim || (v >= lim[0] - 1e-6 && v <= lim[1] + 1e-6) });
    }
    checks.push({ el: 'Cu', value: ch.pct.Cu, aim: null, min: null, max: s.cuMax, pass: ch.pct.Cu <= s.cuMax + 1e-6 });
    const violations = [], warnings = [];
    for (const k of checks) if (!k.pass) violations.push({ type: 'chemistry', msg: `${k.el} ${k.value.toFixed(3)}% is outside ${k.min === null ? '≤' : k.min + '–'}${k.max}%.` });
    for (const k of CT.CHARGE_KEYS) {
      const cap = s.limits.cap[k];
      if (ch.masses[k] > cap + 1e-6) violations.push({ type: 'availability', msg: `${CT.MATERIALS[k].short} ${ch.masses[k].toFixed(1)} kg/t exceeds availability ${cap} kg/t.` });
    }
    if (ch.chargeCPct > s.limits.maxChargeC + 1e-6) violations.push({ type: 'process', msg: `Charge carbon ${ch.chargeCPct.toFixed(2)}% exceeds the ${s.limits.maxChargeC}% decarburisation limit.` });
    if (re > s.limits.maxRE + 1e-6) violations.push({ type: 'power', msg: `Renewable share ${re.toFixed(1)}% exceeds the available ${s.limits.maxRE}%.` });
    if (s.energy.mix.captive > s.limits.maxCaptive + 1e-6) violations.push({ type: 'power', msg: `Captive share ${s.energy.mix.captive.toFixed(1)}% exceeds capacity ${s.limits.maxCaptive}%.` });
    if (ch.siShort) warnings.push('Charged Si is below the aim Si — increase FeSi or lower the Si aim.');
    if (ch.cShort) warnings.push('Charged carbon is below the aim C — a recarburiser would be needed.');
    if (s.limeMode === 'manual' && pr.basicity !== null && pr.basicity < 1.3) warnings.push(`Slag basicity ${pr.basicity.toFixed(2)} is low; Cr recovery would fall in practice.`);
    if (s.energy.eafMode === 'model' && pr.heat.net < 0) warnings.push('Chemical/fuel heat exceeds demand in the heat balance; electricity floored at zero.');
    if (s.energy.eafMode === 'metered') warnings.push('EAF electricity uses the metered value; heat-balance estimate shown for reference.');
    if (c.solve && c.solve.dropped.length) warnings.push(`Base feed already exceeds the aim for ${c.solve.dropped.join(', ')}; no alloy added (residual checked against spec).`);

    const perSlab = v => v / y;
    return {
      ok: true, version: VERSION, scenario: clone(s), feasible: violations.length === 0, violations, warnings,
      charge: {
        masses: ch.masses, total: ch.chargeKg, chargeCPct: ch.chargeCPct, recycledPct: ch.recycledPct, metallicYield: ch.metallicYield,
        perHeat: Object.fromEntries(CT.CHARGE_KEYS.map(k => [k, ch.masses[k] * s.heatSize])), scale: ch.scale
      },
      chemistry: { pct: ch.pct, checks, pass: checks.every(k => k.pass) },
      balance: { input: ch.input, steel: ch.steel, lost: ch.lost, carbon: ch.carbon, siOx: ch.siOx },
      slag: { oxides: pr.oxides, kg: pr.slagKg, lime: pr.lime, basicity: pr.basicity },
      energy: {
        heat: pr.heat, eafKwh: pr.eafKwh, eafModelKwh: pr.eafModelKwh, auxKwh: s.energy.auxKwh, siteKwh: pr.siteKwh, gasKwh: pr.gasKwh,
        o2Nm3: pr.o2Nm3, argonNm3: s.adds.argon, GJ: pr.GJ, captiveEF: captiveEF(s),
        bySource: Object.fromEntries(Object.keys(CT.POWER_SOURCES).map(k => [k, pr.siteKwh * s.energy.mix[k] / 100]))
      },
      emissions: { lines, byScope, byCategory, totalKgLiquid: totalKg, perSlab: co2, byScopeSlab: byScope.map(v => perSlab(v) / 1000) },
      cost: { totalLiquid: costLiquid, perSlab: cost, carbonCost: co2 * s.econ.carbonPrice, withCarbon: cost + co2 * s.econ.carbonPrice },
      kpi: {
        co2, cost, costWithCarbon: cost + co2 * s.econ.carbonPrice, energyGJ: perSlab(pr.GJ.total), elecKwh: perSlab(pr.siteKwh),
        recycledPct: ch.recycledPct, rePct: re, chemPass: checks.every(k => k.pass), annualCo2: co2 * s.econ.annualTonnes
      }
    };
  }

  function calculate(s) {
    const c = core(s);
    if (!c.ok) return { ok: false, version: VERSION, stage: c.stage, errors: c.errors, reason: c.reason, scenario: isPlain(s) ? clone(s) : null };
    return finish(s, c);
  }

  /* ---------- Comparison ---------- */
  function compare(a, b) {
    if (!a || !b || !a.ok || !b.ok) return { valid: false, reason: 'Both scenarios need a valid result.' };
    const dCo2 = b.kpi.co2 - a.kpi.co2, dCost = b.kpi.cost - a.kpi.cost;
    return {
      valid: true, dCo2, dCo2Pct: a.kpi.co2 > 0 ? dCo2 / a.kpi.co2 * 100 : null, dCost, dCostPct: a.kpi.cost > 0 ? dCost / a.kpi.cost * 100 : null,
      dEnergy: b.kpi.energyGJ - a.kpi.energyGJ, dElec: b.kpi.elecKwh - a.kpi.elecKwh,
      annualCo2: dCo2 * b.scenario.econ.annualTonnes, annualCost: dCost * b.scenario.econ.annualTonnes,
      abatementCost: dCo2 < -1e-9 ? dCost / -dCo2 : null,
      byScope: [0, 1, 2].map(i => b.emissions.byScopeSlab[i] - a.emissions.byScopeSlab[i]),
      sameGrade: a.scenario.grade === b.scenario.grade
    };
  }

  /* ---------- Scenario editing helpers (pure) ---------- */
  // Set one share and rebalance the others proportionally so the group still totals 100.
  function rebalance(group, key, value) {
    const keys = Object.keys(group), v = Math.min(100, Math.max(0, value)), others = keys.filter(k => k !== key);
    const rest = sum(others.map(k => group[k])), out = Object.assign({}, group, { [key]: v }), remaining = 100 - v;
    others.forEach((k, i) => { out[k] = rest > 1e-9 ? remaining * group[k] / rest : (i === 0 ? remaining : 0); });
    // remove float drift
    const drift = 100 - sum(keys.map(k => out[k]));
    if (Math.abs(drift) > 0) { const big = others.reduce((a, k) => (out[k] > out[a] ? k : a), others[0]); if (big !== undefined) out[big] = Math.max(0, out[big] + drift); }
    return out;
  }
  function withShares(s, key, value) { const n = clone(s); n.shares = rebalance(s.shares, key, value); return n; }
  function withMix(s, key, value) { const n = clone(s); n.energy.mix = rebalance(s.energy.mix, key, value); return n; }
  function setGrade(s, grade) {
    const n = clone(s), g = CT.GRADES[grade];
    n.grade = grade; n.aim = Object.assign({}, g.aim); n.assay.ssScrap = Object.assign({}, g.scrap);
    return n;
  }
  // Copy the current (solved) charge into editable per-heat quantities.
  function toManual(s, result) {
    const n = clone(s); n.mode = 'manual';
    for (const k of CT.CHARGE_KEYS) n.manual[k] = Math.round(result.charge.masses[k] * s.heatSize * 10) / 10;
    return n;
  }

  CT.VERSION = VERSION;
  CT.util = { clone, get, set, sum, gauss, rebalance, isPlain };
  CT.engine = { validate, sanitize, composition, solveCharge, evaluateCharge, processModel, core, finish, calculate, compare,
    withShares, withMix, setGrade, toManual, captiveEF, powerEF };
  if (typeof module === 'object' && module.exports) module.exports = CT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
