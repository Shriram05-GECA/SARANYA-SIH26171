import type { Detection, PiiType } from '../types';
import { REDACTION_TOKEN } from '../types';
import { regexSpans } from './patterns';
import { classifyLabels, contextValueOk, typeFromInput } from './labels';

export const REDACTED = '[REDACTED]';

/** Prefer typed redaction token for secrets so outbound context is explicit. */
export function redactionToken(type?: PiiType): string {
  if (type && REDACTION_TOKEN[type]) return REDACTION_TOKEN[type];
  return REDACTED;
}

export interface AnalyzeCtx {
  labels?: string[];
  inputType?: string;
  autocomplete?: string;
}

export interface Analysis {
  detections: Detection[];
  redacted: string;
  sensitive: boolean;
  /** exact raw substrings that were redacted (kept in memory only, never transmitted) */
  raw: string[];
  type?: PiiType;
}

const INLINE = /^\s*([A-Za-z][A-Za-z0-9 .\/'#()-]{0,40}?)\s*[:：]\s+(\S[\s\S]*)$/;

export function applySpans(text: string, dets: { start: number; end: number; type?: PiiType }[]): string {
  let out = text;
  for (const d of [...dets].sort((a, b) => b.start - a.start)) {
    const tok = redactionToken(d.type);
    out = out.slice(0, d.start) + tok + out.slice(d.end);
  }
  return out;
}

/** True when the text itself looks like a field label (e.g. "Email", "Account Number") rather than a value. */
export function looksLikeLabel(text: string): boolean {
  const t = text.trim();
  if (t.length > 40 || /[@\d]/.test(t)) return false;
  return classifyLabels([t]) !== null;
}

/**
 * Layered analysis: value-shape regex + DOM/label context + inline "Label: value" parsing.
 * Returns detections with confidence, the redacted string, and the raw substrings redacted.
 */
export function analyzeText(text: string, ctx: AnalyzeCtx = {}): Analysis {
  const spans = regexSpans(text);
  let dets: Detection[] = [...spans];
  let ctxHit = typeFromInput(ctx.inputType, ctx.autocomplete);
  let ctxSource = 'dom';
  let valueStart = 0;

  if (!ctxHit && ctx.labels?.length && !looksLikeLabel(text)) {
    ctxHit = classifyLabels(ctx.labels);
    ctxSource = 'dom+context';
  }
  if (!ctxHit) {
    const m = INLINE.exec(text);
    if (m) {
      const hit = classifyLabels([m[1]]);
      if (hit && contextValueOk(hit.type, m[2])) {
        ctxHit = hit;
        ctxSource = 'inline-label';
        valueStart = text.length - m[2].length;
      }
    }
  }

  if (ctxHit) {
    const body = text.slice(valueStart);
    const lead = body.length - body.trimStart().length;
    const trail = body.length - body.trimEnd().length;
    const start = valueStart + lead;
    const end = text.length - trail;
    const inputSignal = ctxHit.base >= 0.95 && ctxSource === 'dom';
    if (end > start && (inputSignal || contextValueOk(ctxHit.type, text.slice(start, end)))) {
      const inside = dets.filter((d) => d.start >= start && d.end <= end);
      const agree = inside.some((d) => d.type === ctxHit!.type || d.confidence >= 0.85);
      dets = dets.filter((d) => !(d.start >= start && d.end <= end));
      dets.push({
        type: ctxHit.type,
        source: agree ? (ctxSource === 'inline-label' ? 'inline+regex' : 'dom+regex') : ctxSource,
        confidence: agree ? Math.min(0.99, Math.max(ctxHit.base, 0.95) + 0.03) : ctxHit.base,
        start, end,
      });
    }
  }

  dets.sort((a, b) => a.start - b.start);
  return {
    detections: dets,
    redacted: applySpans(text, dets),
    sensitive: dets.length > 0,
    raw: dets.map((d) => text.slice(d.start, d.end).trim()).filter((s) => s.length >= 3),
    type: dets[0]?.type,
  };
}

export function detectPii(text: string, ctx: AnalyzeCtx = {}): Detection[] {
  return analyzeText(text, ctx).detections;
}
