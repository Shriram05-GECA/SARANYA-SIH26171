import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const nm = [path.join(here, 'node_modules'), path.join(here, '..', 'node_modules')].find((p) => fs.existsSync(path.join(p, 'tesseract.js')));
if (!nm) throw new Error('Run `npm install` at the repo root first.');

await build({
  entryPoints: {
    background: 'src/background/index.ts', content: 'src/content/index.ts', popup: 'src/popup/popup.ts',
    dashboard: 'src/popup/dashboard.ts', offscreen: 'src/offscreen/offscreen.ts',
  },
  outdir: dist, bundle: true, format: 'iife', target: 'chrome116', platform: 'browser', sourcemap: false, minify: false, logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['onnxruntime-web'],
});

const cp = (from, to) => { fs.mkdirSync(path.dirname(path.join(dist, to)), { recursive: true }); fs.copyFileSync(from, path.join(dist, to)); };
cp(path.join(here, 'manifest.json'), 'manifest.json');
for (const f of ['popup.html', 'dashboard.html']) cp(path.join(here, f), f);
cp(path.join(here, 'src/popup/ui.css'), 'ui.css');
fs.writeFileSync(path.join(dist, 'offscreen.html'), '<!doctype html><html><body><script src="offscreen.js"></script></body></html>');

// Local OCR assets (no network at runtime)
const tj = path.join(nm, 'tesseract.js/dist/worker.min.js');
const core = ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'];
cp(tj, 'tesseract/worker.min.js');
for (const c of core) cp(path.join(nm, 'tesseract.js-core', c), 'tesseract/' + c);
const lang = path.join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
cp(lang, 'tesseract/lang/eng.traineddata.gz');
const mb = (f) => fs.statSync(f).size / 1048576;
const total = mb(tj) + mb(path.join(nm, 'tesseract.js-core', core[0])) + mb(lang);
fs.writeFileSync(path.join(dist, 'assets-manifest.json'), JSON.stringify({
  engine: 'tesseract.js 5.1.1 (WASM, LSTM) + eng best_int', ocr_total_mb: Math.round(total * 10) / 10,
  worker_mb: Math.round(mb(tj) * 10) / 10, core_mb: Math.round(mb(path.join(nm, 'tesseract.js-core', core[0])) * 10) / 10, lang_mb: Math.round(mb(lang) * 10) / 10,
}, null, 2));

// Optional bundled offline benchmark report
const rep = path.join(here, '..', 'evaluation', 'reports', 'latest.json');
if (fs.existsSync(rep)) cp(rep, 'benchmark-report.json');

// Icons (simple generated PNGs are produced by scripts/make_icons.py; fall back to committed ones)
const icons = path.join(here, 'icons');
if (fs.existsSync(icons)) for (const f of fs.readdirSync(icons)) cp(path.join(icons, f), 'icons/' + f);

// Local ONNX vision model (no remote download at runtime)
const modelSrc = path.join(here, 'models', 'aegis-vision.onnx');
if (fs.existsSync(modelSrc)) {
  cp(modelSrc, 'models/aegis-vision.onnx');
  console.log('Packaged vision model:', (fs.statSync(modelSrc).size / 1048576).toFixed(1), 'MB');
} else {
  console.warn('WARNING: models/aegis-vision.onnx missing — local CV will be unavailable');
}


// ONNX Runtime Web WASM assets (local vision)
const ortDir = path.join(here, 'ort');
if (fs.existsSync(ortDir)) {
  for (const f of fs.readdirSync(ortDir)) {
    cp(path.join(ortDir, f), 'ort/' + f);
  }
  console.log('Packaged ORT assets from extension/ort');
} else {
  const ortNm = path.join(nm, 'onnxruntime-web', 'dist');
  if (fs.existsSync(ortNm)) {
    for (const f of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.mjs']) {
      const src = path.join(ortNm, f);
      if (fs.existsSync(src)) cp(src, 'ort/' + f);
    }
    console.log('Packaged ORT from node_modules');
  } else {
    console.warn('WARNING: ORT assets missing — run npm install and ensure extension/ort exists');
  }
}

console.log('Built extension ->', dist);
