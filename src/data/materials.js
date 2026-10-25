/* CarbonTrace Pro — charge materials, grade specifications and default assays.
 * Compositions are mass %. Unlisted remainder of a metallic material is iron ("balance Fe").
 * Typical industrial compositions; illustrative unless a supplier certificate is entered.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};

  const ELEMENTS = ['Fe', 'Cr', 'Ni', 'Mo', 'Mn', 'Si', 'C', 'Cu'];
  const METALS = ['Fe', 'Cr', 'Ni', 'Mo', 'Mn', 'Cu']; // recovered into liquid steel via recovery factors

  // role: base = base metallic feed (share-controlled), alloy = solved or manual addition, fixed = per-tonne addition
  const MATERIALS = {
    ssScrap:   { label: 'Stainless-steel scrap', short: 'SS scrap', role: 'base', ef: 'ef_ssScrap', price: 'price_ssScrap', color: '--c-teal', recycled: true },
    csScrap:   { label: 'Carbon-steel scrap', short: 'CS scrap', role: 'base', ef: 'ef_csScrap', price: 'price_csScrap', color: '--c-sky', recycled: true },
    pigIron:   { label: 'Pig iron', short: 'Pig iron', role: 'base', ef: 'ef_pigIron', price: 'price_pigIron', color: '--c-slate', recycled: false },
    feCr:      { label: 'HC ferrochrome (60% Cr)', short: 'FeCr', role: 'alloy', ef: 'ef_feCr', price: 'price_feCr', color: '--c-amber', recycled: false },
    feNi:      { label: 'Ferronickel (25% Ni)', short: 'FeNi', role: 'alloy', ef: 'ef_feNi', price: 'price_feNi', color: '--c-violet', recycled: false },
    niCathode: { label: 'Nickel cathode (99.8% Ni)', short: 'Ni cathode', role: 'alloy', ef: 'ef_niCathode', price: 'price_niCathode', color: '--c-indigo', recycled: false },
    feMo:      { label: 'Ferromolybdenum (65% Mo)', short: 'FeMo', role: 'alloy', ef: 'ef_feMo', price: 'price_feMo', color: '--c-rose', recycled: false },
    feMn:      { label: 'HC ferromanganese (75% Mn)', short: 'FeMn', role: 'alloy', ef: 'ef_feMn', price: 'price_feMn', color: '--c-orange', recycled: false },
    feSi:      { label: 'Ferrosilicon 75 (reductant)', short: 'FeSi', role: 'alloy', ef: 'ef_feSi', price: 'price_feSi', color: '--c-lime', recycled: false }
  };
  const BASE_FEEDS = ['ssScrap', 'csScrap', 'pigIron'];
  const CHARGE_KEYS = Object.keys(MATERIALS);

  // Default assays (mass %). ssScrap assay is grade-specific and set from GRADES on grade change.
  const ASSAYS = {
    csScrap:   { Cr: 0.10, Ni: 0.10, Mo: 0.02, Mn: 0.60, Si: 0.20, C: 0.15, Cu: 0.25 },
    pigIron:   { Cr: 0.00, Ni: 0.00, Mo: 0.00, Mn: 0.50, Si: 0.80, C: 4.20, Cu: 0.01, other: 0.20 },
    feCr:      { Cr: 60.0, Ni: 0, Mo: 0, Mn: 0, Si: 2.0, C: 7.0, Cu: 0 },
    feNi:      { Cr: 0, Ni: 25.0, Mo: 0, Mn: 0, Si: 0.30, C: 0.05, Cu: 0.05 },
    niCathode: { Cr: 0, Ni: 99.8, Mo: 0, Mn: 0, Si: 0, C: 0, Cu: 0 },
    feMo:      { Cr: 0, Ni: 0, Mo: 65.0, Mn: 0, Si: 1.0, C: 0.10, Cu: 0.50 },
    feMn:      { Cr: 0, Ni: 0, Mo: 0, Mn: 75.0, Si: 1.0, C: 7.0, Cu: 0 },
    feSi:      { Cr: 0, Ni: 0, Mo: 0, Mn: 0, Si: 75.0, C: 0.10, Cu: 0 }
  };

  // ASTM A240-type limits (mass %, [min, max]; null = not specified) and default aim chemistry.
  // solve: elements that the auto-alloy solver drives to the aim with an alloy addition.
  const GRADES = {
    '304': {
      name: 'AISI 304 · austenitic 18-8',
      spec: { C: [0, 0.07], Mn: [0, 2.0], Si: [0, 0.75], Cr: [17.5, 19.5], Ni: [8.0, 10.5], Mo: null },
      aim: { C: 0.045, Si: 0.40, Mn: 1.10, Cr: 18.10, Ni: 8.05, Mo: 0 },
      solve: ['Cr', 'Ni', 'Mn'],
      scrap: { Cr: 18.0, Ni: 8.0, Mo: 0.25, Mn: 1.20, Si: 0.40, C: 0.05, Cu: 0.35 }
    },
    '316': {
      name: 'AISI 316 · Mo-bearing austenitic',
      spec: { C: [0, 0.08], Mn: [0, 2.0], Si: [0, 0.75], Cr: [16.0, 18.0], Ni: [10.0, 14.0], Mo: [2.0, 3.0] },
      aim: { C: 0.040, Si: 0.45, Mn: 1.10, Cr: 16.70, Ni: 10.05, Mo: 2.05 },
      solve: ['Cr', 'Ni', 'Mo', 'Mn'],
      scrap: { Cr: 16.7, Ni: 10.0, Mo: 2.05, Mn: 1.20, Si: 0.40, C: 0.04, Cu: 0.35 }
    },
    '430': {
      name: 'AISI 430 · ferritic 17Cr',
      spec: { C: [0, 0.12], Mn: [0, 1.0], Si: [0, 1.0], Cr: [16.0, 18.0], Ni: [0, 0.75], Mo: null },
      aim: { C: 0.050, Si: 0.40, Mn: 0.45, Cr: 16.30, Ni: 0, Mo: 0 },
      solve: ['Cr', 'Mn'],
      scrap: { Cr: 16.2, Ni: 0.25, Mo: 0.05, Mn: 0.45, Si: 0.40, C: 0.06, Cu: 0.10 }
    }
  };

  // Alloy used by the solver to raise each element.
  const SOLVE_ALLOY = { Cr: 'feCr', Ni: 'niSource', Mo: 'feMo', Mn: 'feMn' };

  CT.ELEMENTS = ELEMENTS;
  CT.METALS = METALS;
  CT.MATERIALS = MATERIALS;
  CT.BASE_FEEDS = BASE_FEEDS;
  CT.CHARGE_KEYS = CHARGE_KEYS;
  CT.ASSAYS = ASSAYS;
  CT.GRADES = GRADES;
  CT.SOLVE_ALLOY = SOLVE_ALLOY;
})(typeof globalThis !== 'undefined' ? globalThis : this);
