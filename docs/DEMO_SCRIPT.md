# 3-minute jury demo — CarbonTrace Pro

**Before the jury:** double-click `start.bat`, or open <http://127.0.0.1:8090/>. Go to *Scenarios → Reset everything* so the numbers match this script. Use full-screen (F11). The theme button (◐) switches to light mode for a bright projector.

All values below are reproducible from the synthetic defaults (grade 304).

| Time | Do | Say (key numbers) |
|---|---|---|
| 0:00–0:25 | Point at the KPI strip and the boundary card (*Method & data*). | "Cradle-to-gate stainless melt shop, EAF → AOD → LRF → CC, per tonne of cast slab. Baseline 304: **4.551 t CO₂e/t**, 571 kWh/t, ₹1.66 lakh/t. Every factor is tagged Verified, Public, LCA or Synthetic and has a source. No Jindal plant data is invented." |
| 0:25–0:55 | *Dashboard.* Show the donut, then the charge table. | "Ferroalloys are **80%** of the footprint: about 200 kg FeCr and 200 kg FeNi per tonne. The solver calculates these exactly to hit the 304 aim of 18.1% Cr and 8.05% Ni. The chemistry card shows every element inside its ASTM band." |
| 0:55–1:25 | Drag **Stainless-steel scrap** 60 → **75%**. Then set **Solar PPA** to **30%**. | "More grade scrap brings its own Cr and Ni, so the alloys fall: **3.501**. Electricity responds too, because the heat balance is charge-driven. 30% solar gives **3.353**, about −26% vs baseline. The waterfall shows where the change comes from." |
| 1:25–1:40 | Drag **Pig iron** to **45%**. | "Practicality: the charge-carbon limit trips (2.71% > 2%), and the status bar and KPI turn red. The tool never hides a constraint." Then click **Reset to baseline**. |
| 1:40–2:20 | *Optimizer.* Set **Max cost increase = 0**, then **Run**. Clear the field and **Run** again. | "31,185 recipes in about 0.15 s, each re-solved for chemistry. With **zero** cost increase: **2.241 t/t (−50.8%) and ₹519/t cheaper**, a no-regret recipe (85/15/0 scrap mix, 40% solar, no captive coal). With all levers, including switching to nickel cathode: **1.365 t/t (−70%)** at +4.6% cost, about **₹2,422 per tonne CO₂e** abated, or **9.56 lakh t CO₂e/yr** at 3 lakh t/yr. Click a green Pareto point to see the full cost–carbon trade-off. The lever chart splits the gain: scrap −1.62, nickel source −1.33, power −0.24." |
| 2:20–2:40 | **Apply to current**, then *Scenarios*. | "Baseline, current and optimised are independent snapshots. Save, compare, export CSV/JSON, and print a report." |
| 2:40–3:00 | *Sensitivity.* | "The tornado ranks the assumptions: scrap share, Fe recovery, and the FeNi and FeCr factors dominate. Supplier EPDs for alloys are the most valuable data to collect next. Grid factor and energy efficiency matter less. Red points in the sweep are physically computed but infeasible." |

**Backup questions**

- *Is the optimiser real?* Yes. Exhaustive enumeration of a declared grid, every point solved by the same engine. A unit test brute-forces the space and confirms the optimum (`node --test tests/engine.test.js`).
- *Why 70%?* Mainly scrap (alloy units already in the scrap) and lower-carbon nickel units, using Nickel Institute averages (FeNi ≈45 vs Class 1 ≈13 kg CO₂e/kg Ni). These are literature averages; supplier data may differ.
- *Plant data?* None is used. Replace the synthetic inputs and calibrate the heat balance with metered heats (*Process & heat balance* section, or switch EAF electricity to *Metered*).
- *Cost-only objective?* It picks a dirtier recipe (5.48 t/t, +20%) that saves ₹2,402/t. That is why the tool offers cost + internal carbon price as an objective.
