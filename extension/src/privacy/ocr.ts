import type { Detection, PiiType } from '../types';
import { analyzeText, looksLikeLabel } from './detector';

export interface BBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; bbox: BBox; confidence?: number }
export interface OcrLine { text: string; bbox: BBox; words: OcrWord[] }
export interface OcrResult { text: string; lines: OcrLine[]; width: number; height: number; ms: number }

export interface OcrRegion { bbox: BBox; type: PiiType; confidence: number; source: string }
export interface VisualAnalysis {
  redactedLines: string[];
  originalLines: string[];
  regions: OcrRegion[];
  rawValues: { value: string; type: string }[];
  ocrTextRedacted: string;
  flags: string[];
  detections: Detection[];
  rows: { original: string; redacted: string; raw: string[]; types: PiiType[]; confidence: number; source: string }[];
}

const DOC_KEYWORDS = /government of india|income tax department|permanent account number|aadhaar|unique identification|driving licen[cs]e|passport|identity card|voter|republic of india/i;

const union = (bs: BBox[]): BBox => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

/** Pure: OCR output -> redaction regions + redacted text. Runs the same detector as the DOM path. */
export function analyzeOcr(ocr: OcrResult): VisualAnalysis {
  const out: VisualAnalysis = {
    redactedLines: [], originalLines: [], regions: [], rawValues: [], ocrTextRedacted: '', flags: [], detections: [], rows: [],
  };
  let prev = '';
  for (const line of ocr.lines) {
    const words = line.words.filter((w) => w.text.trim());
    if (!words.length) continue;
    let text = '';
    const offs: { s: number; e: number; w: OcrWord }[] = [];
    for (const w of words) {
      if (text) text += ' ';
      offs.push({ s: text.length, e: text.length + w.text.length, w });
      text += w.text;
    }
    const a = analyzeText(text, { labels: prev && looksLikeLabel(prev) ? [prev] : [] });
    out.originalLines.push(text);
    out.redactedLines.push(a.redacted);
    for (const d of a.detections) {
      const hit = offs.filter((o) => o.s < d.end && d.start < o.e).map((o) => o.w.bbox);
      if (hit.length) out.regions.push({ bbox: union(hit), type: d.type, confidence: d.confidence, source: 'ocr+' + d.source });
      out.rawValues.push({ value: text.slice(d.start, d.end).trim(), type: d.type });
      out.detections.push(d);
    }
    if (a.sensitive) out.rows.push({ original: text, redacted: a.redacted, raw: a.raw, types: a.detections.map((d) => d.type), confidence: Math.max(...a.detections.map((d) => d.confidence)), source: 'ocr+' + a.detections[0].source });
    prev = text;
  }
  out.ocrTextRedacted = out.redactedLines.join('\n');
  const types = new Set(out.detections.map((d) => d.type));
  if (types.size >= 2 || DOC_KEYWORDS.test(out.originalLines.join(' '))) out.flags.push('id_document_like');
  if (out.detections.length) out.flags.push('sensitive_text_in_image');
  return out;
}

/** Adapter for Tesseract.js v5 recognize() output (data.lines[].words[]). Keeps only text + boxes. */
export function tessToOcr(data: any, width: number, height: number, ms: number): OcrResult {
  const src: any[] = data.lines ?? (data.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((p: any) => p.lines));
  const lines: OcrLine[] = src.map((l: any) => ({
    text: String(l.text ?? '').trim(),
    bbox: l.bbox,
    words: (l.words ?? []).map((w: any): OcrWord => ({ text: String(w.text ?? ''), bbox: w.bbox, confidence: w.confidence })),
  }));
  return { text: String(data.text ?? ''), lines, width, height, ms };
}
