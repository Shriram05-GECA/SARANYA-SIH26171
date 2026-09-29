/**
 * Image preprocessing for the local ONNX vision model.
 * Converts a canvas / ImageData into a float32 NCHW tensor (normalized).
 */

export interface PreprocessResult {
  tensor: Float32Array;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Letterbox-resize a canvas to `size x size` and produce an NCHW float32 tensor
 * normalized to [0, 1] (common for many lightweight detectors).
 */
export function preprocessCanvas(
  canvas: HTMLCanvasElement,
  size: number,
): PreprocessResult {
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (!srcW || !srcH) {
    return {
      tensor: new Float32Array(3 * size * size),
      width: size,
      height: size,
      scaleX: 1,
      scaleY: 1,
    };
  }

  const scale = Math.min(size / srcW, size / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padX = (size - newW) / 2;
  const padY = (size - newH) / 2;

  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const ctx = off.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(canvas, padX, padY, newW, newH);

  const imageData = ctx.getImageData(0, 0, size, size);
  const { data } = imageData;
  const tensor = new Float32Array(3 * size * size);
  const plane = size * size;

  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    tensor[i] = r;
    tensor[plane + i] = g;
    tensor[2 * plane + i] = b;
  }

  return {
    tensor,
    width: size,
    height: size,
    scaleX: srcW / newW,
    scaleY: srcH / newH,
  };
}

/** Convert a data-URL image into a canvas for preprocessing. */
export async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      if (!c.width || !c.height) {
        resolve(null);
        return;
      }
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
