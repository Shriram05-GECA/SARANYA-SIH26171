import type { BBox, OcrResult, OcrRegion } from '../privacy/ocr';

const MAX_DIM = 1600;

export interface Raster { dataUrl: string; width: number; height: number; canvas: HTMLCanvasElement }

/** Rasterize an <img>/<canvas> locally. Returns null if the pixels are not readable (cross-origin taint). */
export function rasterize(el: Element): Raster | null {
  try {
    const src = el as HTMLImageElement | HTMLCanvasElement;
    const w0 = el.tagName === 'IMG' ? (src as HTMLImageElement).naturalWidth : (src as HTMLCanvasElement).width;
    const h0 = el.tagName === 'IMG' ? (src as HTMLImageElement).naturalHeight : (src as HTMLCanvasElement).height;
    if (!w0 || !h0) return null;
    const s = Math.min(1, MAX_DIM / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height, canvas: c };
  } catch { return null; }
}

export async function detectFaces(canvas: HTMLCanvasElement): Promise<BBox[] | null> {
  const FD = (window as unknown as { FaceDetector?: new (o?: object) => { detect(i: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]> } }).FaceDetector;
  if (!FD) return null;
  try {
    const faces = await new FD({ fastMode: true }).detect(canvas);
    return faces.map((f) => ({ x0: f.boundingBox.x, y0: f.boundingBox.y, x1: f.boundingBox.x + f.boundingBox.width, y1: f.boundingBox.y + f.boundingBox.height }));
  } catch { return null; }
}

/** Draws black boxes over regions; returns a data URL used ONLY for the local preview. */
export function redactedPreview(r: Raster, regions: OcrRegion[], faces: BBox[] = []): string {
  const c = document.createElement('canvas');
  c.width = r.width; c.height = r.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(r.canvas, 0, 0);
  ctx.fillStyle = '#000';
  for (const b of [...regions.map((x) => x.bbox), ...faces]) ctx.fillRect(b.x0 - 3, b.y0 - 3, b.x1 - b.x0 + 6, b.y1 - b.y0 + 6);
  return c.toDataURL('image/png');
}

export type OcrFn = (dataUrl: string) => Promise<OcrResult>;
