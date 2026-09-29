import type { Detection, PiiType } from '../types';

export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

interface PatternSpec {
  type: PiiType;
  re: RegExp;
  confidence: number;
  source?: string;
  validate?: (m: RegExpMatchArray) => boolean;
  span?: (m: RegExpMatchArray) => [number, number];
}

const NOT_NAME = new Set(['customer', 'user', 'sir', 'madam', 'applicant', 'team', 'everyone', 'there', 'guest', 'admin', 'friend']);

/** Value-shape patterns (no context needed). Indian formats first-class. */
export const VALUE_PATTERNS: PatternSpec[] = [
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, confidence: 0.98 },
  {
    type: 'card', re: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g, confidence: 0.95,
    validate: (m) => { const d = m[0].replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); },
  },
  { type: 'phone', re: /(?<!\d)(?:(?:\+|00)?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, confidence: 0.9 },
  { type: 'aadhaar', re: /(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\d|[ -]\d)/g, confidence: 0.92 },
  { type: 'aadhaar', re: /(?<![\d.,])[2-9]\d{11}(?![\d.,])/g, confidence: 0.6 },
  { type: 'pan', re: /(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])/g, confidence: 0.93 },
  { type: 'ifsc', re: /(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])/g, confidence: 0.85 },
  { type: 'application_id', re: /(?<![A-Za-z0-9])[A-Z]{2,5}-\d{4}-\d{3,8}(?![A-Za-z0-9])/g, confidence: 0.9 },
  { type: 'account', re: /(?<![\d.,])\d{9,18}(?![\d.,])/g, confidence: 0.55 },
  // Heuristics for names in prose (lower confidence)
  {
    type: 'name', confidence: 0.7, source: 'regex-heuristic',
    re: /\b(?:Welcome(?: back)?|Hello|Hi|Dear|Namaste|Logged in as|Signed in as)[,:]?\s+((?:(?:Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
    validate: (m) => !NOT_NAME.has(m[1].split(/\s+/).pop()!.toLowerCase()) && !NOT_NAME.has(m[1].toLowerCase()),
    span: (m) => [m.index! + m[0].length - m[1].length, m.index! + m[0].length],
  },
  {
    type: 'name', confidence: 0.7, source: 'regex-heuristic',
    re: /\b(?:Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g,
  },
];

export function resolveOverlaps(dets: Detection[]): Detection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence || (b.end - b.start) - (a.end - a.start));
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (!kept.some((k) => d.start < k.end && k.start < d.end)) kept.push(d);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function regexSpans(text: string): Detection[] {
  const out: Detection[] = [];
  for (const p of VALUE_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      if (p.validate && !p.validate(m)) continue;
      const [start, end] = p.span ? p.span(m) : [m.index!, m.index! + m[0].length];
      out.push({ type: p.type, source: p.source ?? 'regex', confidence: p.confidence, start, end });
    }
  }
  return resolveOverlaps(out);
}
