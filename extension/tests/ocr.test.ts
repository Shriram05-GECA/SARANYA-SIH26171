import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { analyzeOcr, tessToOcr, type OcrResult } from '../src/privacy/ocr';

const w = (text: string, x0: number, y0: number) => ({ text, bbox: { x0, y0, x1: x0 + text.length * 10, y1: y0 + 20 } });
const line = (text: string, y: number): OcrResult['lines'][number] => {
  let x = 0; const words = text.split(' ').map((t) => { const o = w(t, x, y); x += t.length * 10 + 10; return o; });
  return { text, bbox: { x0: 0, y0: y, x1: x, y1: y + 20 }, words };
};
const ocr = (lines: string[]): OcrResult => ({ text: lines.join('\n'), lines: lines.map((l, i) => line(l, i * 30)), width: 800, height: 400, ms: 1 });

describe('OCR -> local privacy pipeline (pure)', () => {
  it('detects PII in image text, produces regions, redacts text', () => {
    const a = analyzeOcr(ocr(['Name: Shriram Vaidya', 'Email: shriram@example.com', 'Aadhaar: 2345 6789 0123', 'Issued by: Demo Authority']));
    expect(a.regions.length).toBe(3);
    expect(a.ocrTextRedacted).toBe('Name: [REDACTED]\nEmail: [REDACTED]\nAadhaar: [REDACTED]\nIssued by: Demo Authority');
    expect(a.flags).toContain('id_document_like');
    expect(a.rawValues.map((r) => r.value)).toContain('shriram@example.com');
  });
  it('previous-line label context only when the line is a bare label', () => {
    const a = analyzeOcr(ocr(['Email', 'shriram@example.com', 'Issued by: Demo Authority']));
    expect(a.redactedLines).toEqual(['Email', '[REDACTED]', 'Issued by: Demo Authority']);
    const b = analyzeOcr(ocr(['DOB: 14/03/2001', 'PAN: ABCDE1234F']));
    expect(b.detections.map((d) => d.type)).toEqual(['dob', 'pan']);
  });
  it('cardholder name is detected', () => {
    expect(analyzeOcr(ocr(['Cardholder: Shriram Vaidya'])).regions.length).toBe(1);
  });
  it('real Tesseract OCR on the synthetic ID card image (Node, same WASM engine as the extension)', async () => {
    const { createWorker } = await import('tesseract.js');
    const root = path.resolve(__dirname, '../../node_modules/@tesseract.js-data/eng/4.0.0_best_int');
    if (!fs.existsSync(root)) return;
    const worker = await createWorker('eng', 1, { langPath: root, gzip: true, cacheMethod: 'none' });
    const { data } = await worker.recognize(path.resolve(__dirname, '../../demo-sites/assets/id-card.png'));
    await worker.terminate();
    const a = analyzeOcr(tessToOcr(data, 840, 480, 0));
    const t = a.ocrTextRedacted;
    for (const raw of ['Shriram Vaidya', 'ABCDE1234F', '2345 6789 0123', 'shriram@example.com', '14/03/2001']) expect(t).not.toContain(raw);
    expect(a.regions.length).toBeGreaterThanOrEqual(5);
    expect(t).toContain('Issued by');
  });
});
