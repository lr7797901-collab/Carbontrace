# CarbonTrace Pro

**PS3 — Carbon and Energy Calculator for Steelmaking.** A grade-aware stainless melt-shop calculator (EAF → AOD → LRF → CC). It estimates CO₂e and energy per tonne of cast slab from the charge mix and energy sources, and finds lower-emission recipes that stay within metallurgical and operational limits.

> All operating defaults are **synthetic and illustrative**. No value is Jindal Stainless plant data. Emission factors carry a status: Verified constant / Public reference / Industry LCA / Synthetic. Each has its source in the app (*Method & data* tab).

## Start (no install, no build)

Option A — double-click `start.bat`. It serves the folder with Python and opens the browser. If Python is missing, it opens `index.html` directly.

Option B — run it yourself:

```powershell
cd C:\Users\sachi\OneDrive\Desktop\laxi\CarbonTrace_Pro
python -m http.server 8090 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8090/>.

Option C — open `index.html` directly in Chrome or Edge. Everything works offline; there are no CDN dependencies.

Presentation deep links: `#optimize`, `#scenarios`, `#sensitivity`, `#method`. Add `-run` to run the optimiser on open, and `-light` or `-dark` to set the theme. Example: `http://127.0.0.1:8090/#optimize-run-light`.

## Tests

```powershell
node --test tests/engine.test.js        # 19 engine tests (Node 18+)
```

UI test: with the server running, open <http://127.0.0.1:8090/tests/ui-smoke.html>. It drives the real interface (20 checks: all 94 numeric inputs, sliders, validation, manual mode, grades, optimiser, scenarios, sensitivity, charts).

## Architecture

```
CarbonTrace_Pro/
├── index.html                 UI shell (no framework, classic scripts → works from file://)
├── css/app.css                Dark/light industrial theme, responsive, print report
├── src/data/                  CONFIGURATION — no logic
│   ├── factors.js             Emission factors + status + sources, physical constants
│   ├── materials.js           Materials, assays, grade specs (304/316/430), aim chemistry
│   └── defaults.js            Default scenario, prices, input schema (drives validation & UI)
├── src/engine/                PURE CALCULATION — no DOM, runs in browser and Node
│   ├── model.js               validate → charge solve → element/C/slag/O₂ balance → heat balance → emissions/cost → constraints
│   ├── optimizer.js           Exhaustive constrained search + Pareto frontier
│   └── analysis.js            Tornado sensitivity, sweeps, waterfall, lever attribution
├── src/ui/
│   ├── charts.js              Dependency-free SVG charts with tooltips
│   └── app.js                 State, scenarios, persistence, rendering, import/export
├── tests/engine.test.js       Node test suite;  tests/ui-smoke.html  in-browser UI test
└── docs/                      METHODOLOGY.md, DEMO_SCRIPT.md, screenshots/
```

The UI has no emission equations of its own. Every number shown comes from `CT.engine.calculate()`, and the optimiser, sensitivity and charts all call the same function.

## Features

- **Grade-aware charge solver (auto mode).** You choose the base-feed mix (SS scrap / CS scrap / pig iron) and the Ni source split. A linear element-balance system then solves FeCr, Ni units, FeMo and FeMn exactly to the 304 / 316 / 430 aim chemistry. Alloys that would be negative are dropped and the element is checked as a residual.
- **Manual charge sheet.** Edit any material in kg per heat. The engine normalises to 1 t liquid and checks the chemistry rather than forcing it.
- **Physically linked balances.** Element recoveries, an IPCC mass-balance carbon balance, slag oxides with auto-lime to a basicity target, O₂ demand from stoichiometry, and a melt-shop heat balance in which electricity responds to the charge (or a metered override).
- **Energy sources.** Grid (CEA), captive coal (EF from IPCC coal factor × heat rate, Scope 1), solar and wind PPAs (market-based), plus natural gas, coke and electrodes.
- **Constraints.** Grade chemistry limits, residual Cu, availability caps per material, maximum charge carbon (decarburisation), maximum renewable share and maximum captive share. An optional cost-increase ceiling applies in the optimiser.
- **Optimisation.** Enumerates base-feed shares (10 / 5 / 2.5 / 1-point grid) × Ni source × electricity-mix options. It re-solves alloys at every point and discards infeasible points. The output is the best recipe, the top 10 alternatives, the cost–CO₂e Pareto frontier (clickable) and a per-lever attribution waterfall. Objectives are minimum CO₂e, minimum cost, or cost including an internal carbon price.
- **Scenarios.** Frozen baseline per grade, live current, optimised, and up to 30 saved scenarios. Save, load, set-as-baseline, reset and delete; compare by chart, waterfall and table; export JSON/CSV and import JSON (inputs re-validated, results recalculated); print report. Persists in browser storage.
- **Charts.** Emissions by source or scope, charge composition, chemistry vs spec bands, energy-balance waterfall, electricity by source, baseline vs current, before/after waterfall, tornado sensitivity, parameter sweeps (CO₂e and cost, with infeasible points marked), and the Pareto scatter.

## Reference results (synthetic defaults, grade 304)

| Case | t CO₂e / t slab | Variable cost ₹/t | Notes |
|---|---:|---:|---|
| Baseline (60/20/20 SS/CS/pig, FeNi, 60% grid / 40% captive) | 4.551 | 1,66,488 | feasible |
| Optimised, no cost increase allowed | 2.241 (−50.8%) | 1,65,968 | 85/15/0, FeNi kept, 40% solar, no captive |
| Optimised, CO₂e objective, all levers | 1.365 (−70.0%) | 1,74,204 (+4.6%) | 80/20/0, 100% Ni cathode, 40% solar; ≈ ₹2,422 per t CO₂e abated |
| Minimum-cost objective | 5.481 (+20.4%) | 1,64,086 | shows the cost-only trade-off |

These are model outputs from synthetic inputs, not measured savings. They show how the levers compare, not what a plant achieves.

See [docs/METHODOLOGY.md](docs/METHODOLOGY.md) for formulas, sources, boundary and limitations, and [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for the 3-minute jury demo.
