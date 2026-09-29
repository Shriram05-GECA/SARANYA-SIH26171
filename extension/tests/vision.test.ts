import { describe, it, expect } from 'vitest';
import { shouldRunVision } from '../src/vision/detector';
import { preprocessCanvas } from '../src/vision/preprocess';
import { postprocessDetections, iou } from '../src/vision/postprocess';
import type { VisionBBox } from '../src/vision/types';

describe('Vision adaptive decision', () => {
  it('skips CAPTCHA', () => {
    expect(shouldRunVision({ hasDomSemantics: false, isVisualHeavy: true, isCaptcha: true })).toBe(false);
  });
  it('runs on visual-heavy elements', () => {
    expect(shouldRunVision({ hasDomSemantics: true, isVisualHeavy: true, isCaptcha: false })).toBe(true);
  });
  it('runs when DOM semantics are weak', () => {
    expect(shouldRunVision({ hasDomSemantics: false, isVisualHeavy: false, isCaptcha: false })).toBe(true);
  });
  it('skips ordinary DOM-rich elements without visual hints', () => {
    expect(shouldRunVision({ hasDomSemantics: true, isVisualHeavy: false, isCaptcha: false, taskHintsVisual: false })).toBe(false);
  });
  it('runs when task hints visual content', () => {
    expect(shouldRunVision({ hasDomSemantics: true, isVisualHeavy: false, isCaptcha: false, taskHintsVisual: true })).toBe(true);
  });
});

describe('Vision preprocess', () => {
  it('produces NCHW float32 tensor of expected size', () => {
    // jsdom may not fully support canvas; guard the test
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 80;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 100, 80);
    const pre = preprocessCanvas(c, 64);
    expect(pre.tensor.length).toBe(3 * 64 * 64);
    expect(pre.width).toBe(64);
    expect(pre.height).toBe(64);
  });
});

describe('Vision postprocess', () => {
  it('filters by confidence and maps labels', () => {
    // Fake detector output: [cx, cy, w, h, score, class] x 2
    const raw = new Float32Array([
      32, 32, 20, 10, 0.9, 1, // button-like
      10, 10, 5, 5, 0.1, 0, // low confidence → dropped
    ]);
    const dets = postprocessDetections(raw, {
      confidenceThreshold: 0.25,
      maxDetections: 10,
      inputSize: 64,
      originalWidth: 100,
      originalHeight: 100,
      scaleX: 1,
      scaleY: 1,
    }, 6);
    expect(dets.length).toBe(1);
    expect(dets[0].confidence).toBeGreaterThan(0.8);
    expect(dets[0].label).toBeTruthy();
  });
});

describe('IoU helper', () => {
  it('computes intersection over union', () => {
    const a: VisionBBox = { x: 0, y: 0, width: 10, height: 10 };
    const b: VisionBBox = { x: 5, y: 5, width: 10, height: 10 };
    const v = iou(a, b);
    expect(v).toBeGreaterThan(0.1);
    expect(v).toBeLessThan(0.5);
  });
});
