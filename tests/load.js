// Loads the browser engine files into Node in the same order as index.html.
'use strict';
const path = require('node:path');
for (const f of ['data/factors.js', 'data/materials.js', 'data/defaults.js', 'engine/model.js', 'engine/optimizer.js', 'engine/analysis.js'])
  require(path.join(__dirname, '..', 'src', f));
module.exports = globalThis.CT;
