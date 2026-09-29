/**
 * Local ONNX vision model loader for AEGIS (SIH26171).
 *
 * - Model is packaged with the extension (models/aegis-vision.onnx).
 * - No remote model download required for the final demo.
 * - Page pixels never leave the device for inference.
 * - Role: visual grounding (regions), combined with DOM + OCR.
 */

import { createSession, runInference, type SessionHandle } from './runtime';
import { preprocessCanvas, dataUrlToCanvas } from './preprocess';
import { postprocessDetections } from './postprocess';
import type { VisionResult, VisionConfig, VisionStats, VisionBackend } from './types';

const DEFAULT_CONFIG: VisionConfig = {
  preferWebGPU: true,
  confidenceThreshold: 0.2,
  maxDetections: 16,
  inputSize: 224,
};

/** Packaged with the extension — no runtime remote download. */
const LOCAL_MODEL_PATH = typeof chrome !== 'undefined' && chrome.runtime?.getURL
  ? chrome.runtime.getURL('models/aegis-vision.onnx')
  : 'models/aegis-vision.onnx';

const MODEL_NAME = 'aegis-vision-v1';
const MODEL_VERSION = '1.0.0';

let sessionHandle: SessionHandle | null = null;
let initPromise: Promise<SessionHandle | null> | null = null;
let lastBackend: VisionBackend = 'unavailable';
let lastInitMs = 0;
let inferenceLatencies: number[] = [];
let modelSizeBytes = 0;
let modelSource = 'none';

function percentile(arr: number[], p: number): number | undefined {
  if (!arr.length) return undefined;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[idx] * 10) / 10;
}

async function fetchLocalModel(): Promise<{ buffer: ArrayBuffer; size: number }> {
  const res = await fetch(LOCAL_MODEL_PATH);
  if (!res.ok) {
    throw new Error(`Local vision model missing (${res.status}). Place aegis-vision.onnx under extension/models/.`);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 100) {
    throw new Error('Local vision model file is empty or invalid');
  }
  return { buffer, size: buffer.byteLength };
}

export async function ensureSession(cfg: VisionConfig = DEFAULT_CONFIG): Promise<SessionHandle | null> {
  if (sessionHandle) return sessionHandle;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const t0 = performance.now();
    try {
      const { buffer, size } = await fetchLocalModel();
      modelSizeBytes = size;
      modelSource = 'extension-local';
      const handle = await createSession(buffer, { preferWebGPU: cfg.preferWebGPU });
      sessionHandle = handle;
      lastBackend = handle.backend;
      lastInitMs = Math.round((performance.now() - t0) * 10) / 10;
      return handle;
    } catch (e) {
      lastBackend = 'unavailable';
      lastInitMs = Math.round((performance.now() - t0) * 10) / 10;
      console.warn('[AEGIS vision] model init failed:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Run the learned visual model on a canvas or data-URL.
 * Always reports the backend that actually executed (or unavailable).
 */
export async function runVision(
  source: HTMLCanvasElement | string,
  cfg: VisionConfig = DEFAULT_CONFIG,
): Promise<VisionResult> {
  const t0 = performance.now();
  const handle = await ensureSession(cfg);

  if (!handle) {
    return {
      backend: 'unavailable',
      modelName: MODEL_NAME,
      modelSizeBytes,
      inferenceMs: 0,
      initMs: lastInitMs,
      inputWidth: cfg.inputSize,
      inputHeight: cfg.inputSize,
      detections: [],
      executed: false,
      fallbackReason: 'model_session_unavailable',
    };
  }

  let canvas: HTMLCanvasElement | null =
    typeof source === 'string' ? await dataUrlToCanvas(source) : source;
  if (!canvas || !canvas.width || !canvas.height) {
    return {
      backend: handle.backend,
      modelName: MODEL_NAME,
      modelSizeBytes,
      inferenceMs: 0,
      initMs: lastInitMs,
      inputWidth: cfg.inputSize,
      inputHeight: cfg.inputSize,
      detections: [],
      executed: false,
      fallbackReason: 'image_unreadable',
    };
  }

  const origW = canvas.width;
  const origH = canvas.height;
  const pre = preprocessCanvas(canvas, cfg.inputSize);

  try {
    const tInf = performance.now();
    // NCHW [1, 3, H, W]
    const dims = [1, 3, cfg.inputSize, cfg.inputSize];
    const rawOut = await runInference(handle, pre.tensor, dims);
    const inferenceMs = Math.round((performance.now() - tInf) * 10) / 10;
    inferenceLatencies.push(inferenceMs);
    if (inferenceLatencies.length > 64) inferenceLatencies.shift();

    const detections = postprocessDetections(rawOut, {
      confidenceThreshold: cfg.confidenceThreshold,
      maxDetections: cfg.maxDetections,
      inputSize: cfg.inputSize,
      originalWidth: origW,
      originalHeight: origH,
      scaleX: pre.scaleX,
      scaleY: pre.scaleY,
      canvas,
    });

    lastBackend = handle.backend;

    return {
      backend: handle.backend,
      modelName: MODEL_NAME,
      modelSizeBytes,
      inferenceMs,
      initMs: lastInitMs,
      inputWidth: cfg.inputSize,
      inputHeight: cfg.inputSize,
      detections,
      executed: true,
    };
  } catch (e) {
    return {
      backend: handle.backend,
      modelName: MODEL_NAME,
      modelSizeBytes,
      inferenceMs: Math.round((performance.now() - t0) * 10) / 10,
      initMs: lastInitMs,
      inputWidth: cfg.inputSize,
      inputHeight: cfg.inputSize,
      detections: [],
      executed: false,
      fallbackReason: e instanceof Error ? e.message.slice(0, 120) : 'inference_error',
    };
  }
}

export function getVisionStats(): VisionStats {
  const lats = inferenceLatencies;
  const mean = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : undefined;
  return {
    available: lastBackend !== 'unavailable' && sessionHandle !== null,
    backend: lastBackend,
    modelName: MODEL_NAME,
    modelSizeBytes,
    initMs: lastInitMs || undefined,
    inferenceCount: lats.length,
    lastInferenceMs: lats.length ? lats[lats.length - 1] : undefined,
    meanInferenceMs: mean !== undefined ? Math.round(mean * 10) / 10 : undefined,
    p50InferenceMs: percentile(lats, 50),
    p95InferenceMs: percentile(lats, 95),
    inputWidth: DEFAULT_CONFIG.inputSize,
    inputHeight: DEFAULT_CONFIG.inputSize,
  };
}

export function getModelMeta() {
  return {
    name: MODEL_NAME,
    version: MODEL_VERSION,
    sizeBytes: modelSizeBytes,
    source: modelSource,
    backend: lastBackend,
    initMs: lastInitMs,
  };
}

export function resetVisionState(): void {
  sessionHandle = null;
  initPromise = null;
  lastBackend = 'unavailable';
  lastInitMs = 0;
  inferenceLatencies = [];
  modelSizeBytes = 0;
  modelSource = 'none';
}
