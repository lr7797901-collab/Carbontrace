/* CarbonTrace Pro — UI controller. All numbers come from CT.engine / CT.optimizer / CT.analysis. */
(function () {
  'use strict';
  const CT = window.CT, E = CT.engine, U = CT.util, C = CT.charts, A = CT.analysis;
  const { esc, fmt } = C;
  const $ = id => document.getElementById(id);
  const STORE = 'ctpro-state-v1';
  const CAT_COLOR = { 'Base metallics': '--c-teal', 'Ferroalloys': '--c-violet', 'Electricity': '--c-sky', 'Process carbon': '--c-orange', 'Fuels': '--c-amber', 'Fluxes': '--c-lime', 'Industrial gases': '--c-slate' };
  const SCOPE = [{ label: 'Scope 1 · direct', color: '--s1' }, { label: 'Scope 2 · purchased power', color: '--s2' }, { label: 'Scope 3 · upstream inputs', color: '--s3' }];
  const FIELD = Object.fromEntries(CT.FIELDS.map(f => [f.path, f]));
  const POWER = CT.POWER_SOURCES;

  /* ---------------- State ---------------- */
  const freshBaselines = () => ({ '304': CT.defaultScenario('304'), '316': CT.defaultScenario('316'), '430': CT.defaultScenario('430') });
  let state = {
    current: CT.defaultScenario('304'), baselines: freshBaselines(), optimized: null, saved: [],
    opt: { objective: 'co2', step: 5, levers: { charge: true, nickel: true, power: true }, costCapPct: null },
    tab: 'dashboard', theme: 'dark', emisView: 'category', cmpTarget: 'current', sweepKey: 'ssShare', tornadoPct: 20
  };
  let lastOpt = null, selectedPareto = null, res = {}, storageOk = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORE); if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || d.schema !== 'ctpro-state-1') return;
      state.current = E.sanitize(d.current);
      for (const g of Object.keys(state.baselines)) if (d.baselines && d.baselines[g]) state.baselines[g] = E.sanitize(d.baselines[g]);
      state.optimized = d.optimized ? E.sanitize(d.optimized) : null;
      state.saved = Array.isArray(d.saved) ? d.saved.slice(0, 30).filter(x => x && typeof x.name === 'string' && x.scenario)
        .map(x => ({ id: String(x.id || Math.random().toString(36).slice(2)), name: x.name.slice(0, 60), savedAt: x.savedAt || '', scenario: E.sanitize(x.scenario) })) : [];
      if (d.opt && typeof d.opt === 'object') {
        if (['co2', 'cost', 'costCarbon'].includes(d.opt.objective)) state.opt.objective = d.opt.objective;
        if ([10, 5, 2.5, 1].includes(d.opt.step)) state.opt.step = d.opt.step;
        if (d.opt.levers) for (const k of ['charge', 'nickel', 'power']) if (typeof d.opt.levers[k] === 'boolean') state.opt.levers[k] = d.opt.levers[k];
        state.opt.costCapPct = Number.isFinite(d.opt.costCapPct) ? d.opt.costCapPct : null;
      }
      for (const k of ['tab', 'theme', 'emisView', 'cmpTarget', 'sweepKey']) if (typeof d[k] === 'string') state[k] = d[k];
      if ([10, 20, 30].includes(d.tornadoPct)) state.tornadoPct = d.tornadoPct;
    } catch (e) { console.warn('Saved state ignored:', e); }
  }
  let persistTimer;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(Object.assign({ schema: 'ctpro-state-1' }, state))); storageOk = true; }
      catch { storageOk = false; }
    }, 250);
  }

  /* ---------------- Helpers ---------------- */
  const pct = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null;
  const baseline = () => state.baselines[state.current.grade];
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function deltaHtml(v, base, d, unitLabel, lowerIsGood) {
    if (v === null || base === null || !Number.isFinite(v) || !Number.isFinite(base)) return '';
    const p = pct(v, base), diff = v - base;
    if (Math.abs(diff) < 1e-9) return '<span class="flat">= baseline</span>';
    const good = lowerIsGood === null ? null : (diff < 0) === lowerIsGood;
    return `<span class="${good === null ? 'flat' : good ? 'good' : 'bad'}">${diff < 0 ? '▼' : '▲'} ${fmt(Math.abs(p), 1)}% ${unitLabel || 'vs baseline'}</span>`;
  }
  const idOf = path => 'in-' + path.replace(/\./g, '-');
  const roundShow = v => Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : '';
  const statusBadge = st => st ? `<span class="badge ${st}">${{ verified: 'Verified', public: 'Public', literature: 'LCA', synthetic: 'Synthetic' }[st]}</span>` : '';
  function factorTip(path) {
    const f = FIELD[path]; if (!f) return '';
    let t = f.help || '';
    if (path.startsWith('factors.')) {
      const fac = CT.FACTORS[path.slice(8)], src = fac.source && CT.SOURCES[fac.source];
      t = `${fac.note}${src ? ' Source: ' + src.title + '.' : ' No public source: illustrative.'} Default ${fac.value} ${fac.unit}.`;
    }
    return t + ` Range ${f.min}–${f.max} ${f.unit}.`;
  }

  /* ---------------- Input panel ---------------- */
  function fieldRow(f) {
    const id = idOf(f.path);
    return `<div class="field" data-field="${f.path}">
      <div class="f-top"><label for="${id}">${esc(f.label)}</label>${statusBadge(f.status)}<i class="i-dot" data-tip="${esc(factorTip(f.path))}">i</i></div>
      <div class="f-ctl"><input type="range" data-path="${f.path}" min="${f.smin}" max="${f.smax}" step="any" aria-label="${esc(f.label)} slider">
        <input type="number" id="${id}" data-path="${f.path}" min="${f.min}" max="${f.max}" step="${f.step}" inputmode="decimal"><span class="unit">${esc(f.unit)}</span></div>
      <div class="f-err" aria-live="polite"></div></div>`;
  }
  function pairRow(attr, key, label, unit, max, tipText, color) {
    return `<div class="field pair" data-${attr}-row="${key}">
      <div class="f-top"><label for="in-${attr}-${key}">${color ? `<i class="sw" style="background:var(${color})"></i>` : ''}${esc(label)}</label>${tipText ? `<i class="i-dot" data-tip="${esc(tipText)}">i</i>` : ''}</div>
      <div class="f-ctl"><input type="range" data-${attr}="${key}" min="0" max="${max}" step="any" aria-label="${esc(label)} slider">
        <input type="number" id="in-${attr}-${key}" data-${attr}="${key}" min="0" max="${attr === 'manual' ? 1e6 : 100}" step="${attr === 'manual' ? 1 : 0.5}" inputmode="decimal"><span class="unit">${unit}</span></div>
      <div class="f-err"></div></div>`;
  }
  function buildInputs() {
    const open = { grade: false, charge: true, additions: false, energy: true, process: false, assays: false, factors: false, prices: false, limits: false };
    let html = '';
    for (const sec of CT.SECTIONS) {
      let pre = '';
      if (sec.id === 'charge') {
        pre = `<div class="seg wide" id="segMode"><button data-mode="auto">Auto-alloy solver</button><button data-mode="manual">Manual charge sheet</button></div>
          <div id="autoBlock"><h4>Base metallic feed <small>share of base feed · alloys solved separately</small></h4>
          ${CT.BASE_FEEDS.map(k => pairRow('share', k, CT.MATERIALS[k].label, '%', 100, k === 'pigIron' ? 'Virgin iron units; brings C and Si (more decarburisation and slag).' : k === 'csScrap' ? 'Low-alloy iron units; brings tramp Cu.' : 'Grade-segregated stainless scrap; carries Cr/Ni/Mo.', CT.MATERIALS[k].color)).join('')}
          <h4>Nickel units <small>for alloy-added Ni</small></h4>
          ${pairRow('ni', 'cathode', 'Ni supplied as cathode (rest as FeNi)', '%', 100, 'Same Ni in the steel; different upstream footprint and price per kg Ni.', '--c-indigo')}
          <div class="solved" id="solvedAlloys"></div>
          <button type="button" class="btn ghost full" id="btnToManual">Edit charge manually (per heat) →</button></div>
          <div id="manualBlock" hidden><h4>Charge per heat <small>kg · normalised to 1 t liquid</small></h4>
          ${CT.CHARGE_KEYS.map(k => pairRow('manual', k, CT.MATERIALS[k].label, 'kg', 1000, null, CT.MATERIALS[k].color)).join('')}
          <div class="solved" id="manualNote"></div>
          <button type="button" class="btn ghost full" id="btnToAuto">← Return to auto-alloy solver</button></div>`;
      }
      if (sec.id === 'energy') {
        pre = `<h4>Electricity supply mix <small>% of site electricity</small></h4>
          ${Object.keys(POWER).map(k => pairRow('mix', k, POWER[k].label, '%', 100, k === 'captive' ? 'Owned coal-fired generation → Scope 1. EF = IPCC coal factor × heat rate.' : k === 'grid' ? 'Location-based CEA grid factor → Scope 2.' : 'Contracted renewable PPA, market-based Scope 2 = 0.', POWER[k].color)).join('')}
          <h4>EAF electricity</h4><div class="seg wide" id="segEaf"><button data-eaf="model">Heat-balance model</button><button data-eaf="metered">Metered value</button></div>`;
      }
      if (sec.id === 'additions') pre = `<h4>Lime</h4><div class="seg wide" id="segLime"><button data-lime="auto">Auto (basicity target)</button><button data-lime="manual">Manual kg/t</button></div>`;
      html += `<details class="sec" data-sec="${sec.id}"${open[sec.id] ? ' open' : ''}><summary><span>${esc(sec.title)}</span><em class="sec-flag" id="flag-${sec.id}"></em></summary><div class="sec-body">${pre}${sec.fields.map(fieldRow).join('')}</div></details>`;
    }
    $('inputSections').innerHTML = html;
  }

  function syncInputs() {
    const s = state.current, active = document.activeElement;
    for (const el of document.querySelectorAll('#inputSections input')) {
      if (el === active && el.type === 'number') continue;
      let v;
      if (el.dataset.path) v = U.get(s, el.dataset.path);
      else if (el.dataset.share) v = s.shares[el.dataset.share];
      else if (el.dataset.mix) v = s.energy.mix[el.dataset.mix];
      else if (el.dataset.ni) v = s.niCathodeShare;
      else if (el.dataset.manual) v = s.manual[el.dataset.manual];
      else continue;
      if (el.type === 'range') { if (v > Number(el.max)) el.max = String(v); el.value = String(v); }
      else { el.value = roundShow(v); el.classList.remove('invalid'); const err = el.closest('.field').querySelector('.f-err'); if (err) err.textContent = ''; }
    }
    document.querySelectorAll('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    document.querySelectorAll('#segEaf button').forEach(b => b.classList.toggle('on', b.dataset.eaf === s.energy.eafMode));
    document.querySelectorAll('#segLime button').forEach(b => b.classList.toggle('on', b.dataset.lime === s.limeMode));
    document.querySelectorAll('.grade-switch button').forEach(b => { const on = b.dataset.grade === s.grade; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('autoBlock').hidden = s.mode !== 'auto'; $('manualBlock').hidden = s.mode !== 'manual';
    $('modePill').textContent = s.mode === 'auto' ? 'Auto-alloy solver' : 'Manual charge sheet';
    $('modePill').classList.toggle('manual', s.mode === 'manual');
    const usesNi = CT.GRADES[s.grade].solve.includes('Ni');
    document.querySelectorAll('[data-ni]').forEach(el => { el.disabled = !usesNi; });
    const dim = (path, on) => { const r = document.querySelector(`[data-field="${path}"]`); if (r) r.classList.toggle('dim', !on); };
    dim('energy.meteredKwh', s.energy.eafMode === 'metered'); dim('adds.limeKg', s.limeMode === 'manual'); dim('basicity', s.limeMode === 'auto');
    dim('feSi', s.mode === 'auto'); dim('aim.Ni', usesNi); dim('aim.Mo', s.grade === '316');
    for (const k of CT.CHARGE_KEYS) { const r = document.querySelector(`[data-manual="${k}"][type=range]`); if (r) r.max = String(Math.max(Number(r.max), s.heatSize * 1100)); }
  }

  function showFieldError(el, msg) {
    el.classList.add('invalid');
    const err = el.closest('.field') && el.closest('.field').querySelector('.f-err'); if (err) err.textContent = msg;
  }
  function onInput(e) {
    const el = e.target; if (el.tagName !== 'INPUT') return;
    const raw = el.value.trim(), v = Number(raw), s = state.current;
    const mirror = sel => { for (const o of document.querySelectorAll(sel)) if (o !== el) o.value = o.type === 'range' ? raw : roundShow(v); };
    const bad = (min, max, unit) => { showFieldError(el, `Not applied — enter ${min}–${max} ${unit}`); };
    if (raw === '' || !Number.isFinite(v)) { showFieldError(el, 'Not applied — enter a number'); return; }
    el.classList.remove('invalid'); const err = el.closest('.field') && el.closest('.field').querySelector('.f-err'); if (err) err.textContent = '';
    let n;
    if (el.dataset.path) {
      const f = FIELD[el.dataset.path]; if (v < f.min || v > f.max) return bad(f.min, f.max, f.unit);
      n = U.clone(s); U.set(n, el.dataset.path, v); mirror(`[data-path="${el.dataset.path}"]`);
    } else if (el.dataset.share) {
      if (v < 0 || v > 100) return bad(0, 100, '%');
      n = E.withShares(s, el.dataset.share, v);
    } else if (el.dataset.mix) {
      if (v < 0 || v > 100) return bad(0, 100, '%');
      n = E.withMix(s, el.dataset.mix, v);
    } else if (el.dataset.ni) {
      if (v < 0 || v > 100) return bad(0, 100, '%');
      n = U.clone(s); n.niCathodeShare = v; mirror('[data-ni]');
    } else if (el.dataset.manual) {
      if (v < 0 || v > 1e6) return bad(0, 1000000, 'kg');
      n = U.clone(s); n.manual[el.dataset.manual] = v; mirror(`[data-manual="${el.dataset.manual}"]`);
    } else return;
    commit(n);
  }
  function onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const s = state.current;
    if (b.dataset.mode) {
      if (b.dataset.mode === s.mode) return;
      if (b.dataset.mode === 'manual') return toManual();
      const n = U.clone(s); n.mode = 'auto'; commit(n); toast('Auto-alloy solver: alloys are solved to the grade aim.');
    } else if (b.dataset.eaf) { const n = U.clone(s); n.energy.eafMode = b.dataset.eaf; commit(n); }
    else if (b.dataset.lime) { const n = U.clone(s); n.limeMode = b.dataset.lime; commit(n); }
    else if (b.id === 'btnToManual') toManual();
    else if (b.id === 'btnToAuto') { const n = U.clone(s); n.mode = 'auto'; commit(n); }
  }
  function toManual() {
    if (!res.current || !res.current.ok) { toast('Resolve the current input error before switching to manual.'); return; }
    commit(E.toManual(state.current, res.current));
    toast(`Charge copied to a ${state.current.heatSize} t heat sheet — edit any material.`);
  }

  /* ---------------- Commit & render loop ---------------- */
  let raf = 0;
  function commit(n) { state.current = n; schedule(); persist(); }
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function compute() {
    res.current = E.calculate(state.current);
    res.baseline = E.calculate(baseline());
    res.optimized = state.optimized && state.optimized.grade === state.current.grade ? E.calculate(state.optimized) : null;
  }

  function render() {
    compute();
    syncInputs();
    renderKpis();
    renderStatus();
    renderTab(state.tab);
  }

  function renderKpis() {
    const r = res.current, b = res.baseline && res.baseline.ok ? res.baseline.kpi : null;
    const set = (id, html) => { $(id).innerHTML = html; };
    if (!r.ok) {
      for (const id of ['kCo2', 'kEnergy', 'kElec', 'kCost', 'kRecycled']) set(id, '—');
      for (const id of ['kCo2d', 'kEnergyd', 'kElecd', 'kCostd', 'kRecycledd', 'kAnnual']) set(id, '');
      set('kStatus', '<span class="bad">No solution</span>'); set('kStatusSub', esc(r.reason)); return;
    }
    const k = r.kpi;
    set('kCo2', fmt(k.co2, 3)); set('kCo2d', b ? deltaHtml(k.co2, b.co2, 1, '', true) : '');
    set('kEnergy', fmt(k.energyGJ, 2)); set('kEnergyd', b ? deltaHtml(k.energyGJ, b.energyGJ, 1, '', true) : '');
    set('kElec', fmt(k.elecKwh, 0)); set('kElecSub', `kWh / t slab · ${fmt(k.rePct, 0)}% renewable`); set('kElecd', b ? deltaHtml(k.elecKwh, b.elecKwh, 1, '', true) : '');
    set('kCost', fmt(k.cost, 0)); set('kCostd', b ? deltaHtml(k.cost, b.cost, 1, '', true) : '');
    set('kRecycled', fmt(k.recycledPct, 1)); set('kRecycledd', b ? deltaHtml(k.recycledPct, b.recycledPct, 1, '', false) : '');
    const nv = r.violations.length;
    set('kStatus', nv ? `<span class="bad">${nv} issue${nv > 1 ? 's' : ''}</span>` : '<span class="good">Feasible</span>');
    set('kStatusSub', `${CT.GRADES[r.scenario.grade].name}`);
    if (b) {
      const dAnnual = (k.co2 - b.co2) * r.scenario.econ.annualTonnes;
      set('kAnnual', Math.abs(dAnnual) < 0.5 ? '<span class="flat">at baseline</span>' : `<span class="${dAnnual < 0 ? 'good' : 'bad'}">${dAnnual < 0 ? '−' : '+'}${fmt(Math.abs(dAnnual), 0)} t CO₂e/yr</span>`);
    }
    document.querySelector('.kpi.hero').classList.toggle('alert', nv > 0);
  }

  function renderStatus() {
    const r = res.current, bar = $('statusBar'); let html = '';
    if (!r.ok) html = `<div class="st err"><b>Cannot calculate:</b> ${esc(r.reason)}</div>`;
    else {
      if (r.violations.length) html += r.violations.map(v => `<div class="st err"><b>${esc(v.type)}:</b> ${esc(v.msg)}</div>`).join('');
      html += r.warnings.map(w => `<div class="st warn">${esc(w)}</div>`).join('');
      if (!r.violations.length) html = `<div class="st ok">✓ Within all modelled chemistry, availability, process and power limits.</div>` + html;
      if (baseline().grade !== state.current.grade) html += '<div class="st warn">Baseline is for a different grade.</div>';
    }
    if (!storageOk) html += '<div class="st warn">Browser storage unavailable — use Export JSON to keep scenarios.</div>';
    bar.innerHTML = html;
    // section flags
    const flags = { charge: r.ok && r.violations.some(v => ['availability', 'process'].includes(v.type)), grade: r.ok && r.violations.some(v => v.type === 'chemistry'),
      energy: r.ok && r.violations.some(v => v.type === 'power') };
    for (const s of CT.SECTIONS) { const el = $('flag-' + s.id); if (el) el.textContent = flags[s.id] ? '●' : ''; }
  }

  function renderTab(tab) {
    document.querySelectorAll('.tabs button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + tab; });
    ({ dashboard: renderDashboard, optimize: renderOptimize, scenarios: renderScenarios, sensitivity: renderSensitivity, method: renderMethod })[tab]();
  }

  /* ---------------- Dashboard ---------------- */
  function renderDashboard() {
    const r = res.current;
    renderAutoPanel(r);
    if (!r.ok) {
      for (const id of ['chEmissions', 'chScopeBar', 'chCharge', 'chChem', 'chEnergy', 'chPower', 'chBvc', 'chBvcWaterfall']) $(id).innerHTML = `<div class="chart-empty">${esc(r.reason)}</div>`;
      for (const id of ['tblCharge', 'tblLines']) $(id).innerHTML = '';
      return;
    }
    const y = r.scenario.energy.castYield;
    // Emissions donut
    const items = state.emisView === 'scope'
      ? SCOPE.map((sc, i) => ({ label: sc.label, value: r.emissions.byScopeSlab[i], color: sc.color }))
      : A.CATEGORY_ORDER.map(cat => ({ label: cat, value: (r.emissions.byCategory[cat] || 0) / 1000 / y, color: CAT_COLOR[cat] }));
    $('chEmissions').innerHTML = C.donut(items, { unit: 't CO₂e/t', center: fmt(r.kpi.co2, 2), centerUnit: 't CO₂e / t slab', aria: 'Emissions breakdown' });
    document.querySelectorAll('#emisView button').forEach(b => b.classList.toggle('on', b.dataset.v === state.emisView));
    $('chScopeBar').innerHTML = `<div class="mini-label">GHG Protocol scopes</div>` + C.stackBar(SCOPE.map((sc, i) => ({ label: sc.label, short: ['S1', 'S2', 'S3'][i], value: r.emissions.byScopeSlab[i], color: sc.color })), { unit: 't CO₂e/t slab', d: 3 });
    // Charge
    const m = r.charge.masses;
    $('chargeMeta').textContent = `${fmt(r.charge.total, 0)} kg metallic charge per t liquid · metallic yield ${fmt(r.charge.metallicYield * 100, 1)}% · charge C ${fmt(r.charge.chargeCPct, 2)}%`;
    $('chCharge').innerHTML = C.stackBar(CT.CHARGE_KEYS.map(k => ({ label: CT.MATERIALS[k].label, short: CT.MATERIALS[k].short, value: m[k], color: CT.MATERIALS[k].color })), { unit: 'kg/t liquid' });
    const lineKg = id => (r.emissions.lines.find(l => l.id === id) || { kg: 0 }).kg;
    $('tblCharge').innerHTML = `<thead><tr><th>Material</th><th>kg / t liquid</th><th>kg / heat</th><th>Cap kg/t</th><th>t CO₂e / t slab</th></tr></thead><tbody>` +
      CT.CHARGE_KEYS.filter(k => m[k] > 0 || r.scenario.mode === 'manual').map(k => {
        const over = m[k] > r.scenario.limits.cap[k] + 1e-6;
        return `<tr${over ? ' class="over"' : ''}><td data-tip="${esc(CT.MATERIALS[k].label)}"><i class="sw" style="background:var(${CT.MATERIALS[k].color})"></i>${esc(CT.MATERIALS[k].short)}</td><td class="num">${fmt(m[k], 1)}</td><td class="num">${fmt(r.charge.perHeat[k], 0)}</td><td class="num">${fmt(r.scenario.limits.cap[k], 0)}</td><td class="num">${fmt(lineKg(k) / 1000 / y, 3)}</td></tr>`;
      }).join('') + `<tr class="tot"><td>Total metallic charge</td><td class="num">${fmt(r.charge.total, 1)}</td><td class="num">${fmt(r.charge.total * r.scenario.heatSize, 0)}</td><td></td><td class="num">${fmt(U.sum(CT.CHARGE_KEYS.map(k => lineKg(k))) / 1000 / y, 3)}</td></tr></tbody>`;
    // Chemistry
    $('chemMeta').textContent = r.chemistry.pass ? 'All screened elements within limits' : 'Out-of-spec elements highlighted';
    $('chChem').innerHTML = r.chemistry.checks.map(k => {
      const hi = Math.max((k.max ?? 0) * 1.25, k.value * 1.15, (k.aim || 0) * 1.25, 0.1), xp = v => Math.min(100, Math.max(0, v / hi * 100));
      const band = k.max !== null ? `<span class="band" style="left:${xp(k.min || 0)}%;width:${xp(k.max) - xp(k.min || 0)}%"></span>` : '';
      const aim = k.aim ? `<span class="aim" style="left:${xp(k.aim)}%" data-tip="Aim ${k.aim}%"></span>` : '';
      const spec = k.max === null ? 'not specified' : k.el === 'Cu' ? `≤ ${k.max}% (operational)` : (k.min ? `${k.min}–${k.max}%` : `≤ ${k.max}%`);
      return `<div class="chem-row ${k.pass ? '' : 'fail'}"><b>${k.el}</b><div class="chem-track" data-tip="${k.el}: ${fmt(k.value, 3)}% · spec ${spec}">${band}${aim}<span class="mark" style="left:${xp(k.value)}%"></span></div><span class="num">${fmt(k.value, 3)}%</span><small>${spec}</small><em class="${k.pass ? 'good' : 'bad'}">${k.pass ? 'Pass' : 'Fail'}</em></div>`;
    }).join('') + `<p class="muted small">Fe ${fmt(r.chemistry.pct.Fe, 2)}% (balance). Slag ${fmt(r.slag.kg, 0)} kg/t · basicity ${r.slag.basicity === null ? '—' : fmt(r.slag.basicity, 2)} · lime ${fmt(r.slag.lime, 1)} kg/t · O₂ ${fmt(r.energy.o2Nm3, 1)} Nm³/t.</p>`;
    // Energy balance waterfall (kWh / t liquid)
    const h = r.energy.heat, steps = [
      { label: 'Heat to slag', delta: h.slag }, { label: 'Thermal losses', delta: h.losses },
      { label: 'Oxidation heat credit', delta: -h.chemical }, { label: 'Burner heat credit', delta: -h.gas },
      { label: 'Electrical inefficiency', delta: r.energy.eafModelKwh - h.net }];
    if (r.scenario.energy.eafMode === 'metered') steps.push({ label: 'Metered adjustment', delta: r.energy.eafKwh - r.energy.eafModelKwh });
    steps.push({ label: 'Auxiliary loads', delta: r.energy.auxKwh });
    $('chEnergy').innerHTML = C.waterfall({ start: h.steel, end: r.energy.siteKwh, steps }, { unit: 'kWh / t liquid', startLabel: 'Heat to liquid steel', endLabel: 'Site electricity', d: 0 });
    $('energyMeta').textContent = `${fmt(r.energy.siteKwh, 0)} kWh/t liquid · ${fmt(r.kpi.energyGJ, 2)} GJ/t slab site energy`;
    const g = r.energy.GJ;
    $('chPower').innerHTML = `<div class="mini-label">Electricity by source (kWh / t liquid)</div>` + C.stackBar(Object.keys(POWER).map(k => ({ label: POWER[k].label, short: POWER[k].label, value: r.energy.bySource[k], color: POWER[k].color })), { unit: 'kWh/t', d: 0 }) +
      `<div class="mini-label mt">Site energy (GJ / t liquid)</div>` + C.stackBar([{ label: 'Electricity', value: g.electricity, color: '--c-sky' }, { label: 'Natural gas', value: g.naturalGas, color: '--c-amber' }, { label: 'Coke (NCV)', value: g.coke, color: '--c-coal' }], { unit: 'GJ/t', d: 3 }) +
      `<p class="muted small">Captive EF ${fmt(r.energy.captiveEF, 3)} kg CO₂/kWh · purchased O₂/Ar electricity ${fmt(r.energy.gasKwh, 1)} kWh/t (Scope 3).</p>`;
    // Baseline vs current
    const cols = [['Baseline', res.baseline]];
    cols.push(['Current', r]);
    if (res.optimized && res.optimized.ok) cols.push(['Optimised', res.optimized]);
    $('chBvc').innerHTML = C.columns(cols.filter(c => c[1].ok).map(([label, rr]) => ({ label, sub: `₹${fmt(rr.kpi.cost / 1000, 1)}k/t`, segments: SCOPE.map((sc, i) => ({ label: sc.label, value: rr.emissions.byScopeSlab[i], color: sc.color })) })), { unit: 't CO₂e / t slab' });
    const cmp = E.compare(res.baseline, r);
    $('bvcMeta').textContent = cmp.valid ? `${cmp.dCo2 <= 0 ? 'Reduction' : 'Increase'} ${fmt(Math.abs(cmp.dCo2), 3)} t CO₂e/t (${fmt(Math.abs(cmp.dCo2Pct), 1)}%) · ${fmt(Math.abs(cmp.annualCo2), 0)} t CO₂e/yr` : '';
    $('chBvcWaterfall').innerHTML = res.baseline.ok ? C.waterfall(A.waterfall(res.baseline, r), { unit: 't CO₂e / t slab', startLabel: 'Baseline', endLabel: 'Current' }) : '';
    // Lines
    $('tblLines').innerHTML = `<thead><tr><th>Source</th><th>Scope</th><th>Activity</th><th>Factor</th><th>kg CO₂e / t liquid</th><th>₹ / t liquid</th></tr></thead><tbody>` +
      r.emissions.lines.map(l => `<tr><td><i class="sw" style="background:var(${CAT_COLOR[l.category]})"></i>${esc(l.label)}<small>${esc(l.category)}</small></td><td>S${l.scope}</td><td class="num">${fmt(l.qty, 2)} ${esc(l.unit)}</td><td class="num">${fmt(l.factor, 3)} <small>${esc(l.factorUnit)}</small></td><td class="num">${fmt(l.kg, 1)}</td><td class="num">${fmt(l.cost, 0)}</td></tr>`).join('') +
      `<tr class="tot"><td>Total per t liquid</td><td></td><td></td><td></td><td class="num">${fmt(r.emissions.totalKgLiquid, 1)}</td><td class="num">${fmt(r.cost.totalLiquid, 0)}</td></tr>
       <tr class="tot"><td>Per t slab (÷ casting yield ${fmt(y, 3)})</td><td></td><td></td><td></td><td class="num">${fmt(r.kpi.co2 * 1000, 1)}</td><td class="num">${fmt(r.kpi.cost, 0)}</td></tr></tbody>`;
  }

  function renderAutoPanel(r) {
    const s = state.current;
    if (!r.ok) { $('solvedAlloys').innerHTML = `<p class="bad small">${esc(r.reason)}</p>`; $('manualNote').innerHTML = `<p class="bad small">${esc(r.reason)}</p>`; return; }
    const m = r.charge.masses, rows = ['feCr', 'feNi', 'niCathode', 'feMo', 'feMn'].filter(k => m[k] > 0 || ['feCr'].includes(k));
    $('solvedAlloys').innerHTML = `<div class="mini-label">Solved alloy additions (kg / t liquid)</div><div class="chips">${rows.map(k => `<span class="chip"><i class="sw" style="background:var(${CT.MATERIALS[k].color})"></i>${CT.MATERIALS[k].short} <b>${fmt(m[k], 1)}</b></span>`).join('')}</div>`;
    $('manualNote').innerHTML = s.mode === 'manual' ? `<p class="small muted">Batch ${fmt(U.sum(CT.CHARGE_KEYS.map(k => s.manual[k])), 0)} kg → ${fmt(1 / r.charge.scale, 2)} t liquid (normalised ×${fmt(r.charge.scale, 4)} per t). Chemistry is checked, not forced.</p>` : '';
  }

  /* ---------------- Optimiser ---------------- */
  function syncOptForm() {
    $('optObjective').value = state.opt.objective; $('optStep').value = String(state.opt.step);
    $('optCostCap').value = state.opt.costCapPct === null ? '' : state.opt.costCapPct;
    $('levCharge').checked = state.opt.levers.charge; $('levNickel').checked = state.opt.levers.nickel; $('levPower').checked = state.opt.levers.power;
  }
  function runOptimizer() {
    const btn = $('btnOptimize'); btn.disabled = true; btn.textContent = 'Optimising…';
    setTimeout(() => {
      try {
        const refCost = res.baseline && res.baseline.ok ? res.baseline.kpi.cost : null;
        lastOpt = CT.optimizer.optimize(state.current, { objective: state.opt.objective, step: state.opt.step, levers: state.opt.levers, maxCostIncreasePct: state.opt.costCapPct, refCost });
        lastOpt.inputKey = JSON.stringify(state.current); lastOpt.fromScenario = U.clone(state.current);
        selectedPareto = null;
        if (lastOpt.best) { state.optimized = Object.assign(U.clone(lastOpt.bestScenario), { name: 'Optimised' }); persist(); }
        render();
        toast(lastOpt.best ? `Optimised: ${lastOpt.feasible.toLocaleString('en-IN')} feasible of ${lastOpt.evaluated.toLocaleString('en-IN')} combinations in ${lastOpt.ms} ms.` : 'No feasible combination found — see reasons.');
      } finally { btn.disabled = false; btn.textContent = 'Run optimisation'; }
    }, 20);
  }
  function describeMix(m) { return Object.keys(POWER).filter(k => m[k] > 0.05).map(k => `${POWER[k].label} ${fmt(m[k], 0)}%`).join(' · '); }
  function renderOptimize() {
    syncOptForm();
    const box = $('optResults');
    if (!lastOpt) { box.innerHTML = `<article class="card"><div class="chart-empty tall">Choose the objective and levers, then <b>Run optimisation</b>. The optimiser enumerates base-feed mixes, nickel sources and electricity mixes, re-solves alloys for the grade aim at each point, discards anything that breaks a constraint, and returns the best recipe with its cost–CO₂e trade-off curve.</div></article>`; return; }
    const o = lastOpt;
    if (!o.ok || !o.best) {
      box.innerHTML = `<article class="card"><div class="st err">${esc(o.reason || 'Optimisation failed.')}</div>${reasonsHtml(o)}</article>`; return;
    }
    const stale = o.inputKey !== JSON.stringify(state.current);
    const from = E.calculate(o.fromScenario), best = o.bestResult, rb = res.baseline;
    const cmpB = E.compare(rb, best), cmpF = E.compare(from, best);
    const ob = { co2: 'minimum CO₂e', cost: 'minimum variable cost', costCarbon: 'minimum cost incl. carbon price' }[o.objective];
    const sel = selectedPareto !== null ? o.pareto[selectedPareto] : null;
    const row = (label, a, b, d, unit) => {
      const diff = b - a, show = Math.abs(diff) > 1e-6;
      return `<tr><td>${label}</td><td class="num">${fmt(a, d)}</td><td class="num">${fmt(b, d)}</td><td class="num ${show ? (diff < 0 ? 'dn' : 'up') : ''}">${show ? (diff > 0 ? '+' : '') + fmt(diff, d) : '—'}</td><td class="muted">${unit}</td></tr>`;
    };
    const fs = from.ok ? from.scenario : o.fromScenario, bs = best.scenario;
    const att = A.attribution(o.fromScenario, o.bestScenario);
    box.innerHTML = `${stale ? '<div class="st warn">Inputs changed since this run — results below refer to the earlier inputs. Re-run to refresh.</div>' : ''}
    <div class="grid g2">
      <article class="card rec">
        <header><h3>Recommended recipe <small>(${ob})</small></h3><span class="badge ${best.feasible ? 'ok' : 'synthetic'}">${best.feasible ? 'All constraints met' : 'Check'}</span></header>
        <div class="rec-big"><div><span>From current</span><b>${fmt(from.ok ? from.kpi.co2 : null, 3)}</b></div><div class="arrow">→</div><div><span>Recommended</span><b class="good">${fmt(best.kpi.co2, 3)}</b></div><div><span>t CO₂e / t slab</span><b class="${cmpF.valid && cmpF.dCo2 <= 0 ? 'good' : 'bad'}">${cmpF.valid ? fmt(cmpF.dCo2Pct, 1) + '%' : '—'}</b></div></div>
        <ul class="facts">
          <li><span>vs frozen baseline</span><b>${cmpB.valid ? `${fmt(cmpB.dCo2, 3)} t/t (${fmt(cmpB.dCo2Pct, 1)}%)` : '—'}</b></li>
          <li><span>Annual impact at ${fmt(bs.econ.annualTonnes, 0)} t/yr</span><b>${cmpB.valid ? `${fmt(cmpB.annualCo2, 0)} t CO₂e/yr` : '—'}</b></li>
          <li><span>Variable cost change vs baseline</span><b>${cmpB.valid ? `${cmpB.dCost >= 0 ? '+' : '−'}₹${fmt(Math.abs(cmpB.dCost), 0)}/t (${fmt(cmpB.dCostPct, 1)}%)` : '—'}</b></li>
          <li><span>Abatement cost vs baseline</span><b>${cmpB.valid && cmpB.abatementCost !== null ? `₹${fmt(cmpB.abatementCost, 0)} / t CO₂e` : '—'}</b></li>
          <li><span>Search</span><b>${o.evaluated.toLocaleString('en-IN')} evaluated · ${o.feasible.toLocaleString('en-IN')} feasible · ${o.ms} ms</b></li>
        </ul>
        <div class="btn-row"><button class="btn primary" type="button" data-apply="best">Apply to current</button><button class="btn ghost" type="button" data-goto="scenarios">Compare scenarios</button></div>
      </article>
      <article class="card"><header><h3>What changes</h3><span class="muted">current → recommended</span></header>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th>Current</th><th>Recommended</th><th>Δ</th><th></th></tr></thead><tbody>
        ${row('SS scrap share', fs.shares.ssScrap, bs.shares.ssScrap, 1, '% base')}${row('CS scrap share', fs.shares.csScrap, bs.shares.csScrap, 1, '% base')}${row('Pig iron share', fs.shares.pigIron, bs.shares.pigIron, 1, '% base')}
        ${CT.GRADES[bs.grade].solve.includes('Ni') ? row('Ni as cathode', fs.niCathodeShare, bs.niCathodeShare, 0, '%') : ''}
        ${Object.keys(POWER).map(k => row(POWER[k].label, fs.energy.mix[k], bs.energy.mix[k], 0, '% power')).join('')}
        ${from.ok ? ['ssScrap', 'pigIron', 'feCr', 'feNi', 'niCathode', 'feMo'].filter(k => from.charge.masses[k] > 0 || best.charge.masses[k] > 0).map(k => row(CT.MATERIALS[k].short, from.charge.masses[k], best.charge.masses[k], 1, 'kg/t liq')).join('') : ''}
        ${from.ok ? row('Electricity', from.kpi.elecKwh, best.kpi.elecKwh, 0, 'kWh/t slab') + row('Variable cost', from.kpi.cost, best.kpi.cost, 0, '₹/t slab') + row('CO₂e', from.kpi.co2, best.kpi.co2, 3, 't/t slab') : ''}
        </tbody></table></div></article>
    </div>
    <div class="grid g2">
      <article class="card"><header><h3>Cost vs CO₂e trade-off</h3><span class="muted">${o.points.length.toLocaleString('en-IN')} feasible points shown · green = Pareto frontier (click a point)</span></header>
        <div id="chPareto"></div><div id="paretoPick"></div></article>
      <article class="card"><header><h3>Contribution of each lever</h3><span class="muted">sequential: charge → nickel → power</span></header>
        <div>${att ? C.waterfall({ start: att.start, end: att.end, steps: att.steps.map(s => ({ label: s.label, delta: s.dCo2 })) }, { unit: 't CO₂e / t slab', startLabel: 'Current', endLabel: 'Recommended' }) : '<div class="chart-empty">Attribution unavailable.</div>'}</div>
        ${att ? `<table class="tbl compact"><thead><tr><th>Lever</th><th>Δ CO₂e t/t</th><th>Δ cost ₹/t</th></tr></thead><tbody>${att.steps.map(s => `<tr><td>${s.label}</td><td class="num ${s.dCo2 < 0 ? 'dn' : s.dCo2 > 0 ? 'up' : ''}">${fmt(s.dCo2, 3)}</td><td class="num">${fmt(s.dCost, 0)}</td></tr>`).join('')}</tbody></table>` : ''}</article>
    </div>
    <article class="card"><header><h3>Top-ranked feasible alternatives</h3><span class="muted">apply any option to explore it</span></header>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>SS / CS / pig %</th><th>Ni cathode</th><th>Electricity mix</th><th>t CO₂e/t</th><th>₹/t</th><th></th></tr></thead><tbody>
      ${o.ranked.map((p, i) => `<tr><td>${i + 1}</td><td>${fmt(p.shares.ssScrap, 1)} / ${fmt(p.shares.csScrap, 1)} / ${fmt(p.shares.pigIron, 1)}</td><td>${p.ni}%</td><td>${describeMix(p.mix)}</td><td class="num">${fmt(p.co2, 3)}</td><td class="num">${fmt(p.cost, 0)}</td><td><button class="btn small" type="button" data-apply="rank" data-i="${i}">Apply</button></td></tr>`).join('')}
      </tbody></table></div>${reasonsHtml(o)}</article>`;
    const markers = [];
    if (from.ok) markers.push({ label: 'Current', co2: from.kpi.co2, cost: from.kpi.cost, cls: 'cur' });
    if (rb.ok && rb.scenario.grade === bs.grade) markers.push({ label: 'Baseline', co2: rb.kpi.co2, cost: rb.kpi.cost, cls: 'base' });
    markers.push({ label: 'Recommended', co2: best.kpi.co2, cost: best.kpi.cost, cls: 'best' });
    $('chPareto').innerHTML = C.scatter(o, { markers, extra: markers });
    $('paretoPick').innerHTML = sel ? `<div class="pick"><b>Pareto option ${selectedPareto + 1}</b> · ${fmt(sel.co2, 3)} t CO₂e/t · ₹${fmt(sel.cost, 0)}/t · SS ${fmt(sel.shares.ssScrap, 1)}% / CS ${fmt(sel.shares.csScrap, 1)}% / pig ${fmt(sel.shares.pigIron, 1)}% · Ni cathode ${sel.ni}% · ${describeMix(sel.mix)} <button class="btn small primary" type="button" data-apply="pareto">Apply this option</button></div>` : '<p class="muted small">Each Pareto point is a recipe where CO₂e cannot fall without raising cost. Click one to inspect it.</p>';
  }
  function reasonsHtml(o) {
    const labels = { availability: 'material availability cap', process: 'charge-carbon limit', chemistry: 'grade chemistry', power: 'RE/captive availability', cost: 'cost ceiling' };
    const ent = Object.entries(o.reasons || {}).sort((a, b) => b[1] - a[1]);
    return ent.length ? `<p class="muted small">Rejected combinations: ${ent.map(([k, v]) => `${esc(labels[k] || k)} ${v.toLocaleString('en-IN')}`).join(' · ')}.</p>` : '';
  }
  function applyScenario(sc, msg) {
    const n = U.clone(sc); delete n.name; commit(n); toast(msg);
  }

  /* ---------------- Scenarios ---------------- */
  function scenarioList() {
    const list = [{ key: 'baseline', name: `Baseline (${state.current.grade})`, scenario: baseline(), kind: 'baseline' },
      { key: 'current', name: 'Current (live)', scenario: state.current, kind: 'current' }];
    if (state.optimized) list.push({ key: 'optimized', name: `Optimised (${state.optimized.grade})`, scenario: state.optimized, kind: 'optimized' });
    for (const s of state.saved) list.push({ key: 'saved:' + s.id, name: s.name, scenario: s.scenario, kind: 'saved', id: s.id, savedAt: s.savedAt });
    return list.map(x => Object.assign(x, { result: E.calculate(x.scenario) }));
  }
  function renderScenarios() {
    const list = scenarioList(), rb = list[0].result;
    $('scenarioCards').innerHTML = list.map(x => {
      const r = x.result, c = r.ok && rb.ok && x.kind !== 'baseline' && x.scenario.grade === list[0].scenario.grade ? E.compare(rb, r) : null;
      return `<div class="scen ${x.kind}"><div class="scen-h"><b>${esc(x.name)}</b><span class="tag">${x.kind}</span></div>
        <div class="scen-v">${r.ok ? fmt(r.kpi.co2, 3) : '—'}<small> t CO₂e/t</small></div>
        <div class="scen-m">Grade ${x.scenario.grade} · ${x.scenario.mode} · ₹${r.ok ? fmt(r.kpi.cost / 1000, 1) + 'k' : '—'}/t · ${r.ok ? fmt(r.kpi.energyGJ, 2) : '—'} GJ/t</div>
        <div class="scen-m">${!r.ok ? `<span class="bad">${esc(r.reason)}</span>` : r.feasible ? '<span class="good">Feasible</span>' : `<span class="bad">${r.violations.length} constraint issue(s)</span>`}${c && c.valid ? ` · <span class="${c.dCo2 <= 0 ? 'good' : 'bad'}">${fmt(c.dCo2Pct, 1)}% vs baseline</span>` : ''}</div>
        <div class="scen-a">${x.kind !== 'current' ? `<button class="btn small" type="button" data-load="${x.key}">Load as current</button>` : ''}${x.kind !== 'baseline' ? `<button class="btn small ghost" type="button" data-baseline="${x.key}">Set as baseline</button>` : ''}${x.kind === 'saved' ? `<button class="btn small danger" type="button" data-del="${x.id}" aria-label="Delete ${esc(x.name)}">Delete</button>` : ''}</div></div>`;
    }).join('');
    const ok = list.filter(x => x.result.ok);
    $('chScenarios').innerHTML = C.columns(ok.slice(0, 8).map(x => ({ label: x.name.length > 16 ? x.name.slice(0, 15) + '…' : x.name, sub: x.scenario.grade, segments: SCOPE.map((sc, i) => ({ label: sc.label, value: x.result.emissions.byScopeSlab[i], color: sc.color })) })), { unit: 't CO₂e / t slab' });
    const sel = $('cmpTarget'), opts = list.filter(x => x.kind !== 'baseline');
    sel.innerHTML = opts.map(x => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join('');
    if (!opts.some(x => x.key === state.cmpTarget)) state.cmpTarget = 'current';
    sel.value = state.cmpTarget;
    const tgt = list.find(x => x.key === state.cmpTarget);
    $('chScenWaterfall').innerHTML = tgt && tgt.result.ok && rb.ok
      ? (tgt.scenario.grade !== list[0].scenario.grade ? '<div class="st warn">Different grade from the baseline — comparison is indicative only.</div>' : '') + C.waterfall(A.waterfall(rb, tgt.result), { unit: 't CO₂e / t slab', startLabel: 'Baseline', endLabel: tgt.name.slice(0, 14) })
      : '<div class="chart-empty">Select a valid scenario.</div>';
    const metrics = [
      ['Grade', x => x.scenario.grade], ['Mode', x => x.scenario.mode],
      ['CO₂e (t/t slab)', x => x.result.ok ? fmt(x.result.kpi.co2, 3) : '—'],
      ['Scope 1 / 2 / 3', x => x.result.ok ? x.result.emissions.byScopeSlab.map(v => fmt(v, 3)).join(' / ') : '—'],
      ['Δ vs baseline', x => x.result.ok && rb.ok && x.kind !== 'baseline' ? fmt(pct(x.result.kpi.co2, rb.kpi.co2), 1) + '%' : '—'],
      ['Site energy (GJ/t)', x => x.result.ok ? fmt(x.result.kpi.energyGJ, 2) : '—'],
      ['Electricity (kWh/t)', x => x.result.ok ? fmt(x.result.kpi.elecKwh, 0) : '—'],
      ['Renewable share', x => fmt(x.scenario.energy.mix.solar + x.scenario.energy.mix.wind, 0) + '%'],
      ['Variable cost (₹/t)', x => x.result.ok ? fmt(x.result.kpi.cost, 0) : '—'],
      ['Recycled input', x => x.result.ok ? fmt(x.result.kpi.recycledPct, 1) + '%' : '—'],
      ['SS / CS / pig (% base)', x => `${fmt(x.scenario.shares.ssScrap, 0)} / ${fmt(x.scenario.shares.csScrap, 0)} / ${fmt(x.scenario.shares.pigIron, 0)}`],
      ['Annual CO₂e (t/yr)', x => x.result.ok ? fmt(x.result.kpi.annualCo2, 0) : '—'],
      ['Status', x => !x.result.ok ? 'No solution' : x.result.feasible ? 'Feasible' : 'Constraint issue']
    ];
    $('tblScenarios').innerHTML = `<thead><tr><th>Metric</th>${list.map(x => `<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>${metrics.map(([m, f]) => `<tr><td>${m}</td>${list.map(x => `<td class="num">${esc(f(x))}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }
  function saveNamed(name) {
    name = (name || '').trim().slice(0, 60) || `Scenario ${state.saved.length + 1}`;
    const existing = state.saved.find(s => s.name === name);
    const entry = { id: existing ? existing.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, savedAt: new Date().toISOString(), scenario: U.clone(state.current) };
    if (existing) Object.assign(existing, entry); else state.saved.push(entry);
    if (state.saved.length > 30) state.saved.shift();
    persist(); if (state.tab === 'scenarios') renderScenarios();
    toast(`Saved “${name}”.`);
  }
  function scenarioByKey(key) {
    if (key === 'baseline') return baseline(); if (key === 'current') return state.current; if (key === 'optimized') return state.optimized;
    const s = state.saved.find(x => 'saved:' + x.id === key); return s ? s.scenario : null;
  }

  /* ---------------- Sensitivity ---------------- */
  function renderSensitivity() {
    $('tornadoPct').value = String(state.tornadoPct);
    const sk = $('sweepKey');
    if (!sk.options.length) sk.innerHTML = Object.entries(A.SWEEPS).map(([k, v]) => `<option value="${k}">${esc(v.label)} (${esc(v.unit)})</option>`).join('');
    if (!A.SWEEPS[state.sweepKey]) state.sweepKey = 'ssShare';
    sk.value = state.sweepKey;
    if (!res.current.ok) { $('chTornado').innerHTML = `<div class="chart-empty">${esc(res.current.reason)}</div>`; $('chSweepCo2').innerHTML = $('chSweepCost').innerHTML = ''; return; }
    $('chTornado').innerHTML = C.tornado(A.tornado(state.current, state.tornadoPct), { pct: state.tornadoPct });
    const sw = A.sweep(state.current, state.sweepKey, 26);
    const pts = key => sw.points.map(p => ({ x: p.x, y: p[key], ok: p.feasible, note: p.reason }));
    const xd = state.sweepKey === 'gridEF' || state.sweepKey === 'ngGJ' ? 2 : 0;
    $('chSweepCo2').innerHTML = C.line([{ label: 't CO₂e/t', color: '--accent', points: pts('co2') }], { xLabel: `${sw.label} (${sw.unit})`, yLabel: 't CO₂e / t slab', current: sw.current, d: 2, xd });
    $('chSweepCost').innerHTML = C.line([{ label: '₹/t', color: '--c-sky', points: pts('cost').map(p => Object.assign(p, { y: p.y === null ? null : p.y / 1000 })) }], { xLabel: `${sw.label} (${sw.unit})`, yLabel: '₹ thousand / t slab', current: sw.current, d: 1, xd });
  }

  /* ---------------- Method ---------------- */
  let methodDone = false;
  function renderMethod() {
    if (!methodDone) {
      $('boundary').innerHTML = boundarySvg();
      $('methodText').innerHTML = `
        <ol>
          <li><b>Charge solve (auto mode).</b> Unknowns: base-feed mass B and alloy additions u<sub>k</sub> (FeCr, Ni units, FeMo, FeMn). For each aimed element e: r<sub>e</sub>(B·b<sub>e</sub> + Σu<sub>k</sub>v<sub>k,e</sub> + F<sub>e</sub>) = 10·aim<sub>e</sub>; mass closure Σ<sub>metals</sub> r<sub>m</sub>(…) + 10(C<sub>aim</sub>+Si<sub>aim</sub>) = 1000 kg. Solved exactly (Gaussian elimination); an alloy that would be negative is dropped and that element is checked as a residual.</li>
          <li><b>Manual mode.</b> Any charge per heat is converted to 1 t liquid: L = Σ r<sub>m</sub>·m<sub>m</sub> / (1 − C<sub>aim</sub> − Si<sub>aim</sub>), all masses × 1000/L; chemistry is then checked, not forced.</li>
          <li><b>Carbon balance (IPCC mass-balance approach).</b> CO₂ = (C<sub>charge</sub> + 0.83·coke + 0.82·electrode − C<sub>steel</sub>) × 44/12.</li>
          <li><b>Slag &amp; oxygen.</b> Oxidised Si, Cr, Fe, Mn, Ni, Mo → oxides; auto-lime = (basicity × SiO₂ − CaO<sub>dolomite</sub>)/0.92. O₂ from oxidation stoichiometry ÷ utilisation.</li>
          <li><b>Heat balance.</b> E<sub>EAF</sub> = [1000·h<sub>steel</sub> + slag·h<sub>slag</sub> + losses − η<sub>chem</sub>·ΣΔH<sub>ox</sub> − η<sub>burner</sub>·NG] / η<sub>el</sub>; site electricity = E<sub>EAF</sub> + auxiliaries. A metered value can replace the estimate.</li>
          <li><b>Emissions.</b> Every line = activity × factor. Scope 1: process carbon, dolomite, natural gas (CO₂ + CH₄ + N₂O, AR6 GWP100), captive power. Scope 2: grid (location-based) and PPAs (market-based). Scope 3: materials, lime, O₂/Ar electricity.</li>
          <li><b>Reporting.</b> Per tonne slab = per tonne liquid ÷ casting yield. Energy = electricity×0.0036 + natural gas + coke×28.2 GJ/t.</li>
          <li><b>Optimisation.</b> Exhaustive enumeration over the stated grid with every candidate re-solved by the same engine; infeasible points discarded; Pareto frontier on cost and CO₂e.</li>
        </ol>`;
      $('limitsText').innerHTML = `
        <ul>
          <li><b>Not plant data.</b> All operating defaults (shares, energies, recoveries, prices, availability) are synthetic. Nothing represents Jindal Stainless performance.</li>
          <li><b>Screening chemistry.</b> C, Si, Mn, Cr, Ni, Mo and Cu are tracked. N, P, S, Ti, Nb and inclusion control are not modelled.</li>
          <li><b>Aggregate heat balance.</b> One melt-shop balance (EAF + AOD + LRF). Its efficiency and loss terms are calibration parameters and must be fitted to metered data.</li>
          <li><b>Recoveries are inputs</b> rather than predictions from slag thermodynamics. FeSi does not yet change Cr recovery automatically.</li>
          <li><b>Excluded from the boundary:</b> rolling and finishing, refractories, electrode and coke production, transport, capital goods, and by-product credits.</li>
          <li><b>Market-based Scope 2</b> for PPAs assumes valid contractual instruments. Location-based reporting would use the grid factor instead.</li>
          <li><b>Optimiser.</b> Its result is the best point on the stated discrete grid with fixed alloy types and assays, not a guaranteed global optimum or an operating instruction.</li>
          <li><b>Upstream factors</b> marked LCA or Synthetic vary widely by supplier. Use supplier EPDs, as CBAM reporting will need.</li>
        </ul>`;
      methodDone = true;
    }
    const s = state.current;
    $('tblFactors').innerHTML = `<thead><tr><th>Factor</th><th>Current</th><th>Default</th><th>Unit</th><th>Scope</th><th>Status</th><th>Source / note</th></tr></thead><tbody>` +
      Object.entries(CT.FACTORS).map(([k, f]) => {
        const src = f.source && CT.SOURCES[f.source];
        return `<tr><td>${esc(f.label)}</td><td class="num${s.factors[k] !== f.value ? ' changed' : ''}">${fmt(s.factors[k], 3)}</td><td class="num">${fmt(f.value, 3)}</td><td>${esc(f.unit)}</td><td>S${f.scope}</td><td>${statusBadge(f.status)}</td><td class="note">${src ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a><br>` : ''}${esc(f.note)}</td></tr>`;
      }).join('') +
      `<tr><td>Grade chemistry limits</td><td colspan="5">304 / 316 / 430</td><td class="note"><a href="${esc(CT.SOURCES.astm.url)}" target="_blank" rel="noopener noreferrer">${esc(CT.SOURCES.astm.title)}</a></td></tr>
       <tr><td>Carbon contents (coke 0.83, electrode 0.82)</td><td colspan="5">kg C/kg</td><td class="note"><a href="${esc(CT.SOURCES.ipccMetal.url)}" target="_blank" rel="noopener noreferrer">${esc(CT.SOURCES.ipccMetal.title)}</a></td></tr>
       <tr><td>GWP100 CH₄ 27 / N₂O 273</td><td colspan="5">AR6</td><td class="note"><a href="${esc(CT.SOURCES.gwp.url)}" target="_blank" rel="noopener noreferrer">${esc(CT.SOURCES.gwp.title)}</a></td></tr></tbody>`;
  }
  function boundarySvg() {
    const box = (x, y, w, h, t, s, cls) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="bx ${cls || ''}"/><text x="${x + w / 2}" y="${y + h / 2 - (s ? 3 : -4)}" text-anchor="middle" class="bt">${t}</text>${s ? `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" class="bs">${s}</text>` : ''}</g>`;
    const arrow = (x1, y1, x2, y2) => `<path d="M${x1},${y1}L${x2},${y2}" class="arr" marker-end="url(#ah)"/>`;
    return `<svg viewBox="0 0 900 300" class="chart boundary" role="img" aria-label="System boundary diagram">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ah"/></marker></defs>
      <rect x="230" y="20" width="560" height="200" rx="16" class="gate"/><text x="245" y="42" class="bs">CRADLE-TO-GATE MELT SHOP (Scope 1 + 2 in this box)</text>
      ${box(20, 30, 170, 52, 'Scrap &amp; pig iron', 'Scope 3 upstream', 's3')}${box(20, 98, 170, 52, 'Ferroalloys &amp; Ni units', 'Scope 3 upstream', 's3')}
      ${box(20, 166, 170, 52, 'Lime · O₂ · Ar', 'Scope 3 upstream', 's3')}${box(20, 234, 170, 52, 'Grid / PPA electricity', 'Scope 2', 's2')}
      ${box(255, 100, 110, 60, 'EAF', 'melting', '')}${box(395, 100, 110, 60, 'AOD', 'decarburisation', '')}${box(535, 100, 100, 60, 'LRF', 'trim &amp; temp', '')}${box(665, 100, 100, 60, 'CC', 'casting', '')}
      ${box(815, 100, 75, 60, 'Slab', '1 t', 'out')}
      ${arrow(190, 56, 255, 118)}${arrow(190, 124, 255, 130)}${arrow(190, 192, 395, 150)}${arrow(190, 260, 300, 160)}
      ${arrow(365, 130, 395, 130)}${arrow(505, 130, 535, 130)}${arrow(635, 130, 665, 130)}${arrow(765, 130, 815, 130)}
      <text x="255" y="196" class="bs">Scope 1: charge/coke/electrode carbon → CO₂ · dolomite · natural gas · captive coal power</text>
      <text x="255" y="250" class="bs">Excluded: rolling &amp; finishing, refractories, transport, capital goods, by-product credits</text>
    </svg>`;
  }

  /* ---------------- Export / import ---------------- */
  function download(name, type, text) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() {
    const list = scenarioList();
    const data = { schema: 'ctpro-export-1', modelVersion: CT.VERSION, exportedAt: new Date().toISOString(),
      note: 'Inputs are authoritative; results are recalculated on import. Synthetic defaults — not plant data.',
      baselines: state.baselines, current: state.current, optimized: state.optimized, saved: state.saved,
      summary: list.map(x => ({ name: x.name, grade: x.scenario.grade, ok: x.result.ok, co2_t_per_t_slab: x.result.ok ? x.result.kpi.co2 : null,
        cost_inr_per_t_slab: x.result.ok ? x.result.kpi.cost : null, energy_GJ_per_t_slab: x.result.ok ? x.result.kpi.energyGJ : null, feasible: x.result.ok && x.result.feasible })) };
    download('carbontrace-pro-scenarios.json', 'application/json', JSON.stringify(data, null, 2));
  }
  function exportCsv() {
    const list = scenarioList(), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Scenario', 'Grade', 'Mode', 'CO2e t/t slab', 'Scope1', 'Scope2', 'Scope3', 'Energy GJ/t slab', 'Electricity kWh/t slab', 'Cost INR/t slab', 'Recycled %', 'RE %', 'Feasible']];
    for (const x of list) {
      const r = x.result;
      rows.push(r.ok ? [x.name, x.scenario.grade, x.scenario.mode, r.kpi.co2, ...r.emissions.byScopeSlab, r.kpi.energyGJ, r.kpi.elecKwh, r.kpi.cost, r.kpi.recycledPct, r.kpi.rePct, r.feasible] : [x.name, x.scenario.grade, x.scenario.mode, 'n/a: ' + r.reason]);
    }
    rows.push([], ['Current scenario line items (per t liquid)'], ['Source', 'Category', 'Scope', 'Activity', 'Unit', 'Factor', 'Factor unit', 'kg CO2e', 'INR']);
    if (res.current.ok) for (const l of res.current.emissions.lines) rows.push([l.label, l.category, l.scope, l.qty, l.unit, l.factor, l.factorUnit, l.kg, l.cost]);
    // Neutralise spreadsheet formula injection in user-entered names.
    download('carbontrace-pro-comparison.csv', 'text/csv;charset=utf-8', '﻿' + rows.map(r => r.map(v => q(typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v)).join(',')).join('\r\n'));
  }
  async function importJson(file) {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('File larger than 2 MB.');
      const d = JSON.parse(await file.text());
      if (!d || d.schema !== 'ctpro-export-1') throw new Error('Not a CarbonTrace Pro export file.');
      const cur = E.sanitize(d.current); if (E.validate(cur).length) throw new Error('Current scenario in file is invalid: ' + E.validate(cur)[0].msg);
      state.current = cur;
      if (d.baselines) for (const g of Object.keys(state.baselines)) if (d.baselines[g]) state.baselines[g] = E.sanitize(d.baselines[g]);
      state.optimized = d.optimized ? E.sanitize(d.optimized) : null;
      state.saved = Array.isArray(d.saved) ? d.saved.slice(0, 30).filter(x => x && typeof x.name === 'string').map(x => ({ id: String(x.id || Date.now().toString(36)), name: x.name.slice(0, 60), savedAt: String(x.savedAt || ''), scenario: E.sanitize(x.scenario) })) : [];
      lastOpt = null; persist(); render(); toast('Scenarios imported and recalculated from their inputs.');
    } catch (e) { toast('Import rejected: ' + e.message); }
  }

  /* ---------------- Wiring ---------------- */
  function wire() {
    $('inputSections').addEventListener('input', onInput);
    $('inputSections').addEventListener('click', onClick);
    document.querySelectorAll('.grade-switch button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.grade === state.current.grade) return;
      commit(E.setGrade(state.current, b.dataset.grade)); lastOpt = null; selectedPareto = null;
      toast(`Grade ${b.dataset.grade}: aim chemistry and scrap assay updated; baseline for ${b.dataset.grade} loaded.`);
    }));
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; persist(); renderTab(state.tab); }));
    $('emisView').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.emisView = b.dataset.v; persist(); renderDashboard(); });
    $('btnSetBaseline').addEventListener('click', () => {
      if (!res.current.ok) return toast('Cannot set an invalid scenario as baseline.');
      state.baselines[state.current.grade] = U.clone(state.current); persist(); render(); toast(`Baseline for grade ${state.current.grade} frozen from the current inputs.`);
    });
    $('btnResetCurrent').addEventListener('click', () => { commit(U.clone(baseline())); toast('Current scenario reset to the baseline.'); });
    $('btnQuickSave').addEventListener('click', () => saveNamed(''));
    $('btnSaveNamed').addEventListener('click', () => { saveNamed($('scenarioName').value); $('scenarioName').value = ''; });
    $('scenarioName').addEventListener('keydown', e => { if (e.key === 'Enter') { saveNamed($('scenarioName').value); $('scenarioName').value = ''; } });
    $('btnTheme').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme; persist(); });
    $('btnOptimize').addEventListener('click', runOptimizer);
    $('optObjective').addEventListener('change', e => { state.opt.objective = e.target.value; persist(); });
    $('optStep').addEventListener('change', e => { state.opt.step = Number(e.target.value); persist(); });
    $('optCostCap').addEventListener('input', e => { const v = e.target.value.trim(); state.opt.costCapPct = v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v); persist(); });
    for (const [id, k] of [['levCharge', 'charge'], ['levNickel', 'nickel'], ['levPower', 'power']]) $(id).addEventListener('change', e => { state.opt.levers[k] = e.target.checked; persist(); });
    $('optResults').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !lastOpt) return;
      if (b.dataset.apply === 'best') applyScenario(lastOpt.bestScenario, 'Recommended recipe applied to the current scenario.');
      else if (b.dataset.apply === 'rank') applyScenario(lastOpt.ranked[Number(b.dataset.i)].scenario, `Ranked option ${Number(b.dataset.i) + 1} applied.`);
      else if (b.dataset.apply === 'pareto' && selectedPareto !== null) {
        const p = lastOpt.pareto[selectedPareto], n = U.clone(lastOpt.bestScenario);
        n.shares = Object.assign({}, p.shares); n.niCathodeShare = p.ni; n.energy.mix = Object.assign({}, p.mix);
        applyScenario(n, `Pareto option ${selectedPareto + 1} applied.`);
      } else if (b.dataset.goto) { state.tab = b.dataset.goto; state.cmpTarget = 'optimized'; renderTab(state.tab); }
    });
    $('optResults').addEventListener('click', e => { const p = e.target.closest('[data-pareto]'); if (p) { selectedPareto = Number(p.dataset.pareto); renderOptimize(); } });
    $('scenarioCards').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.load) { const s = scenarioByKey(b.dataset.load); if (s) { applyScenario(s, 'Scenario loaded as current; baseline unchanged.'); } }
      else if (b.dataset.baseline) {
        const s = scenarioByKey(b.dataset.baseline); if (!s) return;
        if (!E.calculate(s).ok) return toast('That scenario has no valid result.');
        state.baselines[s.grade] = Object.assign(U.clone(s)); delete state.baselines[s.grade].name; persist(); render(); toast(`Baseline for grade ${s.grade} replaced.`);
      } else if (b.dataset.del) { state.saved = state.saved.filter(x => x.id !== b.dataset.del); persist(); renderScenarios(); toast('Scenario deleted.'); }
    });
    $('cmpTarget').addEventListener('change', e => { state.cmpTarget = e.target.value; persist(); renderScenarios(); });
    $('btnExportJson').addEventListener('click', exportJson);
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('fileImport').addEventListener('change', e => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnResetAll').addEventListener('click', () => {
      if (!confirm('Reset all inputs, baselines, optimised and saved scenarios to the synthetic defaults?')) return;
      const theme = state.theme;
      state.current = CT.defaultScenario('304'); state.baselines = freshBaselines(); state.optimized = null; state.saved = []; state.theme = theme; lastOpt = null;
      persist(); render(); toast('Everything reset to defaults.');
    });
    $('tornadoPct').addEventListener('change', e => { state.tornadoPct = Number(e.target.value); persist(); renderSensitivity(); });
    $('sweepKey').addEventListener('change', e => { state.sweepKey = e.target.value; persist(); renderSensitivity(); });
    // Print: render every tab so the report contains all views.
    window.addEventListener('beforeprint', () => { for (const t of ['dashboard', 'scenarios', 'method']) ({ dashboard: renderDashboard, scenarios: renderScenarios, method: renderMethod })[t](); document.querySelectorAll('.tab').forEach(t => { t.dataset.printShow = ['tab-dashboard', 'tab-scenarios', 'tab-method', 'tab-' + state.tab].includes(t.id) ? '1' : ''; }); });
    window.addEventListener('afterprint', () => renderTab(state.tab));
  }

  load();
  // Deep links for presenting: #optimize, #scenarios, #sensitivity, #method; append "-run" to run the optimiser on open; "light"/"dark" set the theme.
  const hash = location.hash.slice(1).split('-');
  if (['dashboard', 'optimize', 'scenarios', 'sensitivity', 'method'].includes(hash[0])) state.tab = hash[0];
  if (hash.includes('light') || hash.includes('dark')) state.theme = hash.includes('light') ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  $('ver').textContent = 'v' + CT.VERSION;
  buildInputs();
  C.initTooltips();
  wire();
  render();
  if (hash.includes('run')) runOptimizer();
  window.CTApp = { state: () => state, results: () => res, lastOpt: () => lastOpt, render }; // for automated UI tests
})();
