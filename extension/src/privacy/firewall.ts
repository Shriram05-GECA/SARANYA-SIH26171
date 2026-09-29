import type { FirewallReport, Detection } from '../types';
import { REDACTION_TOKEN } from '../types';
import { REDACTED } from './detector';
import { regexSpans } from './patterns';

const ALL_TOKENS = new Set([REDACTED, ...Object.values(REDACTION_TOKEN)]);
const isRedactionToken = (s: string) => ALL_TOKENS.has(s) || /^\[REDACTED[_A-Z0-9]*\]$/i.test(s);

export function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); collectStrings(x, out); }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const digitsOf = (s: string) => s.replace(/\D/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Expand raw values with name tokens so that "Shriram Vaidya" also protects "Shriram". */
export function expandRawValues(entries: { value: string; type: string }[]): Set<string> {
  const set = new Set<string>();
  for (const { value, type } of entries) {
    const v = value.trim();
    if (v.length < 3) continue;
    set.add(v);
    if (type === 'name') for (const t of v.split(/\s+/)) if (/^[A-Za-z]{4,}$/.test(t)) set.add(t);
  }
  return set;
}

/** Replace any occurrence of a known raw value in `text` (case-insensitive, separator-tolerant for numbers). */
export function scrubKnown(text: string, raw: Iterable<string>): { text: string; count: number } {
  let out = text;
  let count = 0;
  const values = [...raw].sort((a, b) => b.length - a.length);
  for (const r of values) {
    const d = digitsOf(r);
    const numeric = d.length >= 6 && d.length >= r.replace(/\s/g, '').length * 0.7;
    const pattern = numeric
      ? '(?<!\\d)' + d.split('').join('[\\s.-]?') + '(?!\\d)'
      : escapeRe(r).replace(/\s+/g, '\\s+');
    out = out.replace(new RegExp(pattern, 'gi'), () => { count++; return REDACTED; });
  }
  return { text: out, count };
}

export function countRedactions(strings: string[]): number {
  let n = 0;
  for (const s of strings) {
    if (isRedactionToken(s)) { n++; continue; }
    n += (s.match(/\[REDACTED[_A-Z0-9]*\]/gi) ?? []).length;
  }
  return n;
}

/**
 * Privacy firewall. Fails closed: `allowed` is true only when
 *  (1) no known raw sensitive value appears anywhere in the outgoing payload, and
 *  (2) no PII-shaped value survives in any payload string.
 * Never returns or logs the offending values.
 */
export function verifyPayload(payload: unknown, rawValues: Iterable<string> = []): FirewallReport {
  const strings = collectStrings(payload);
  const types = new Set<string>();
  let violations = 0;

  const normPayload = strings.map(norm);
  const digitPayload = strings.map(digitsOf);
  for (const r of rawValues) {
    const rn = norm(r);
    if (rn.length < 3) continue;
    const rd = digitsOf(r);
    const numeric = rd.length >= 6 && rd.length >= rn.length * 0.7;
    const hit = numeric ? digitPayload.some((p) => p.includes(rd)) : normPayload.some((p) => p.includes(rn));
    if (hit) { violations++; types.add('raw_value_present'); }
  }

  for (const s of strings) {
    if (isRedactionToken(s)) continue;
    const dets: Detection[] = regexSpans(s);
    for (const d of dets) {
      if (d.type === 'name' && d.confidence < 0.8) continue; // heuristic-only; not a hard block
      violations++;
      types.add(d.type);
    }
  }

  const redactions = countRedactions(strings);
  return {
    allowed: violations === 0,
    redactions,
    violations,
    checked_strings: strings.length,
    ...(violations ? { reason: 'Potential raw sensitive value detected', violation_types: [...types].sort() } : {}),
  };
}
