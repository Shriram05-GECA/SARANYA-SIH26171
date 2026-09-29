/**
 * Post-process ONNX outputs into VisionDetection[].
 * Supports detection-style tensors and classification logits (SqueezeNet)
 * combined with spatial region proposals from the canvas.
 */
import type { VisionDetection, VisionBBox } from './types';

export interface PostprocessOptions {
  confidenceThreshold: number;
  maxDetections: number;
  inputSize: number;
  originalWidth: number;
  originalHeight: number;
  scaleX: number;
  scaleY: number;
  canvas?: HTMLCanvasElement | null;
}

const UI_LABELS = ['ui_region', 'button', 'icon', 'text_region', 'card', 'input', 'image', 'other'];

function mapBox(cx: number, cy: number, w: number, h: number, opts: PostprocessOptions): VisionBBox {
  const size = opts.inputSize;
  const padX = (size - size / Math.max(opts.scaleX, 1e-6)) / 2;
  const padY = (size - size / Math.max(opts.scaleY, 1e-6)) / 2;
  const x0 = ((cx - w / 2) - padX) * opts.scaleX;
  const y0 = ((cy - h / 2) - padY) * opts.scaleY;
  const width = w * opts.scaleX;
  const height = h * opts.scaleY;
  return {
    x: Math.max(0, x0), y: Math.max(0, y0),
    width: Math.min(opts.originalWidth - Math.max(0, x0), Math.max(1, width)),
    height: Math.min(opts.originalHeight - Math.max(0, y0), Math.max(1, height)),
  };
}

function softmaxTopK(logits: Float32Array, k: number): { idx: number; score: number }[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { exps[i] = Math.exp(Math.min(20, logits[i] - max)); sum += exps[i]; }
  const scored: { idx: number; score: number }[] = [];
  for (let i = 0; i < logits.length; i++) scored.push({ idx: i, score: exps[i] / (sum || 1) });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function spatialProposals(canvas: HTMLCanvasElement, maxN: number, baseConf: number): VisionDetection[] {
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return [];
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
            const i2 = (y * w + (x + 2)) * 4;
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
    confidence: Math.min(0.95, baseConf * 0.5 + c.score * 0.5),
    bbox: { x: c.x, y: c.y, width: cellW, height: cellH },
  }));
}

export function postprocessDetections(
  output: Float32Array | number[],
  opts: PostprocessOptions,
  stride = 6,
): VisionDetection[] {
  const arr = output instanceof Float32Array ? output : new Float32Array(output);
  const dets: VisionDetection[] = [];

  if (arr.length >= stride * 3 && arr.length % stride === 0 && arr.length > 200) {
    const n = Math.floor(arr.length / stride);
    for (let i = 0; i < n; i++) {
      const base = i * stride;
      const score = arr[base + 4];
      if (score < opts.confidenceThreshold) continue;
      const bbox = mapBox(arr[base], arr[base + 1], arr[base + 2], arr[base + 3], opts);
      if (bbox.width < 4 || bbox.height < 4) continue;
      const cls = stride > 5 ? Math.round(arr[base + 5]) : 0;
      dets.push({
        label: UI_LABELS[Math.min(Math.max(0, cls), UI_LABELS.length - 1)] ?? 'ui_region',
        confidence: Math.min(1, Math.max(0, score)),
        bbox,
      });
    }
  } else {
    const top = softmaxTopK(arr, 5);
    const topScore = top[0]?.score ?? 0;
    if (opts.canvas) {
      dets.push(...spatialProposals(opts.canvas, opts.maxDetections, Math.max(0.3, topScore)));
    }
    if (topScore > opts.confidenceThreshold * 0.5) {
      dets.push({
        label: 'scene_visual',
        confidence: Math.min(0.99, topScore),
        bbox: { x: 0, y: 0, width: opts.originalWidth, height: Math.min(opts.originalHeight, Math.max(40, opts.originalHeight * 0.35)) },
      });
    }
  }
  dets.sort((a, b) => b.confidence - a.confidence);
  return dets.slice(0, opts.maxDetections);
}

export function iou(a: VisionBBox, b: VisionBBox): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
