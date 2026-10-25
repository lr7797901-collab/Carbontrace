/* CarbonTrace Pro — dependency-free SVG charts with hover tooltips.
 * Colours come from CSS custom properties so light/dark themes both work.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n)) ? '—'
    : n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const col = c => c && c.startsWith('--') ? `var(${c})` : c;
  const tip = t => ` data-tip="${esc(t)}"`;

  function niceTicks(min, max, count) {
    if (max - min < 1e-12) { max = min + 1; }
    const span = max - min, step0 = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { lo, hi, ticks, step };
  }
  const empty = msg => `<div class="chart-empty">${esc(msg)}</div>`;

  // Donut with centre label. items: [{label, value, color}]
  function donut(items, opt) {
    opt = opt || {};
    const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
    if (!(total > 0)) return empty('No positive values to chart.');
    const R = 70, r = 46, cx = 90, cy = 90; let a0 = -Math.PI / 2, paths = '';
    for (const it of items) {
      const v = Math.max(0, it.value); if (v <= 0) continue;
      const frac = v / total, a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
      const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      const d = frac >= 0.9999
        ? `M${cx - R},${cy}A${R},${R} 0 1 1 ${cx + R},${cy}A${R},${R} 0 1 1 ${cx - R},${cy}M${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}Z`
        : `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
      paths += `<path d="${d}" style="fill:${col(it.color)}" class="seg"${tip(`${it.label}: ${fmt(it.value, opt.d ?? 3)} ${opt.unit || ''} (${fmt(frac * 100, 1)}%)`)}/>`;
      a0 = a1;
    }
    const legend = items.filter(i => i.value > 0).map(i => `<li${tip(`${i.label}: ${fmt(i.value, opt.d ?? 3)} ${opt.unit || ''}`)}><i style="background:${col(i.color)}"></i><span>${esc(i.label)}</span><b>${fmt(i.value, opt.d ?? 3)}</b><em>${fmt(i.value / total * 100, 1)}%</em></li>`).join('');
    return `<div class="donut-wrap"><svg viewBox="0 0 180 180" class="donut" role="img" aria-label="${esc(opt.aria || 'Breakdown')}">${paths}
      <text x="90" y="86" text-anchor="middle" class="donut-v">${esc(opt.center || fmt(total, 2))}</text>
      <text x="90" y="106" text-anchor="middle" class="donut-u">${esc(opt.centerUnit || '')}</text></svg><ul class="legend">${legend}</ul></div>`;
  }

  // Single horizontal stacked bar. items: [{label, value, color}]
  function stackBar(items, opt) {
    opt = opt || {};
    const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
    if (!(total > 0)) return empty('No values.');
    let x = 0;
    const segs = items.filter(i => i.value > 0).map(i => {
      const w = i.value / total * 100, s = `<div class="sb-seg" style="width:${w}%;background:${col(i.color)}"${tip(`${i.label}: ${fmt(i.value, opt.d ?? 1)} ${opt.unit || ''} (${fmt(w, 1)}%)`)}>${w > 9 ? `<span>${esc(i.short || i.label)}</span>` : ''}</div>`;
      x += w; return s;
    }).join('');
    return `<div class="stackbar">${segs}</div>`;
  }

  // Vertical stacked columns. cols: [{label, sub, segments:[{label,value,color}], total?}]
  function columns(cols, opt) {
    opt = opt || {};
    if (!cols.length) return empty('Nothing to compare yet.');
    const W = 640, H = 280, L = 52, B = 46, T = 18, Rr = 12;
    const max = Math.max(...cols.map(c => c.segments.reduce((a, s) => a + Math.max(0, s.value), 0)), 1e-9);
    const { hi, ticks } = niceTicks(0, max, 5);
    const bw = Math.min(70, (W - L - Rr) / cols.length * 0.55), gap = (W - L - Rr) / cols.length;
    const yv = v => T + (H - T - B) * (1 - v / hi);
    let g = ticks.map(t => `<line x1="${L}" x2="${W - Rr}" y1="${yv(t)}" y2="${yv(t)}" class="grid"/><text x="${L - 8}" y="${yv(t) + 4}" text-anchor="end" class="ax">${fmt(t, opt.td ?? 1)}</text>`).join('');
    cols.forEach((c, i) => {
      const x = L + gap * i + (gap - bw) / 2; let acc = 0;
      for (const s of c.segments) {
        const v = Math.max(0, s.value); if (v <= 0) continue;
        const y1 = yv(acc + v), h = yv(acc) - y1;
        g += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0.5, h)}" rx="2" style="fill:${col(s.color)}"${tip(`${c.label} · ${s.label}: ${fmt(v, 3)} ${opt.unit || ''}`)}/>`;
        acc += v;
      }
      g += `<text x="${x + bw / 2}" y="${yv(acc) - 6}" text-anchor="middle" class="val">${fmt(acc, opt.d ?? 2)}</text>`;
      g += `<text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle" class="lbl">${esc(c.label)}</text>`;
      if (c.sub) g += `<text x="${x + bw / 2}" y="${H - B + 30}" text-anchor="middle" class="ax">${esc(c.sub)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opt.aria || 'Comparison')}">${g}<text x="${L}" y="11" class="ax">${esc(opt.unit || '')}</text></svg>`;
  }

  // Waterfall: start bar, signed steps, end bar.
  function waterfall(w, opt) {
    opt = opt || {};
    if (!w) return empty('Comparison unavailable.');
    const steps = w.steps.filter(s => Math.abs(s.delta) > 1e-6);
    const bars = [{ label: opt.startLabel || 'Start', v0: 0, v1: w.start, kind: 'total' }];
    let run = w.start;
    for (const s of steps) { bars.push({ label: s.label || s.category, v0: run, v1: run + s.delta, kind: s.delta < 0 ? 'down' : 'up', delta: s.delta }); run += s.delta; }
    bars.push({ label: opt.endLabel || 'End', v0: 0, v1: w.end, kind: 'total' });
    const W = 640, H = 300, L = 52, B = 70, T = 16, R = 10;
    const max = Math.max(...bars.map(b => Math.max(b.v0, b.v1)), 1e-9), min = Math.min(0, ...bars.map(b => Math.min(b.v0, b.v1)));
    const { lo, hi, ticks } = niceTicks(min, max, 5);
    const yv = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const gap = (W - L - R) / bars.length, bw = Math.min(56, gap * 0.62);
    let g = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${yv(t)}" y2="${yv(t)}" class="grid"/><text x="${L - 8}" y="${yv(t) + 4}" text-anchor="end" class="ax">${fmt(t, 1)}</text>`).join('');
    bars.forEach((b, i) => {
      const x = L + gap * i + (gap - bw) / 2, y = yv(Math.max(b.v0, b.v1)), h = Math.max(1, Math.abs(yv(b.v0) - yv(b.v1)));
      const color = b.kind === 'total' ? 'var(--c-slate)' : b.kind === 'down' ? 'var(--good)' : 'var(--bad)';
      const dd = opt.d ?? 3, label = b.kind === 'total' ? fmt(b.v1, dd) : (b.delta > 0 ? '+' : '') + fmt(b.delta, dd);
      g += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" style="fill:${color}"${tip(`${b.label}: ${label} ${opt.unit || ''}`)}/>`;
      g += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="val">${label}</text>`;
      if (i < bars.length - 1) { const yn = yv(b.kind === 'total' ? b.v1 : b.v1); g += `<line x1="${x + bw}" x2="${x + gap}" y1="${yn}" y2="${yn}" class="conn"/>`; }
      const words = String(b.label).split(' '), lines = [];
      for (const wd of words) { if (lines.length && (lines[lines.length - 1] + ' ' + wd).length <= 13) lines[lines.length - 1] += ' ' + wd; else lines.push(wd); }
      lines.slice(0, 3).forEach((ln, k) => { g += `<text x="${x + bw / 2}" y="${H - B + 16 + k * 13}" text-anchor="middle" class="lbl sm">${esc(ln)}</text>`; });
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Waterfall">${g}<text x="${L}" y="10" class="ax">${esc(opt.unit || '')}</text></svg>`;
  }

  // Tornado chart of CO2e swings around the base value.
  function tornado(t, opt) {
    opt = opt || {};
    if (!t || !t.ok || !t.rows.length) return empty('No sensitivity rows.');
    const rows = t.rows, W = 640, rowH = 26, T = 26, L = 190, R = 70, H = T + rows.length * rowH + 24;
    const ext = Math.max(...rows.map(r => Math.max(Math.abs(r.dLow), Math.abs(r.dHigh))), 1e-9);
    const cx = L + (W - L - R) / 2, sc = (W - L - R) / 2 / ext;
    let g = `<line x1="${cx}" x2="${cx}" y1="${T - 8}" y2="${H - 18}" class="axis"/>`;
    g += `<text x="${cx}" y="${T - 12}" text-anchor="middle" class="ax">base ${fmt(t.base, 3)} t CO₂e/t</text>`;
    rows.forEach((r, i) => {
      const y = T + i * rowH + 4, bar = (d, cls, label, val, feas) => {
        const x = d < 0 ? cx + d * sc : cx, w = Math.max(1, Math.abs(d) * sc);
        return `<rect x="${x}" y="${y}" width="${w}" height="${rowH - 9}" rx="2" class="${cls}${feas ? '' : ' infeasible'}"${tip(`${r.label} at ${label} ${fmt(val, 3)}: ${d >= 0 ? '+' : ''}${fmt(d, 3)} t CO₂e/t${feas ? '' : ' (violates a constraint)'}`)}/>`;
      };
      g += bar(r.dLow, 'tlo', 'low', r.low, r.feasibleLow) + bar(r.dHigh, 'thi', 'high', r.high, r.feasibleHigh);
      g += `<text x="${L - 10}" y="${y + 13}" text-anchor="end" class="lbl">${esc(r.label)}</text>`;
      g += `<text x="${W - R + 6}" y="${y + 13}" class="ax">±${fmt(r.swing / 2, 3)}</text>`;
    });
    g += `<g class="ax"><rect x="${L}" y="${H - 14}" width="10" height="10" class="tlo"/><text x="${L + 14}" y="${H - 5}">parameter −${opt.pct || ''}${opt.pct ? '%' : ''}</text><rect x="${L + 130}" y="${H - 14}" width="10" height="10" class="thi"/><text x="${L + 144}" y="${H - 5}">parameter +${opt.pct || ''}${opt.pct ? '%' : ''}</text></g>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Tornado sensitivity">${g}</svg>`;
  }

  // Line chart. series: [{label, color, points:[{x,y,ok,note}]}]; opt: {xLabel, yLabel, current, d}
  function line(series, opt) {
    opt = opt || {};
    const all = series.flatMap(s => s.points.filter(p => p.y !== null && Number.isFinite(p.y)));
    if (!all.length) return empty('No valid points in this sweep.');
    const W = 640, H = 260, L = 60, R = 16, T = 16, B = 42;
    const xs = series[0].points.map(p => p.x), xmin = Math.min(...xs), xmax = Math.max(...xs);
    const ymin0 = Math.min(...all.map(p => p.y)), ymax0 = Math.max(...all.map(p => p.y)), pad = (ymax0 - ymin0) * 0.08 || Math.abs(ymax0) * 0.05 || 1;
    const yt = niceTicks(ymin0 - pad, ymax0 + pad, 5), xt = niceTicks(xmin, xmax, 6);
    const xv = x => L + (W - L - R) * (x - xmin) / ((xmax - xmin) || 1), yv = y => T + (H - T - B) * (1 - (y - yt.lo) / (yt.hi - yt.lo));
    let g = yt.ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${yv(t)}" y2="${yv(t)}" class="grid"/><text x="${L - 8}" y="${yv(t) + 4}" text-anchor="end" class="ax">${fmt(t, opt.d ?? 2)}</text>`).join('');
    g += xt.ticks.filter(t => t >= xmin - 1e-9 && t <= xmax + 1e-9).map(t => `<text x="${xv(t)}" y="${H - B + 16}" text-anchor="middle" class="ax">${fmt(t, opt.xd ?? 0)}</text>`).join('');
    if (opt.current !== undefined) g += `<line x1="${xv(opt.current)}" x2="${xv(opt.current)}" y1="${T}" y2="${H - B}" class="cur"/><text x="${xv(opt.current) + 4}" y="${T + 10}" class="ax">current</text>`;
    for (const s of series) {
      let d = '', pen = false;
      for (const p of s.points) { if (p.y === null || !Number.isFinite(p.y)) { pen = false; continue; } d += (pen ? 'L' : 'M') + xv(p.x).toFixed(1) + ',' + yv(p.y).toFixed(1); pen = true; }
      g += `<path d="${d}" fill="none" style="stroke:${col(s.color)}" stroke-width="2.2"/>`;
      g += s.points.filter(p => p.y !== null && Number.isFinite(p.y)).map(p => `<circle cx="${xv(p.x)}" cy="${yv(p.y)}" r="${p.ok ? 3.2 : 3.6}" class="${p.ok ? 'pt' : 'pt bad'}" style="${p.ok ? `fill:${col(s.color)}` : ''}"${tip(`${opt.xLabel || 'x'} ${fmt(p.x, opt.xd ?? 1)}: ${s.label} ${fmt(p.y, opt.d ?? 3)}${p.ok ? '' : ' · ' + (p.note || 'infeasible')}`)}/>`).join('');
    }
    g += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="lbl">${esc(opt.xLabel || '')}</text><text x="${L}" y="10" class="ax">${esc(opt.yLabel || '')}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opt.yLabel || 'Line chart')}">${g}</svg>`;
  }

  // Cost–CO2 scatter with Pareto frontier. points: [{cost, co2, idx}]
  function scatter(o, opt) {
    opt = opt || {};
    if (!o || !o.points.length) return empty('Run the optimiser to see feasible combinations.');
    const pts = o.points.concat(opt.extra || []), W = 640, H = 320, L = 66, R = 16, T = 16, B = 44;
    const xt = niceTicks(Math.min(...pts.map(p => p.cost)), Math.max(...pts.map(p => p.cost)), 5);
    const yt = niceTicks(Math.min(...pts.map(p => p.co2)), Math.max(...pts.map(p => p.co2)), 5);
    const xv = x => L + (W - L - R) * (x - xt.lo) / ((xt.hi - xt.lo) || 1), yv = y => T + (H - T - B) * (1 - (y - yt.lo) / ((yt.hi - yt.lo) || 1));
    let g = yt.ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${yv(t)}" y2="${yv(t)}" class="grid"/><text x="${L - 8}" y="${yv(t) + 4}" text-anchor="end" class="ax">${fmt(t, 2)}</text>`).join('');
    g += xt.ticks.map(t => `<text x="${xv(t)}" y="${H - B + 16}" text-anchor="middle" class="ax">${fmt(t / 1000, 0)}k</text>`).join('');
    g += o.points.map(p => `<circle cx="${xv(p.cost).toFixed(1)}" cy="${yv(p.co2).toFixed(1)}" r="2.2" class="sc-pt"/>`).join('');
    const pd = o.pareto.map((p, i) => (i ? 'L' : 'M') + xv(p.cost).toFixed(1) + ',' + yv(p.co2).toFixed(1)).join('');
    g += `<path d="${pd}" class="pareto"/>`;
    g += o.pareto.map((p, i) => `<circle cx="${xv(p.cost)}" cy="${yv(p.co2)}" r="5" class="pareto-pt" data-pareto="${i}"${tip(`Pareto option ${i + 1}: ${fmt(p.co2, 3)} t CO₂e/t · ₹${fmt(p.cost, 0)}/t · SS ${fmt(p.shares.ssScrap, 1)}% / CS ${fmt(p.shares.csScrap, 1)}% / pig ${fmt(p.shares.pigIron, 1)}% · Ni cathode ${p.ni}% · RE ${fmt(p.re, 0)}% — click to inspect`)}/>`).join('');
    const placed = [];
    for (const m of (opt.markers || [])) {
      const mx = xv(m.cost), my = yv(m.co2); let ly = my + 4;
      while (placed.some(p => Math.abs(p.x - mx) < 90 && Math.abs(p.y - ly) < 14)) ly += 15;
      placed.push({ x: mx, y: ly });
      g += `<g${tip(`${m.label}: ${fmt(m.co2, 3)} t CO₂e/t · ₹${fmt(m.cost, 0)}/t`)}><circle cx="${mx}" cy="${my}" r="8" class="mk ${m.cls}"/><text x="${mx + 11}" y="${ly}" class="lbl">${esc(m.label)}</text></g>`;
    }
    g += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="lbl">Variable cost · ₹ per t slab</text><text x="${L}" y="10" class="ax">t CO₂e / t slab</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Cost versus CO2e trade-off">${g}</svg>`;
  }

  // Tooltip controller (one per page).
  function initTooltips() {
    const box = document.getElementById('tooltip');
    if (!box) return;
    let cur = null;
    document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if (t) { cur = t; box.textContent = t.getAttribute('data-tip'); box.hidden = false; } });
    document.addEventListener('mousemove', e => {
      if (!cur) return;
      const pad = 14, w = box.offsetWidth, h = box.offsetHeight;
      let x = e.clientX + pad, y = e.clientY + pad;
      if (x + w > innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > innerHeight - 8) y = e.clientY - h - pad;
      box.style.transform = `translate(${x}px,${y}px)`;
    });
    document.addEventListener('mouseout', e => { if (cur && !cur.contains(e.relatedTarget)) { cur = null; box.hidden = true; } });
  }

  CT.charts = { donut, stackBar, columns, waterfall, tornado, line, scatter, initTooltips, esc, fmt, niceTicks };
})(typeof globalThis !== 'undefined' ? globalThis : this);
