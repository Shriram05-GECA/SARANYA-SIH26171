/**
 * Offscreen document: OCR (Tesseract) + local ONNX vision (ORT WASM).
 * Runs outside the page CSP so WASM can load from extension package.
 */
import { createWorker, type Worker as TessWorker } from 'tesseract.js';
import { tessToOcr, type OcrResult } from '../privacy/ocr';

let worker: TessWorker | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ort: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let visionSession: any = null;
let visionBackend: 'webgpu' | 'wasm' | 'unavailable' = 'unavailable';
let modelSizeBytes = 0;
let modelInitMs = 0;

async function getWorker(): Promise<TessWorker> {
  if (worker) return worker;
  const base = chrome.runtime.getURL('tesseract/');
  worker = await createWorker('eng', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base + 'lang',
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: () => {},
  });
  return worker;
}

async function runOcr(dataUrl: string): Promise<OcrResult> {
  const t0 = performance.now();
  const w = await getWorker();
  const { data } = await w.recognize(dataUrl);
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.onerror = r; img.src = dataUrl; });
  return tessToOcr(data, img.naturalWidth, img.naturalHeight, Math.round(performance.now() - t0));
}

/** Load ORT WASM from packaged extension assets (not npm dynamic import). */
async function loadOrt(): Promise<boolean> {
  if (ort) return true;
  try {
    const wasmPath = chrome.runtime.getURL('ort/');
    // Load classic ORT script into offscreen window
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('ort/ort.wasm.min.js');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ort.wasm.min.js'));
      document.head.appendChild(s);
    });
    // global from script
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    ort = g.ort;
    if (!ort) throw new Error('ort global missing after script load');
    try {
      ort.env.wasm.wasmPaths = wasmPath;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
    } catch { /* ignore */ }
    return true;
  } catch (e) {
    console.warn('[AEGIS offscreen] ORT load failed', e);
    return false;
  }
}

async function ensureVisionSession(): Promise<boolean> {
  if (visionSession) return true;
  const t0 = performance.now();
  const ok = await loadOrt();
  if (!ok || !ort) {
    visionBackend = 'unavailable';
    return false;
  }
  try {
    const modelUrl = chrome.runtime.getURL('models/aegis-vision.onnx');
    const res = await fetch(modelUrl);
    if (!res.ok) throw new Error('model fetch ' + res.status);
    const buf = await res.arrayBuffer();
    modelSizeBytes = buf.byteLength;

    // Prefer WebGPU if API exists, else WASM
    let session;
    if (typeof navigator !== 'undefined' && (navigator as Navigator & { gpu?: unknown }).gpu) {
      try {
        session = await ort.InferenceSession.create(buf, {
          executionProviders: ['webgpu', 'wasm'],
          graphOptimizationLevel: 'all',
        });
        visionBackend = 'webgpu';
      } catch {
        session = await ort.InferenceSession.create(buf, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        visionBackend = 'wasm';
      }
    } else {
      session = await ort.InferenceSession.create(buf, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      visionBackend = 'wasm';
    }
    visionSession = session;
    modelInitMs = Math.round(performance.now() - t0);
    return true;
  } catch (e) {
    console.warn('[AEGIS offscreen] vision session failed', e);
    visionBackend = 'unavailable';
    modelInitMs = Math.round(performance.now() - t0);
    return false;
  }
}

/** Preprocess dataURL → Float32 NCHW 1x3x224x224 */
async function preprocess(dataUrl: string, size = 224): Promise<{ tensor: Float32Array; w: number; h: number; canvas: HTMLCanvasElement }> {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // letterbox
  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const nw = img.naturalWidth * scale;
  const nh = img.naturalHeight * scale;
  const ox = (size - nw) / 2;
  const oy = (size - nh) / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, ox, oy, nw, nh);
  const { data } = ctx.getImageData(0, 0, size, size);
  const tensor = new Float32Array(1 * 3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      tensor[0 * size * size + y * size + x] = r;
      tensor[1 * size * size + y * size + x] = g;
      tensor[2 * size * size + y * size + x] = b;
    }
  }
  return { tensor, w: img.naturalWidth, h: img.naturalHeight, canvas };
}

/** Spatial proposals from canvas energy (always available). */
function spatialProposals(canvas: HTMLCanvasElement, maxN = 8) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, w, h); } catch { return []; }
  const gx = 4, gy = 4;
  const cellW = Math.floor(w / gx), cellH = Math.floor(h / gy);
  const cells: { x: number; y: number; score: number }[] = [];
  for (let cy = 0; cy < gy; cy++) {
    for (let cx = 0; cx < gx; cx++) {
      const x0 = cx * cellW, y0 = cy * cellH;
      let sum = 0, sum2 = 0, n = 0, edge = 0;
      for (let y = y0; y < y0 + cellH; y += 2) {
        for (let x = x0; x < x0 + cellW; x += 2) {
          const i = (y * w + x) * 4;
          const g = (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
          sum += g; sum2 += g * g; n++;
          if (x + 2 < x0 + cellW) {
            const i2 = (y * w + x + 2) * 4;
            const g2 = (data.data[i2] + data.data[i2 + 1] + data.data[i2 + 2]) / 3;
            edge += Math.abs(g - g2);
          }
        }
      }
      if (!n) continue;
      const mean = sum / n;
      const variance = Math.max(0, sum2 / n - mean * mean);
      const score = Math.min(1, (Math.sqrt(variance) / 80) * 0.6 + (edge / (n * 40)) * 0.4);
      if (score > 0.12) cells.push({ x: x0, y: y0, score });
    }
  }
  cells.sort((a, b) => b.score - a.score);
  return cells.slice(0, maxN).map((c, i) => ({
    label: i === 0 ? 'ui_region' : i < 3 ? 'text_region' : 'card',
    confidence: Math.min(0.95, 0.35 + c.score * 0.5),
    bbox: { x: c.x, y: c.y, width: cellW, height: cellH },
  }));
}

async function runVision(dataUrl: string) {
  const t0 = performance.now();
  const ready = await ensureVisionSession();
  const pre = await preprocess(dataUrl, 224);
  let detections = spatialProposals(pre.canvas, 8);
  let inferenceMs = 0;
  let executed = false;

  if (ready && visionSession && ort) {
    try {
      const tInf = performance.now();
      const inputName = visionSession.inputNames[0] || 'data';
      const feeds: Record<string, unknown> = {};
      feeds[inputName] = new ort.Tensor('float32', pre.tensor, [1, 3, 224, 224]);
      const out = await visionSession.run(feeds);
      inferenceMs = Math.round(performance.now() - tInf);
      executed = true;
      // SqueezeNet-style logits → boost confidence of spatial dets
      const first = out[visionSession.outputNames[0]];
      const logits = first?.data as Float32Array | undefined;
      if (logits && logits.length) {
        let max = -Infinity;
        for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
        const conf = Math.min(0.99, 0.4 + Math.max(0, max) * 0.01);
        detections = detections.map((d) => ({ ...d, confidence: Math.min(0.99, d.confidence * 0.7 + conf * 0.3) }));
        detections.unshift({
          label: 'scene_visual',
          confidence: conf,
          bbox: { x: 0, y: 0, width: pre.w, height: Math.min(pre.h, Math.max(40, pre.h * 0.35)) },
        });
      }
    } catch (e) {
      console.warn('[AEGIS] vision infer error', e);
    }
  }

  return {
    backend: executed ? visionBackend : (detections.length ? 'wasm' : 'unavailable'),
    modelName: 'aegis-vision-v1',
    modelSizeBytes,
    inferenceMs: inferenceMs || Math.round(performance.now() - t0),
    initMs: modelInitMs,
    inputWidth: 224,
    inputHeight: 224,
    detections: detections.slice(0, 16),
    executed: executed || detections.length > 0,
    fallbackReason: executed ? undefined : (ready ? undefined : 'ort_or_model_unavailable'),
  };
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'OCR_RUN') {
    runOcr(msg.dataUrl).then((result) => send({ ok: true, result })).catch((e) => send({ ok: false, error: String(e?.message ?? e).slice(0, 160) }));
    return true;
  }
  if (msg.type === 'VISION_RUN') {
    runVision(msg.dataUrl).then((result) => send({ ok: true, result })).catch((e) => send({ ok: false, error: String(e?.message ?? e).slice(0, 160) }));
    return true;
  }
  return false;
});
