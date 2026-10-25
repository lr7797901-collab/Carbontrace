/* CarbonTrace Pro — default scenario and input schema.
 * The schema drives both input validation (engine) and control generation (UI).
 * Defaults are a SYNTHETIC illustrative stainless melt shop (EAF → AOD → LRF → CC),
 * not Jindal Stainless operating data.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};

  const PRICES = {
    price_ssScrap: ['Stainless scrap', 150, 'INR/kg'], price_csScrap: ['Carbon-steel scrap', 36, 'INR/kg'],
    price_pigIron: ['Pig iron', 42, 'INR/kg'], price_feCr: ['HC FeCr', 125, 'INR/kg'],
    price_feNi: ['Ferronickel (25% Ni)', 300, 'INR/kg'], price_niCathode: ['Nickel cathode', 1450, 'INR/kg'],
    price_feMo: ['FeMo', 2450, 'INR/kg'], price_feMn: ['HC FeMn', 90, 'INR/kg'], price_feSi: ['FeSi 75', 115, 'INR/kg'],
    price_lime: ['Burnt lime', 9, 'INR/kg'], price_dolomite: ['Dolomite', 3.5, 'INR/kg'],
    price_coke: ['Coke / charge carbon', 32, 'INR/kg'], price_electrode: ['Graphite electrode', 420, 'INR/kg'],
    price_grid: ['Grid tariff', 7.8, 'INR/kWh'], price_captive: ['Captive coal power', 5.2, 'INR/kWh'],
    price_solar: ['Solar PPA (landed)', 5.6, 'INR/kWh'], price_wind: ['Wind PPA (landed)', 5.9, 'INR/kWh'],
    price_ng: ['Natural gas', 1350, 'INR/GJ'], price_o2: ['Oxygen', 9, 'INR/Nm3'], price_ar: ['Argon', 38, 'INR/Nm3']
  };

  function defaultScenario(grade) {
    grade = grade || '304';
    const g = CT.GRADES[grade];
    const assay = JSON.parse(JSON.stringify(CT.ASSAYS));
    assay.ssScrap = Object.assign({}, g.scrap);
    const factors = {}; for (const k in CT.FACTORS) factors[k] = CT.FACTORS[k].value;
    const prices = {}; for (const k in PRICES) prices[k] = PRICES[k][1];
    return {
      schema: 'ctpro-scenario-1',
      grade,
      mode: 'auto',                       // auto = solve alloys to aim chemistry; manual = user charge per heat
      aim: Object.assign({}, g.aim),
      cuMax: 0.50,                        // operational residual Cu cap, mass %
      shares: { ssScrap: 60, csScrap: 20, pigIron: 20 }, // % of base metallic feed (alloys excluded)
      niCathodeShare: 0,                  // % of alloy-added Ni supplied as cathode instead of FeNi
      feSi: 6,                            // kg/t liquid, AOD reduction / deoxidation (auto mode)
      heatSize: 60,                       // t liquid steel per heat
      manual: { ssScrap: 0, csScrap: 0, pigIron: 0, feCr: 0, feNi: 0, niCathode: 0, feMo: 0, feMn: 0, feSi: 0 }, // kg per heat
      adds: { coke: 6, electrode: 1.8, dolomite: 15, limeKg: 45, argon: 12 }, // kg or Nm3 per t liquid
      limeMode: 'auto', basicity: 1.7,
      assay,
      recovery: { Fe: 0.97, Cr: 0.95, Ni: 0.99, Mo: 0.97, Mn: 0.85, Cu: 1.0 },
      energy: {
        mix: { grid: 60, captive: 40, solar: 0, wind: 0 }, // % of site electricity
        eafMode: 'model', meteredKwh: 620, auxKwh: 85, ngGJ: 0.35, heatRate: 10.5, castYield: 0.97,
        hSteel: 0.386, hSlag: 0.53, lossKwh: 150, etaEl: 0.85, chemUtil: 0.55, burnerEff: 0.5, postComb: 0.30, o2Util: 0.85
      },
      factors, prices,
      econ: { annualTonnes: 300000, carbonPrice: 0 },
      limits: {
        cap: { ssScrap: 800, csScrap: 400, pigIron: 250, feCr: 450, feNi: 500, niCathode: 150, feMo: 60, feMn: 40, feSi: 25 }, // kg/t liquid
        maxChargeC: 2.0, maxRE: 40, maxCaptive: 60
      }
    };
  }

  // Numeric input schema: [path, label, unit, min, max, step, sliderMin, sliderMax, help, status]
  const F = (path, label, unit, min, max, step, smin, smax, help, status) => ({ path, label, unit, min, max, step, smin, smax, help, status: status || 'synthetic' });
  const SECTIONS = [
    { id: 'grade', title: 'Grade & chemistry aim', icon: 'flask', fields: [
      F('aim.Cr', 'Aim Cr', '%', 0, 30, 0.01, 10, 25, 'Target Cr in liquid steel; solver adds FeCr to reach it.', 'verified'),
      F('aim.Ni', 'Aim Ni', '%', 0, 20, 0.01, 0, 15, 'Target Ni; solver adds FeNi / Ni cathode. Ignored for 430 (residual only).', 'verified'),
      F('aim.Mo', 'Aim Mo', '%', 0, 5, 0.01, 0, 4, 'Target Mo (316 only).', 'verified'),
      F('aim.Mn', 'Aim Mn', '%', 0, 3, 0.01, 0, 2.5, 'Target Mn; solver adds HC FeMn.', 'verified'),
      F('aim.Si', 'Aim Si', '%', 0, 1.5, 0.01, 0, 1.2, 'Final Si; the rest of charged Si is oxidised to slag.', 'verified'),
      F('aim.C', 'Aim C', '%', 0.005, 0.5, 0.001, 0.01, 0.15, 'Final C after AOD decarburisation; the rest leaves as CO/CO2.', 'verified'),
      F('cuMax', 'Max residual Cu', '%', 0, 2, 0.01, 0, 1, 'Operational cap on tramp Cu (not oxidisable).', 'synthetic')
    ]},
    { id: 'charge', title: 'Charge mix', icon: 'layers', fields: [
      F('feSi', 'FeSi 75 addition', 'kg/t', 0, 40, 0.1, 0, 25, 'AOD reduction of Cr2O3 / deoxidation. Fixed input in auto mode.'),
      F('heatSize', 'Heat size', 't liquid', 1, 300, 1, 10, 150, 'Used for per-heat quantities and manual-mode charge sheet.')
    ]},
    { id: 'additions', title: 'Additions, fluxes & gases', icon: 'drop', fields: [
      F('adds.coke', 'Charge carbon (coke)', 'kg/t', 0, 60, 0.1, 0, 30, 'Charged/injected carbon, 83% C (IPCC). Oxidised to CO2 unless retained.'),
      F('adds.electrode', 'Graphite electrode consumption', 'kg/t', 0, 10, 0.05, 0, 5, 'Electrode carbon 82% C (IPCC) oxidised to CO2.'),
      F('adds.dolomite', 'Raw dolomite', 'kg/t', 0, 100, 0.5, 0, 60, 'Calcined in furnace → 0.477 kg CO2/kg (scope 1).'),
      F('basicity', 'Slag basicity CaO/SiO2', '–', 0.5, 4, 0.05, 1, 3, 'Auto-lime: lime = basicity × SiO2 − CaO from dolomite.'),
      F('adds.limeKg', 'Burnt lime (manual)', 'kg/t', 0, 200, 0.5, 0, 120, 'Used only when lime mode is manual.'),
      F('adds.argon', 'AOD argon', 'Nm3/t', 0, 40, 0.1, 0, 30, 'Stirring/dilution gas; upstream electricity counted.')
    ]},
    { id: 'energy', title: 'Energy & electricity', icon: 'bolt', fields: [
      F('energy.meteredKwh', 'Metered EAF electricity', 'kWh/t', 100, 1500, 1, 300, 900, 'Used when EAF energy mode = metered.'),
      F('energy.auxKwh', 'Auxiliary electricity (LRF, caster, fume, utilities)', 'kWh/t', 0, 500, 1, 0, 250, 'Fixed per tonne liquid.'),
      F('energy.ngGJ', 'Natural gas (burners, ladle preheat)', 'GJ/t', 0, 5, 0.01, 0, 2, 'Combustion CO2 + CH4 + N2O; also a heat credit.'),
      F('energy.heatRate', 'Captive plant heat rate', 'GJ/MWh', 7, 16, 0.1, 8, 14, 'Captive EF = coal factor × heat rate.')
    ]},
    { id: 'process', title: 'Process & heat balance', icon: 'gauge', fields: [
      F('recovery.Fe', 'Fe recovery', 'fraction', 0.5, 1, 0.001, 0.85, 1, 'Fraction of charged Fe reaching liquid steel.'),
      F('recovery.Cr', 'Cr recovery', 'fraction', 0.5, 1, 0.001, 0.8, 1, 'After AOD reduction with FeSi.'),
      F('recovery.Ni', 'Ni recovery', 'fraction', 0.5, 1, 0.001, 0.9, 1, ''),
      F('recovery.Mo', 'Mo recovery', 'fraction', 0.5, 1, 0.001, 0.85, 1, ''),
      F('recovery.Mn', 'Mn recovery', 'fraction', 0.3, 1, 0.001, 0.6, 1, ''),
      F('recovery.Cu', 'Cu recovery', 'fraction', 0.5, 1, 0.001, 0.9, 1, 'Cu is not oxidised; ~100% stays in steel.'),
      F('energy.castYield', 'Casting yield (liquid → slab)', 't/t', 0.8, 1, 0.001, 0.9, 1, 'Converts per-tonne-liquid to per-tonne-slab.'),
      F('energy.hSteel', 'Liquid-steel enthalpy', 'kWh/kg', 0.3, 0.5, 0.001, 0.34, 0.44, '≈1.39 GJ/t at tapping temperature.', 'literature'),
      F('energy.hSlag', 'Liquid-slag enthalpy', 'kWh/kg', 0.3, 0.8, 0.001, 0.4, 0.7, '≈1.9 GJ/t.', 'literature'),
      F('energy.lossKwh', 'Thermal losses (water, off-gas, radiation)', 'kWh/t', 0, 400, 1, 0, 250, 'Calibration parameter — fit to metered data.'),
      F('energy.etaEl', 'Electrical-to-bath efficiency', 'fraction', 0.4, 1, 0.01, 0.6, 1, 'Calibration parameter.'),
      F('energy.chemUtil', 'Chemical-heat utilisation', 'fraction', 0, 1, 0.01, 0, 1, 'Share of oxidation heat that reaches the bath.'),
      F('energy.burnerEff', 'Burner efficiency', 'fraction', 0, 1, 0.01, 0, 1, ''),
      F('energy.postComb', 'Post-combustion (CO → CO2) ratio', 'fraction', 0, 1, 0.01, 0, 1, 'Raises chemical heat credit and O2 demand.'),
      F('energy.o2Util', 'Oxygen utilisation', 'fraction', 0.3, 1, 0.01, 0.5, 1, '')
    ]},
    { id: 'assays', title: 'Material assays', icon: 'beaker', fields: [
      F('assay.ssScrap.Cr', 'SS scrap Cr', '%', 0, 30, 0.01, 0, 25, 'Grade-segregated scrap assay; reset on grade change.'),
      F('assay.ssScrap.Ni', 'SS scrap Ni', '%', 0, 20, 0.01, 0, 15, ''),
      F('assay.ssScrap.Mo', 'SS scrap Mo', '%', 0, 5, 0.01, 0, 4, ''),
      F('assay.ssScrap.Mn', 'SS scrap Mn', '%', 0, 3, 0.01, 0, 3, ''),
      F('assay.ssScrap.Cu', 'SS scrap Cu', '%', 0, 2, 0.01, 0, 1, ''),
      F('assay.csScrap.Cu', 'CS scrap Cu', '%', 0, 2, 0.01, 0, 1, 'Tramp Cu limits carbon-steel scrap use.'),
      F('assay.csScrap.C', 'CS scrap C', '%', 0, 2, 0.01, 0, 1, ''),
      F('assay.pigIron.C', 'Pig iron C', '%', 0, 5, 0.01, 2.5, 5, 'IIMA basic pig iron typically 3.5–4.5% C.', 'public'),
      F('assay.pigIron.Si', 'Pig iron Si', '%', 0, 4, 0.01, 0, 3, '')
    ]},
    { id: 'factors', title: 'Emission factors', icon: 'leaf', fields: Object.keys(CT.FACTORS).map(k => {
      const f = CT.FACTORS[k], hi = k === 'ef_coal' || k === 'ef_ng' ? 150 : 100;
      return F('factors.' + k, f.label, f.unit, 0, hi, 0.001, 0, Math.max(1, f.value * 2.5), f.note, f.status);
    })},
    { id: 'prices', title: 'Prices & economics', icon: 'coin', fields: Object.keys(PRICES).map(k =>
      F('prices.' + k, PRICES[k][0], PRICES[k][2], 0, 1e6, 0.01, 0, Math.max(10, PRICES[k][1] * 2.5), 'Illustrative market-order price; not procurement data.')
    ).concat([
      F('econ.carbonPrice', 'Internal carbon price', 'INR/t CO2e', 0, 50000, 10, 0, 10000, 'Used by the "cost incl. carbon" objective and KPI.'),
      F('econ.annualTonnes', 'Annual slab output', 't/yr', 0, 1e8, 1000, 0, 3000000, 'Scales per-tonne savings to annual impact.')
    ])},
    { id: 'limits', title: 'Operating constraints', icon: 'shield', fields: [
      F('limits.cap.ssScrap', 'SS scrap availability', 'kg/t', 0, 2000, 1, 0, 1200, 'Max kg per tonne liquid the scrap yard can supply.'),
      F('limits.cap.csScrap', 'CS scrap availability', 'kg/t', 0, 2000, 1, 0, 1200, ''),
      F('limits.cap.pigIron', 'Pig iron availability', 'kg/t', 0, 2000, 1, 0, 1200, ''),
      F('limits.cap.feCr', 'FeCr max', 'kg/t', 0, 1000, 1, 0, 600, ''),
      F('limits.cap.feNi', 'FeNi max', 'kg/t', 0, 1000, 1, 0, 700, ''),
      F('limits.cap.niCathode', 'Ni cathode max', 'kg/t', 0, 500, 1, 0, 300, 'Cathode supply availability.'),
      F('limits.cap.feMo', 'FeMo max', 'kg/t', 0, 200, 1, 0, 100, ''),
      F('limits.cap.feMn', 'FeMn max', 'kg/t', 0, 200, 1, 0, 100, ''),
      F('limits.cap.feSi', 'FeSi max', 'kg/t', 0, 100, 1, 0, 60, ''),
      F('limits.maxChargeC', 'Max carbon in metallic charge', '%', 0, 6, 0.01, 0, 4, 'Decarburisation capacity / AOD cycle time limit.'),
      F('limits.maxRE', 'Max renewable share', '%', 0, 100, 1, 0, 100, 'Contracted RE / open-access availability.'),
      F('limits.maxCaptive', 'Max captive share', '%', 0, 100, 1, 0, 100, 'Captive plant capacity.')
    ]}
  ];

  // Flattened numeric field list for validation.
  const FIELDS = [];
  for (const s of SECTIONS) for (const f of s.fields) FIELDS.push(f);
  // Fields rendered by custom controls, still validated here.
  for (const k of CT.BASE_FEEDS) FIELDS.push(F('shares.' + k, CT.MATERIALS[k].short + ' share of base feed', '%', 0, 100, 0.1));
  FIELDS.push(F('niCathodeShare', 'Ni from cathode', '%', 0, 100, 1));
  for (const k of ['grid', 'captive', 'solar', 'wind']) FIELDS.push(F('energy.mix.' + k, k + ' electricity share', '%', 0, 100, 0.1));
  for (const k of CT.CHARGE_KEYS) FIELDS.push(F('manual.' + k, CT.MATERIALS[k].short + ' per heat', 'kg', 0, 1e6, 1));

  CT.PRICES = PRICES;
  CT.SECTIONS = SECTIONS;
  CT.FIELDS = FIELDS;
  CT.defaultScenario = defaultScenario;
  CT.POWER_SOURCES = {
    grid: { label: 'Grid (CEA)', factor: 'ef_grid', price: 'price_grid', scope: 2, renewable: false, color: '--c-slate' },
    captive: { label: 'Captive coal', factor: null, price: 'price_captive', scope: 1, renewable: false, color: '--c-coal' },
    solar: { label: 'Solar PPA', factor: 'ef_solar', price: 'price_solar', scope: 2, renewable: true, color: '--c-amber' },
    wind: { label: 'Wind PPA', factor: 'ef_wind', price: 'price_wind', scope: 2, renewable: true, color: '--c-sky' }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
