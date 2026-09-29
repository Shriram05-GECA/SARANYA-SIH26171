import type { AgentAction, PerceiveResult, StageTimings } from '../types';
import { scanDocument, mergeVisual, finalizePayload, hash, type ScanResult } from './extractor';
import { rasterize, detectFaces, redactedPreview, type OcrFn } from './visual';
import { analyzeOcr, type OcrResult } from '../privacy/ocr';
import { verifyPayload, expandRawValues } from '../privacy/firewall';
import { validateAction, type TargetInfo } from '../actions/validator';
import { executeAction } from '../actions/executor';
import { collectResources, heapNow, now, round, safeError } from '../utils/env';
import { detectVisualRegions, shouldRunVision, getVisionStats } from '../vision';
import { isCaptchaEl } from './extractor';
import { mountFloatingUi } from './floating-ui';

declare global { interface Window { __aegis?: boolean } }

interface Last { scan: ScanResult; previews: { id: string; dataUrl: string; regions: number; faces: number }[]; assets?: { ocr_model_size_mb?: number; engine?: string } }
let last: Last | null = null;
let dirty = true;
const ocrCache = new Map<string, OcrResult>();

const ocrViaBackground: OcrFn = async (dataUrl) => {
  const r = await chrome.runtime.sendMessage({ type: 'OCR_IMAGE', dataUrl });
  if (!r?.ok) throw new Error(r?.error || 'ocr_failed');
  return r.result as OcrResult;
};

async function perceive(task: string): Promise<PerceiveResult> {
  const t0 = now();
  const heap0 = heapNow();
  const scan = scanDocument(document, { layout: true });
  const previews: Last['previews'] = [];
  let ocrMs = 0;
  let visionMs = 0;
  let visuals = 0;
  let visionExecuted = false;
  let visionBackend = 'unavailable';
  let visionDetections = 0;
  let visionModelName: string | undefined;
  let visionInferenceMs = 0;
  let visionModelSizeMb: number | undefined;
  const visionDetList: { label: string; confidence: number; bbox: { x: number; y: number; width: number; height: number } }[] = [];
  let cvUsed = false;
  let ocrUsed = false;
  let faceUsed = false;
  const taskHintsVisual = /visual|image|screenshot|canvas|icon|picture|photo|captcha|scan/i.test(task);

  for (const target of scan.visualTargets.slice(0, 4)) {
    // CAPTCHA protection: skip before CV and OCR
    if (isCaptchaEl(target.el)) {
      mergeVisual(scan, target.id, { status: 'skipped_captcha' });
      continue;
    }
    const raster = rasterize(target.el);
    if (!raster) { mergeVisual(scan, target.id, { status: 'unavailable' }); continue; }
    visuals++;
    try {
      const tag = target.el.tagName.toLowerCase();
      const isVisualHeavy = tag === 'canvas' || tag === 'img';
      const hasDomSemantics = !!(target.el.getAttribute('role') || target.el.getAttribute('aria-label') || (target.el.textContent || '').trim());
      const flags: string[] = [];
      let regionsCount = 0;
      let faces: { x0: number; y0: number; x1: number; y1: number }[] | null = null;

      // Stage 2 — Local CV (adaptive)
      const forceDemo = !!document.querySelector('meta[name="aegis-demo"]') || /localhost|127\.0\.0\.1/.test(location.hostname);
      const runCv = shouldRunVision({ hasDomSemantics, isVisualHeavy, isCaptcha: false, taskHintsVisual, forceDemo });
      if (runCv) {
        const tV = now();
        const vRes = await detectVisualRegions(raster.canvas);
        visionMs += now() - tV;
        cvUsed = true;
        if (vRes.executed) {
          visionExecuted = true;
          visionBackend = vRes.backend;
          visionModelName = vRes.modelName;
          visionDetections += vRes.detections.length;
          visionInferenceMs += vRes.inferenceMs || 0;
          if (vRes.modelSizeBytes) visionModelSizeMb = Math.round((vRes.modelSizeBytes / 1048576) * 10) / 10;
          regionsCount += vRes.detections.length;
          flags.push('vision_' + vRes.backend);
          if (vRes.detections.length) flags.push('vision_dets_' + vRes.detections.length);
          for (const d of vRes.detections.slice(0, 12)) {
            visionDetList.push({
              label: String(d.label || 'ui_region').slice(0, 40),
              confidence: Math.round((d.confidence || 0) * 1000) / 1000,
              bbox: {
                x: Math.round(d.bbox?.x ?? 0),
                y: Math.round(d.bbox?.y ?? 0),
                width: Math.round(d.bbox?.width ?? 0),
                height: Math.round(d.bbox?.height ?? 0),
              },
            });
          }
        } else if (vRes.fallbackReason) {
          flags.push('vision_fallback');
        }
      }

      // Stage 3 — OCR only when visual text is useful
      const needOcr = isVisualHeavy || taskHintsVisual || flags.some((f) => f.startsWith('vision_'));
      let an = { ocrTextRedacted: '', regions: [] as { bbox: { x0: number; y0: number; x1: number; y1: number } }[], flags: [] as string[], detections: [] as unknown[], rawValues: [] as string[], rows: [] as unknown[] };
      if (needOcr) {
        const key = String(raster.dataUrl.length) + ':' + hash(raster.dataUrl);
        let ocr = ocrCache.get(key);
        if (!ocr) { const t1 = now(); ocr = await ocrViaBackground(raster.dataUrl); ocrMs += now() - t1; ocrCache.set(key, ocr); }
        an = analyzeOcr(ocr) as typeof an;
        ocrUsed = true;
        faces = await detectFaces(raster.canvas);
        if (faces?.length) { faceUsed = true; flags.push('face_detected'); }
        flags.push(...an.flags);
        regionsCount += an.regions.length + (faces?.length ?? 0);
      }

      mergeVisual(scan, target.id, {
        status: 'ok', ocrText: an.ocrTextRedacted, regions: regionsCount, flags,
        rawValues: an.rawValues, rows: an.rows as never[],
      });
      previews.push({ id: target.id, dataUrl: redactedPreview(raster, an.regions as never[], faces ?? []), regions: an.regions.length, faces: faces?.length ?? 0 });
    } catch (e) {
      mergeVisual(scan, target.id, { status: 'failed' });
      console.warn('[AEGIS] visual pipeline failed:', safeError(e));
    }
  }


  // SIH: if no <img> targets, still run local CV on a viewport snapshot (demo/localhost)
  const forcePageCv = !!document.querySelector('meta[name="aegis-demo"]') || /localhost|127\.0\.0\.1/.test(location.hostname);
  if (forcePageCv && !cvUsed) {
    try {
      const tV = now();
      const vw = Math.min(window.innerWidth || 800, 960);
      const vh = Math.min(window.innerHeight || 600, 720);
      const snap = document.createElement('canvas');
      snap.width = vw;
      snap.height = vh;
      const sctx = snap.getContext('2d');
      if (sctx) {
        sctx.fillStyle = '#f8fafc';
        sctx.fillRect(0, 0, vw, vh);
        // Draw visible text-ish blocks as proxy if html2canvas unavailable — use element rects
        const nodes = Array.from(document.querySelectorAll('button, a, input, h1, h2, h3, table, .card, main, section')).slice(0, 40);
        for (const n of nodes) {
          const r = (n as HTMLElement).getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
          sctx.fillStyle = n.tagName === 'INPUT' ? '#e2e8f0' : n.tagName === 'BUTTON' || n.tagName === 'A' ? '#0e7490' : '#cbd5e1';
          sctx.globalAlpha = 0.85;
          sctx.fillRect(r.left, r.top, Math.min(r.width, vw - r.left), Math.min(r.height, vh - r.top));
        }
        sctx.globalAlpha = 1;
        const vRes = await detectVisualRegions(snap);
        visionMs += now() - tV;
        cvUsed = true;
        if (vRes.executed) {
          visionExecuted = true;
          visionBackend = vRes.backend;
          visionModelName = vRes.modelName || 'aegis-vision-v1';
          visionDetections += vRes.detections.length;
          visionInferenceMs += vRes.inferenceMs || 0;
          if (vRes.modelSizeBytes) visionModelSizeMb = Math.round((vRes.modelSizeBytes / 1048576) * 10) / 10;
          for (const d of vRes.detections.slice(0, 12)) {
            visionDetList.push({
              label: String(d.label || 'ui_region').slice(0, 40),
              confidence: Math.round((d.confidence || 0) * 1000) / 1000,
              bbox: {
                x: Math.round(d.bbox?.x ?? 0),
                y: Math.round(d.bbox?.y ?? 0),
                width: Math.round(d.bbox?.width ?? 0),
                height: Math.round(d.bbox?.height ?? 0),
              },
            });
          }
        }
      }
    } catch (e) {
      console.warn('[AEGIS] page CV snapshot failed:', safeError(e));
    }
  }

  const f0 = now();
  const { payload, raw, redactions } = finalizePayload(scan, task);
  // Attach sanitized visual context (no pixels) for remote reasoner + SIH metrics
  payload.visual = {
    used: visionExecuted,
    backend: (visionBackend as 'webgpu' | 'wasm' | 'cpu' | 'unavailable') || 'unavailable',
    model: visionModelName,
    model_size_mb: visionModelSizeMb,
    inference_ms: visionExecuted ? round(visionInferenceMs || visionMs) : undefined,
    detections: visionDetList.slice(0, 16),
    scene_summary: visionExecuted
      ? (visionDetList.length
          ? `Local CV (${visionBackend}): ${visionDetList.length} region(s) — ` +
            visionDetList.slice(0, 5).map((d) => d.label).join(', ')
          : `Local CV ran (${visionBackend}); no high-confidence regions`)
      : 'Local CV not required (DOM-first adaptive path)',
    trace: {
      DOM_USED: true,
      CV_USED: cvUsed,
      OCR_USED: ocrUsed,
      FACE_DETECTION_USED: faceUsed,
    },
  };
  const finalizeMs = now() - f0;
  const v0 = now();
  const report = verifyPayload(payload, raw);
  const verifyMs = now() - v0;
  last = { scan, previews };
  dirty = false;

  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  const byType: Record<string, number> = {};
  for (const e of scan.rawEntries) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const timings: StageTimings = {
    dom_scan_ms: round(scan.timings.dom_scan_ms),
    ...(ocrUsed ? { ocr_ms: round(ocrMs) } : {}),
    ...(cvUsed ? { vision_ms: round(visionMs) } : {}),
    detect_ms: round(scan.timings.detect_ms),
    redact_ms: round(scan.timings.redact_ms + finalizeMs),
    verify_ms: round(verifyMs),
    perception_total_ms: round(now() - t0),
  };
  const assets = await chrome.runtime.sendMessage({ type: 'GET_ASSETS' }).catch(() => null);
  const resources = await collectResources(bytes, scan.rawHtmlBytes, heap0);
  if (assets?.ocr_model_size_mb) { resources.ocr_model_size_mb = assets.ocr_model_size_mb; resources.ocr_engine = assets.engine; resources.ocr_available = true; }
  const vStats = getVisionStats();
  resources.vision_backend = (visionBackend as 'webgpu' | 'wasm' | 'cpu' | 'unavailable') || vStats.backend;
  resources.vision_model_name = visionModelName || vStats.modelName;
  resources.vision_model_size_mb = vStats.modelSizeBytes ? Math.round((vStats.modelSizeBytes / 1048576) * 10) / 10 : undefined;
  resources.vision_available = visionExecuted || vStats.available;
  resources.vision_inference_ms = visionExecuted ? round(visionMs) : vStats.lastInferenceMs;
  resources.vision_init_ms = vStats.initMs;
  resources.vision_input = vStats.inputWidth ? `${vStats.inputWidth}x${vStats.inputHeight}` : undefined;
  resources.webgpu_inference_active = visionBackend === 'webgpu';
  resources.perception_trace = {
    DOM_USED: true,
    CV_USED: cvUsed,
    OCR_USED: ocrUsed,
    FACE_DETECTION_USED: faceUsed,
    cv_reason: cvUsed ? (taskHintsVisual ? 'task_hints_visual' : 'adaptive_visual') : 'dom_sufficient',
    ocr_reason: ocrUsed ? 'visual_text_needed' : 'skipped',
  };
  const stats = {
    elements: payload.page.elements.length,
    sensitive_items: scan.rawEntries.length,
    redacted: redactions,
    by_type: byType,
    visuals,
    vision: { executed: visionExecuted, backend: visionBackend, detections: visionDetections, modelName: visionModelName },
  };
  void expandRawValues;
  if (!report.allowed) return { ok: true, blocked: true, report, timings, resources, stats };
  return { ok: true, payload, report, timings, resources, stats };
}

function describe(id: string): TargetInfo | null {
  const e = last?.scan.registry.get(id);
  if (!e) return null;
  const el = e.el as HTMLElement;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    exists: true, connected: el.isConnected,
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && (cs.display === 'contents' || !(r.width === 0 && r.height === 0)),
    disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
    tag: el.tagName.toLowerCase(), kind: e.kind, inputType: el.getAttribute('type')?.toLowerCase() ?? undefined,
    sensitive: e.sensitive, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    options: el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map((o) => o.text) : undefined,
    fingerprintMatches: e.recompute() === e.fingerprint,
  };
}

async function execute(raw: unknown) {
  const v0 = now();
  const v = validateAction(raw, { origin: location.origin, getTarget: describe });
  const validateMs = round(now() - v0);
  if (!v.allowed || !v.action) return { ok: true, validation: v, validate_ms: validateMs, execution: { executed: false, detail: 'blocked by local validation' } };
  const el = v.action.element_id ? last?.scan.registry.get(v.action.element_id)?.el ?? null : null;
  const e0 = now();
  const execution = await executeAction(document, v.action, el);
  return { ok: true, validation: v, validate_ms: validateMs, exec_ms: round(now() - e0), execution };
}

function setHighlight(on: boolean) {
  document.querySelectorAll('[data-aegis-sensitive]').forEach((el) => {
    const h = el as HTMLElement;
    h.style.outline = on ? '2px dashed #d92d20' : '';
    h.style.background = on ? 'rgba(217,45,32,.10)' : '';
  });
}

function init() {
  try { mountFloatingUi(); } catch (e) { console.warn('[AEGIS] floating UI:', e); }
  new MutationObserver(() => { dirty = true; }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg?.target === 'offscreen' || msg?.target === 'background') return false;
    (async () => {
      switch (msg?.type) {
        case 'PING': return { ok: true, dirty };
        case 'PERCEIVE': return perceive(String(msg.task ?? ''));
        case 'EXECUTE': return execute(msg.action);
        case 'HIGHLIGHT': { if (!last) await perceive(''); setHighlight(!!msg.on); return { ok: true }; }
        case 'LOCAL_PREVIEW': {
          if (!last || dirty) await perceive(String(msg.task ?? ''));
          return { ok: true, rows: last!.scan.rows, images: last!.previews, page_type: last!.scan.page.page_type };
        }
        default: return { ok: false, error: 'unknown_message' };
      }
    })().then(send).catch((e) => send({ ok: false, error: safeError(e) }));
    return true;
  });
}

if (!window.__aegis) { window.__aegis = true; init(); }
export type { AgentAction };
