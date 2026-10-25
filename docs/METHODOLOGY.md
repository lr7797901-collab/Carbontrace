# CarbonTrace Pro — Methodology, sources and limitations

## 1. Goal, functional unit and boundary

- **Functional unit:** 1 t of cast stainless slab. Internal balances use 1 t of liquid steel; per-slab values = per-liquid ÷ casting yield.
- **Route:** EAF melting → AOD decarburisation / reduction → LRF trim → continuous casting, treated as one aggregate melt shop.
- **Boundary:** cradle-to-gate.
  - **Scope 1:** carbon from charge, coke and electrodes oxidised to CO₂; raw-dolomite calcination; natural-gas combustion (CO₂ + CH₄ + N₂O); captive coal power.
  - **Scope 2:** grid electricity (location-based CEA factor) and renewable PPAs (market-based).
  - **Scope 3 (upstream purchased goods):** scrap processing, pig iron, ferroalloys and Ni cathode, burnt lime, and electricity for purchased O₂/Ar.
- **Excluded:** rolling, annealing and pickling; refractories; electrode and coke production; transport; capital goods; slag or by-product credits; N, P, S chemistry.

## 2. Charge calculation

Compositions are mass %, with the remainder of a metallic material taken as Fe. Tracked elements are Fe, Cr, Ni, Mo, Mn, Si, C and Cu. `r_e` is the recovery of element e into liquid steel.

**Auto mode (grade-target solver).** The unknowns are the base-feed mass `B` (split by the chosen SS / CS / pig shares) and alloy additions `u_k` (FeCr, Ni units, FeMo, FeMn). The Ni units are a FeNi/cathode blend set by the Ni-source slider.

```
for each aimed element e:   r_e · (B·b_e + Σ_k u_k·v_k,e + F_e) = 10 · aim_e          [kg per t liquid]
mass closure:               Σ_metals r_m · (B·b_m + Σ_k u_k·v_k,m + F_m) + 10·(aimC + aimSi) = 1000
```

- `b` = base-blend composition, `v_k` = alloy composition per unit, `F` = fixed FeSi contribution.
- The system is solved exactly by Gaussian elimination.
- If an alloy solves negative, the base feed already exceeds the aim for that element. The alloy is removed and the element is checked against the specification as a residual.

**Manual mode.** The user enters any charge in kg per heat. Liquid output is
`L = Σ r_m·m_m / (1 − aimC − aimSi)` (Si is capped by the Si actually charged). All masses are scaled by 1000/L, and chemistry is *reported and checked*, not forced.

## 3. Element, carbon, slag and oxygen balances

- **Carbon** (IPCC 2006 Vol.3 Ch.4 mass-balance approach, carbon contents from Table 4.3: coke 0.83, EAF electrodes 0.82 kg C/kg):
  `CO₂ = (C_charge + 0.83·coke + 0.82·electrode − C_steel) × 44.01/12.011`.
  Final C is the grade aim. If less carbon is charged than the aim, a warning appears.
- **Silicon:** charged Si minus final Si is oxidised to SiO₂ (no CO₂).
- **Slag:**
  - Oxides from losses: SiO₂, Cr₂O₃, FeO, MnO, NiO, MoO₃.
  - Dolomite residue: 52.3% of its mass. Its CaO (30.4%) counts toward basicity.
  - Auto-lime: `lime = max(0, B₂·SiO₂ − CaO_dolomite) / 0.92`.
- **Oxygen:** stoichiometric O₂ for C → CO (plus the post-combustion fraction to CO₂), Si → SiO₂, Fe → FeO, Cr → Cr₂O₃ and Mn → MnO, divided by O₂ utilisation, at 22.414 Nm³/kmol.

## 4. Heat balance and energy

```
demand  = 1000·h_steel + slag·h_slag + thermal losses                      [kWh/t liquid]
credits = η_chem·Σ(ΔH_ox,i · m_ox,i)/3.6  +  η_burner·NG·1000/3.6
E_EAF   = max(0, demand − credits) / η_el          (or a metered value)
E_site  = E_EAF + auxiliary electricity (LRF, caster, fume, utilities)
```

- Oxidation enthalpies, in MJ per kg of element: C → CO 9.20, C → CO₂ 32.76, Si 32.4, Fe → FeO 4.87, Cr → Cr₂O₃ 10.96, Mn → MnO 7.01.
- `h_steel` ≈ 0.386 kWh/kg (≈1.39 GJ/t); `h_slag` ≈ 0.53 kWh/kg.
- `η_el`, `η_chem` and the losses are **calibration parameters**. Fit them to metered heats.
- Site energy = electricity × 0.0036 GJ/kWh + natural gas + coke × 28.2 GJ/t (IPCC coke NCV).

## 5. Emission factors (defaults)

| Factor | Value | Status | Source |
|---|---:|---|---|
| Grid electricity, India | 0.727 kg CO₂/kWh | Public | CEA CO₂ Baseline Database v20 (FY2023-24) weighted average. Value as reported in public listings; confirm against the CEA appendix. |
| Solar / wind PPA | 0 | Public method | GHG Protocol Scope 2, market-based with contractual instruments |
| Coal combustion | 94.6 kg CO₂/GJ | Verified | IPCC 2006 Vol.2 Table 2.2. Captive EF = 94.6 × heat rate (10.5 GJ/MWh → 0.993 kg/kWh) |
| Natural gas | 56.1 kg CO₂/GJ + CH₄ 1 g/GJ + N₂O 0.1 g/GJ | Verified | IPCC 2006 Vol.2 Tables 2.2–2.3; GWP100 AR6 (27 / 273) |
| Dolomite calcination | 0.477 kg CO₂/kg | Verified | Stoichiometry (IPCC 2006 Vol.3 Ch.2) |
| Burnt lime (upstream) | 0.75 kg CO₂/kg | Public | IPCC Tier 1 high-calcium lime (process only) |
| HC FeCr (60% Cr) | 6.0 kg CO₂e/kg | Industry LCA | ICDA 2021 average ≈10 kg/kg Cr (as cited by Outokumpu) × 0.60 |
| FeNi (25% Ni) | 11.25 kg CO₂e/kg | Industry LCA | Nickel Institute ≈45 kg/kg Ni (2017 data) × 0.25 |
| Ni cathode (Class 1) | 13.0 kg CO₂e/kg | Industry LCA | Nickel Institute Class 1 average ≈13 kg/kg Ni (as cited by Vale 2021) |
| FeMo | 8.0 kg CO₂e/kg | Industry LCA | Mid-range of 3.2–14.8 (J. Sustain. Metall. 2019) |
| Pig iron | 1.9 kg CO₂e/kg | Synthetic | Indicative BF route; replace with supplier EPD |
| SS / CS scrap | 0.05 / 0.03 | Synthetic | Cut-off approach (processing only) |
| FeMn, FeSi | 2.0 / 6.0 | Synthetic | Placeholders |
| O₂/Ar production | 0.45 kWh/Nm³ × grid EF | Synthetic | Illustrative ASU energy |

Grade limits follow ASTM A240-type values for 304 (Cr 17.5–19.5, Ni 8.0–10.5), 316 (Cr 16–18, Ni 10–14, Mo 2–3) and 430 (Cr 16–18, Ni ≤ 0.75). C, Mn and Si maxima per grade are in `src/data/materials.js`. Verify against the current edition of the standard.

Prices, availability caps, recoveries, energy parameters and the default charge mix are synthetic.

## 6. Optimisation

- **Design space:** base-feed shares on a declared grid × Ni-source options {0, 25, 50, 75, 100% cathode} × electricity-mix options.
  - Electricity options use RE levels 0, 10, … up to the RE cap.
  - RE is split all-solar, all-wind, or at the current ratio.
  - The non-RE remainder is all-grid, captive at its cap, or the current captive ratio.
- **Evaluation:** every point runs the full engine. Alloys are re-solved, so energy, slag, O₂ and carbon all respond.
- **Feasibility:** a point must pass chemistry, Cu, availability caps, charge carbon, RE and captive limits, and the optional cost ceiling (relative to the frozen baseline).
- **Objectives:** CO₂e, cost, or cost + CO₂e × internal carbon price, with deterministic tie-breaks.
- **Outputs:** the best point, ranked alternatives, the Pareto frontier on (cost, CO₂e), and a sequential lever attribution (charge → nickel → power).
- **Verification:** an automated test brute-forces the same space with the full engine and confirms the optimiser returns the true minimum. It is a discrete-grid optimum, not a continuous global one.

## 7. Limitations

1. **Synthetic defaults.** Calibrate with plant meter, lab-assay and supplier-EPD data before any reporting, CBAM declaration or operational decision.
2. **Screening chemistry only.** N, P, S, Ti, Nb, inclusions and mechanical properties are not modelled. Cu is an operational cap.
3. **Aggregate heat balance.** It does not simulate the time-resolved EAF or AOD process, temperatures or refractory wear.
4. **Recoveries are inputs**, not thermodynamic predictions. FeSi additions do not automatically change Cr recovery.
5. **Upstream factors are highly supplier-specific.** Literature averages can differ substantially from a given supplier.
6. **The Ni-cathode lever** depends on availability, price and the Ni-carbon data used. Treat it as a procurement scenario to verify.
7. **Market-based Scope 2** assumes valid contractual instruments.

## 8. Verification performed

- 19 engine tests (`node --test tests/engine.test.js`), covering:
  - mass and carbon balance closure;
  - line items reconciling to scope, category and KPI totals;
  - activity × factor = emissions for every line;
  - aim chemistry for all grades;
  - scope assignment of captive vs grid;
  - manual-mode scale invariance;
  - validation and sanitising;
  - constraint flags;
  - optimiser vs brute force, cost ceiling and Pareto ordering;
  - sensitivity, waterfall and attribution identities.
- 20 in-browser UI checks (`tests/ui-smoke.html`) driving the real controls.
- No horizontal overflow at 375 px on any tab. The app loads from `file://` and from a local server.
