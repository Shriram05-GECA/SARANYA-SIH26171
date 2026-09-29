/* Offline evaluation on the synthetic dataset. Uses the REAL extension code (extractor + firewall + OCR analysis).
 * DOM metrics run in Node+jsdom (layout disabled); OCR runs the real Tesseract WASM engine in Node.
 * Only measured values are written. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JSDOM } from 'jsdom';
import { scanDocument, finalizePayload } from '../../extension/src/content/extractor';
import { verifyPayload, collectStrings } from '../../extension/src/privacy/firewall';
import { analyzeOcr, tessToOcr } from '../../extension/src/privacy/ocr';

import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ds = path.join(root, 'dataset');
const gt = JSON.parse(fs.readFileSync(path.join(ds, 'ground_truth.json'), 'utf8'));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const dig = (s: string) => s.replace(/\D/g, '');
const pct = (n: number) => Math.round(n * 1000) / 1000;
const stats = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { mean: pct(s.reduce((x, y) => x + y, 0) / s.length), p50: pct(s[Math.floor(s.length / 2)]), p95: pct(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]), max: pct(s[s.length - 1]) }; };
const has = (hay: string[], v: string) => { const n = norm(v), d = dig(v); const numeric = d.length >= 6 && d.length >= n.length * 0.7; return hay.some((h) => (numeric ? dig(h).includes(d) : norm(h).includes(n))); };

async function domEval() {
  let TP = 0, FN = 0, FP = 0, keepTotal = 0, keepCharsTotal = 0, keepCharsKept = 0, relTotal = 0, relOk = 0, interactiveEmitted = 0, interactiveExpected = 0;
  let fwBlocks = 0;
  const times: number[] = [];
  const byType: Record<string, { tp: number; fn: number }> = {};
  const misses: { page: string; type: string; hard?: string }[] = [];
  const heap0 = process.memoryUsage().heapUsed; const cpu0 = process.cpuUsage();
  for (const p of gt.pages) {
    const dom = new JSDOM(fs.readFileSync(path.join(ds, 'pages', p.page), 'utf8'), { url: 'http://localhost:5500/synthetic/' });
    const t0 = performance.now();
    const scan = scanDocument(dom.window.document, { layout: false });
    const { payload, raw } = finalizePayload(scan, 'Open my application details');
    const rep = verifyPayload(payload, raw);
    times.push(performance.now() - t0);
    if (!rep.allowed) fwBlocks++;
    const strs = collectStrings(payload);
    for (const s of p.sensitive) {
      if (s.type === 'password_field') { const ok = payload.page.elements.some((e) => e.input_type === 'password' && e.sensitive && !e.value); ok ? TP++ : FN++; continue; }
      const leaked = has(strs, s.value);
      (byType[s.type] ??= { tp: 0, fn: 0 });
      if (leaked) { FN++; byType[s.type].fn++; misses.push({ page: p.page, type: s.type, hard: s.hard }); } else { TP++; byType[s.type].tp++; }
    }
    for (const k of p.keep) { keepTotal++; keepCharsTotal += k.length; const kept = strs.some((h) => h.includes(k)); if (kept) keepCharsKept += k.length; else FP++; }
    const els = payload.page.elements;
    for (const r of p.relevant) { relTotal++; if (els.some((e) => e.type === r.type && (e.text ?? '').trim() === r.text)) relOk++; }
    interactiveExpected += p.relevant.length;
    interactiveEmitted += els.filter((e) => e.type === 'button' || e.type === 'link').length;
  }
  const precision = TP / (TP + FP), recall = TP / (TP + FN);
  return {
    pages: gt.pages.length, sensitive_total: TP + FN, tp: TP, fn: FN, fp_items: FP,
    precision: pct(precision), recall: pct(recall), f1: pct((2 * precision * recall) / (precision + recall)),
    redaction_precision_items: pct(1 - FP / keepTotal), redaction_precision_chars: pct(keepCharsKept / keepCharsTotal),
    context_accuracy: pct(relOk / relTotal), context_precision: pct(relOk / interactiveEmitted),
    firewall_blocks: fwBlocks, latency_ms: stats(times), by_type: byType, misses,
    node_heap_delta_mb: pct((process.memoryUsage().heapUsed - heap0) / 1048576), node_cpu_ms: pct((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000),
  };
}

async function ocrEval() {
  const { createWorker } = await import('tesseract.js');
  const lang = path.resolve(root, '..', 'node_modules/@tesseract.js-data/eng/4.0.0_best_int');
  const t0 = performance.now();
  const worker = await createWorker('eng', 1, { langPath: lang, gzip: true, cacheMethod: 'none' });
  const initMs = performance.now() - t0;
  let TP = 0, FN = 0, FP = 0, keepTotal = 0; const ocrMs: number[] = []; const missed: string[] = [];
  for (const im of gt.images) {
    const t1 = performance.now();
    const { data } = await worker.recognize(path.join(ds, 'images', im.image));
    const ms = performance.now() - t1; ocrMs.push(ms);
    const a = analyzeOcr(tessToOcr(data, 0, 0, ms));
    for (const s of im.pii) { if (has([a.ocrTextRedacted], s.value)) { FN++; missed.push(`${im.image}:${s.type}`); } else TP++; }
    for (const k of im.keep_lines) { keepTotal++; if (!norm(a.ocrTextRedacted).includes(norm(k))) FP++; }
  }
  await worker.terminate();
  const precision = TP / (TP + FP), recall = TP / (TP + FN);
  return { images: gt.images.length, pii_total: TP + FN, tp: TP, fn: FN, fp_lines: FP, keep_lines_total: keepTotal, precision: pct(precision), recall: pct(recall), f1: pct((2 * precision * recall) / (precision + recall)),
    ocr_ms_mean: pct(ocrMs.reduce((a, b) => a + b, 0) / ocrMs.length), ocr_ms_p95: stats(ocrMs).p95, engine_init_ms: pct(initMs), missed };
}

(async () => {
  const dom = await domEval();
  const visual = await ocrEval();
  const langPath = path.resolve(root, '..', 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  const report = {
    generated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC',
    environment: { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, note: 'DOM metrics: Node + jsdom (layout disabled). OCR: real Tesseract.js WASM engine in Node. Not a browser benchmark; see browser_e2e.json for in-Chrome timings.' },
    model_size_mb: { ocr_language_data: pct(fs.statSync(langPath).size / 1048576) },
    definitions: {
      precision: 'TP/(TP+FP). TP = ground-truth sensitive value absent from the outgoing payload; FP = non-sensitive ground-truth text that was lost/redacted.',
      recall: 'TP/(TP+FN). FN = ground-truth sensitive value still present in the outgoing payload.',
      redaction_precision: 'Share of ground-truth non-sensitive text (items / characters) that survives intact in the sanitized payload.',
      context_accuracy: 'Share of expected buttons/links/headings represented with correct type and text in the sanitized context.',
    },
    dom, visual,
  };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/latest.json'), JSON.stringify(report, null, 2));
  const md = `# AEGIS evaluation (synthetic data, measured)\n\nGenerated ${report.generated_at} · ${report.environment.cpu} · Node ${process.version}\n\n## DOM pages (${dom.pages} pages, ${dom.sensitive_total} sensitive values)\n| Metric | Value |\n|---|---|\n| PII precision | ${dom.precision} |\n| PII recall | ${dom.recall} |\n| F1 | ${dom.f1} |\n| Redaction precision (items / chars) | ${dom.redaction_precision_items} / ${dom.redaction_precision_chars} |\n| Visual context accuracy | ${dom.context_accuracy} |\n| Interactive-element precision | ${dom.context_precision} |\n| Firewall blocks (should be 0 on clean runs) | ${dom.firewall_blocks} |\n| Pipeline time per page (Node+jsdom) | mean ${dom.latency_ms.mean} ms, p95 ${dom.latency_ms.p95} ms |\n\nMisses (${dom.misses.length}): ${dom.misses.map((m) => m.type + (m.hard ? '(' + m.hard + ')' : '')).join(', ') || 'none'}\n\n## Image OCR (${visual.images} images, ${visual.pii_total} PII lines)\n| Metric | Value |\n|---|---|\n| PII precision | ${visual.precision} |\n| PII recall | ${visual.recall} |\n| F1 | ${visual.f1} |\n| OCR time / image | mean ${visual.ocr_ms_mean} ms, p95 ${visual.ocr_ms_p95} ms |\n| OCR engine init | ${visual.engine_init_ms} ms |\n| OCR language model | ${report.model_size_mb.ocr_language_data} MB |\n\nMissed: ${visual.missed.join(', ') || 'none'}\n`;
  fs.writeFileSync(path.join(root, 'reports/latest.md'), md);
  console.log(md);
})();
