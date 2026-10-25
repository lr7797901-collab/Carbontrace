// Production build for static hosting (Vercel): validate, then copy the runtime files to dist/.
// No bundler is needed — the app is plain HTML/CSS/JS loaded with relative paths.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const SHIP = ['index.html', 'css', 'src', 'tests/ui-smoke.html']; // runtime files + in-browser QA page
const fail = msg => { console.error('BUILD FAILED: ' + msg); process.exit(1); };

// 1. Every local asset referenced by index.html must exist and be relative.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/\b(?:src|href)="([^"#]+)"/g)].map(m => m[1])
  .filter(u => !/^(https?:|data:|mailto:)/.test(u));
for (const ref of refs) {
  if (ref.startsWith('/') || /^[a-z]:/i.test(ref) || ref.startsWith('file:')) fail(`absolute/local path in index.html: ${ref}`);
  if (!fs.existsSync(path.join(root, ref))) fail(`missing asset referenced by index.html: ${ref}`);
}

// 2. No local-only paths or hosts in shipped code.
const files = [];
const walk = p => fs.statSync(p).isDirectory() ? fs.readdirSync(p).forEach(f => walk(path.join(p, f))) : files.push(p);
SHIP.forEach(s => walk(path.join(root, s)));
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  if (/[A-Za-z]:\\\\?Users|file:\/\/|localhost|127\.0\.0\.1/.test(text)) fail(`local-only path or host found in ${path.relative(root, f)}`);
}

// 3. Engine smoke test, loading the exact files that will be shipped in the same order as index.html.
const ctx = vm.createContext({ console });
ctx.globalThis = ctx;
for (const ref of refs.filter(r => r.endsWith('.js') && r.startsWith('src/') && !r.startsWith('src/ui/')))
  vm.runInContext(fs.readFileSync(path.join(root, ref), 'utf8'), ctx, { filename: ref });
const CT = ctx.CT;
for (const g of ['304', '316', '430']) {
  const r = CT.engine.calculate(CT.engine.setGrade(CT.defaultScenario(), g));
  if (!r.ok || !r.feasible || !Number.isFinite(r.kpi.co2)) fail(`engine check failed for grade ${g}: ${r.reason || JSON.stringify(r.violations)}`);
}
const opt = CT.optimizer.optimize(CT.defaultScenario(), { step: 10 });
if (!opt.best || !opt.bestResult.feasible) fail('optimiser check failed');

// 4. Copy to dist/.
fs.rmSync(dist, { recursive: true, force: true });
for (const s of SHIP) fs.cpSync(path.join(root, s), path.join(dist, s), { recursive: true });
let bytes = 0; const out = [];
(function count(p) { for (const f of fs.readdirSync(p)) { const q = path.join(p, f); fs.statSync(q).isDirectory() ? count(q) : (bytes += fs.statSync(q).size, out.push(q)); } })(dist);
console.log(`Build OK — ${refs.length} assets verified, engine + optimiser checks passed (${CT.VERSION}), ${out.length} files / ${(bytes / 1024).toFixed(1)} KB → dist/`);
