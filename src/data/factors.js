/* CarbonTrace Pro — emission-factor, constant and source register.
 * Every default carries a status:
 *   verified   — standard physical/stoichiometric constant or IPCC default
 *   public     — published public reference value (check the edition before reporting)
 *   literature — representative value chosen from published industry LCA data
 *   synthetic  — illustrative placeholder; replace with supplier / plant data
 * No value here is Jindal Stainless plant data.
 */
(function (root) {
  'use strict';
  const CT = root.CT = root.CT || {};

  const SOURCES = {
    cea: { title: 'CEA CO2 Baseline Database for the Indian Power Sector, v20.0 (FY2023-24), user guide',
      url: 'https://cea.nic.in/wp-content/uploads/2021/03/User_Guide_Version_20.0.pdf' },
    ipccEnergy: { title: 'IPCC 2006 Guidelines Vol.2 Ch.2 Stationary Combustion, Tables 2.2–2.3',
      url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/2_Volume2/V2_2_Ch2_Stationary_Combustion.pdf' },
    ipccMetal: { title: 'IPCC 2006 Guidelines Vol.3 Ch.4 Metal Industry, Table 4.3 (carbon contents)',
      url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/3_Volume3/V3_4_Ch4_Metal_Industry.pdf' },
    ipccMineral: { title: 'IPCC 2006 Guidelines Vol.3 Ch.2 Mineral Industry, Tables 2.1 and 2.4',
      url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/3_Volume3/V3_2_Ch2_Mineral_Industry.pdf' },
    gwp: { title: 'GHG Protocol Global Warming Potential values (AR6 GWP100), Aug 2024',
      url: 'https://ghgprotocol.org/sites/default/files/2024-08/Global-Warming-Potential-Values%20(August%202024).pdf' },
    scope2: { title: 'GHG Protocol Scope 2 Guidance (location- and market-based methods)',
      url: 'https://ghgprotocol.org/scope-2-guidance' },
    nickelFeNi: { title: 'Nickel Institute LCA fact sheet: ferronickel (2017 data, ~45 kg CO2e/kg Ni)',
      url: 'https://www.nickelinstitute.org/media/xerj44z5/ferronickel_jp.pdf' },
    nickelClass1: { title: 'Nickel Institute averages as cited by Vale (2021): Class 1 ≈13, Class 2 ≈45 t CO2e/t Ni',
      url: 'https://www.newswire.ca/news-releases/low-carbon-nickel-positions-vale-well-in-north-american-european-electric-vehicle-market-821582758.html' },
    icda: { title: 'ICDA 2021 industry average ≈10 t CO2e/t Cr in ferrochrome (as cited by Outokumpu)',
      url: 'https://www.outokumpu.com/en/products/specialized-products/ferrochrome' },
    femo: { title: 'J. Sustain. Metall. (2019): FeMo cradle-to-gate 3.16–14.79 t CO2e/t FeMo',
      url: 'https://link.springer.com/article/10.1007/s40831-019-00260-8' },
    pig: { title: 'International Iron Metallics Association: pig iron composition ranges',
      url: 'https://www.metallics.org/about-metallics/pig-iron/' },
    astm: { title: 'ASTM A240/A240M chemical limits for 304, 316, 430 (verify against current edition)',
      url: 'https://www.thyssenkrupp-materials-na.com/materials/stainless-steel/chemical-composition-1.html' }
  };

  // Editable emission factors (kg CO2e per stated unit). Scope: 1 direct, 2 purchased energy, 3 upstream.
  const FACTORS = {
    ef_grid: { label: 'Indian grid electricity', value: 0.727, unit: 'kg CO2/kWh', status: 'public', source: 'cea', scope: 2,
      note: 'CEA v20 weighted-average grid factor for FY2023-24 (0.727 t/MWh as reported in public listings). Location-based. Confirm against CEA Appendix before reporting.' },
    ef_solar: { label: 'Solar PPA electricity (market-based)', value: 0, unit: 'kg CO2/kWh', status: 'public', source: 'scope2', scope: 2,
      note: 'Market-based Scope 2 with contractual instruments / RECs = 0. Life-cycle emissions of the PV plant (~0.02–0.05) are outside this boundary.' },
    ef_wind: { label: 'Wind PPA electricity (market-based)', value: 0, unit: 'kg CO2/kWh', status: 'public', source: 'scope2', scope: 2,
      note: 'Market-based Scope 2 with contractual instruments = 0. Life-cycle emissions of the wind plant are outside this boundary.' },
    ef_coal: { label: 'Coal combustion (other bituminous)', value: 94.6, unit: 'kg CO2/GJ NCV', status: 'verified', source: 'ipccEnergy', scope: 1,
      note: 'IPCC default 94,600 kg CO2/TJ. Captive power EF = this × heat rate.' },
    ef_ng: { label: 'Natural gas combustion CO2', value: 56.1, unit: 'kg CO2/GJ NCV', status: 'verified', source: 'ipccEnergy', scope: 1,
      note: 'IPCC default 56,100 kg CO2/TJ. CH4 (1 g/GJ) and N2O (0.1 g/GJ) added with AR6 GWP100.' },
    ef_ssScrap: { label: 'Stainless scrap (collection & processing)', value: 0.05, unit: 'kg CO2e/kg', status: 'synthetic', source: null, scope: 3,
      note: 'Recycled-content (cut-off) approach: only collection, sorting and shredding. Illustrative.' },
    ef_csScrap: { label: 'Carbon-steel scrap (collection & processing)', value: 0.03, unit: 'kg CO2e/kg', status: 'synthetic', source: null, scope: 3,
      note: 'Cut-off approach; illustrative.' },
    ef_pigIron: { label: 'Pig iron (blast furnace, cradle-to-gate)', value: 1.9, unit: 'kg CO2e/kg', status: 'synthetic', source: 'pig', scope: 3,
      note: 'Indicative order of magnitude for BF hot metal cast as pig iron. Replace with supplier EPD.' },
    ef_feCr: { label: 'HC ferrochrome', value: 6.0, unit: 'kg CO2e/kg alloy', status: 'literature', source: 'icda', scope: 3,
      note: 'ICDA 2021 average ≈10 kg CO2e/kg contained Cr × 60% Cr. Strongly depends on smelter power source.' },
    ef_feNi: { label: 'Ferronickel', value: 11.25, unit: 'kg CO2e/kg alloy', status: 'literature', source: 'nickelFeNi', scope: 3,
      note: 'Nickel Institute ≈45 kg CO2e/kg contained Ni × 25% Ni.' },
    ef_niCathode: { label: 'Nickel cathode (Class 1)', value: 13.0, unit: 'kg CO2e/kg alloy', status: 'literature', source: 'nickelClass1', scope: 3,
      note: 'Nickel Institute Class 1 average ≈13 kg CO2e/kg Ni (99.8% Ni).' },
    ef_feMo: { label: 'Ferromolybdenum', value: 8.0, unit: 'kg CO2e/kg alloy', status: 'literature', source: 'femo', scope: 3,
      note: 'Representative mid-range of the published 3.2–14.8 kg CO2e/kg FeMo range. Mine-specific.' },
    ef_feMn: { label: 'HC ferromanganese', value: 2.0, unit: 'kg CO2e/kg alloy', status: 'synthetic', source: null, scope: 3,
      note: 'Illustrative placeholder. Replace with supplier EPD.' },
    ef_feSi: { label: 'Ferrosilicon 75', value: 6.0, unit: 'kg CO2e/kg alloy', status: 'synthetic', source: null, scope: 3,
      note: 'Illustrative placeholder; very power-mix dependent.' },
    ef_lime: { label: 'Burnt lime (calcination, upstream)', value: 0.75, unit: 'kg CO2/kg lime', status: 'public', source: 'ipccMineral', scope: 3,
      note: 'IPCC Tier 1 high-calcium lime process factor. Kiln fuel emissions are excluded.' },
    ef_dolomite: { label: 'Raw dolomite calcined in furnace', value: 0.477, unit: 'kg CO2/kg', status: 'verified', source: 'ipccMineral', scope: 1,
      note: 'Stoichiometric CO2 content of pure CaMg(CO3)2.' },
    ef_o2Power: { label: 'Electricity to produce oxygen / argon', value: 0.45, unit: 'kWh/Nm3', status: 'synthetic', source: null, scope: 3,
      note: 'Illustrative air-separation specific energy. Converted with the grid factor (purchased gases).' }
  };

  // Physical constants (not edited in the UI).
  const CONST = {
    gwpCH4: 27.0, gwpN2O: 273, ngCH4: 0.001, ngN2O: 0.0001, // kg per GJ NCV (IPCC manufacturing Tier 1)
    cokeNCV: 28.2,           // GJ/t, IPCC coke-oven coke
    co2PerC: 44.0095 / 12.011,
    nm3PerKmol: 22.414,
    kwhToGJ: 0.0036,
    // Formation enthalpies converted to MJ per kg of element oxidised (standard state, 25 °C)
    heat: { C_CO: 9.20, C_CO2: 32.76, Si: 32.4, Fe: 4.87, Cr: 10.96, Mn: 7.01 },
    oxide: { Si: 60.084 / 28.086, Fe: 71.844 / 55.845, Cr: 151.99 / 103.99, Mn: 70.937 / 54.938, Ni: 74.69 / 58.69, Mo: 143.94 / 95.95 },
    molar: { C: 12.011, Si: 28.086, Fe: 55.845, Cr: 51.996, Mn: 54.938 },
    o2PerMol: { Si: 1, Fe: 0.5, Cr: 0.75, Mn: 0.5 }
  };

  CT.SOURCES = SOURCES;
  CT.FACTORS = FACTORS;
  CT.CONST = CONST;
  CT.STATUS_LABEL = { verified: 'Verified constant', public: 'Public reference', literature: 'Industry LCA', synthetic: 'Synthetic' };
})(typeof globalThis !== 'undefined' ? globalThis : this);
