import type { PiiType } from '../types';

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[*:：]+/g, ' ').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const NAME_LABEL = /^(?:card ?holder|name of (?:the )?(?:applicant|holder|patient|customer)|(?:(?:full|first|last|middle|sur|customer|holder|card ?holder|applicant|account holder|beneficiary|patient|father'?s?|mother'?s?|spouse|nominee|candidate)\s*)?name)$/;

interface Rule { type: PiiType; re: RegExp; base: number }

const RULES: Rule[] = [
  { type: 'captcha', re: /\bcaptcha\b|security\s*code|verification\s*code|image\s*code/, base: 0.97 },
  { type: 'otp', re: /\b(otp|one[- ]time|one[- ]time\s*password|verification\s*code)\b/, base: 0.96 },
  { type: 'password', re: /\b(pass(word|code|wd)?|pwd|cvv|cvc|secret|mpin)\b|^pin$/, base: 0.95 },
  { type: 'email', re: /e-?mail/, base: 0.9 },
  { type: 'phone', re: /\b(phone|mobile|contact (no|number|num)|tel(ephone)?|cell|whatsapp|mob)\b/, base: 0.88 },
  { type: 'aadhaar', re: /aadhaa?r|uidai|\buid\b/, base: 0.9 },
  { type: 'ifsc', re: /\bifsc\b/, base: 0.85 },
  { type: 'pan', re: /\bpan\b|permanent account/, base: 0.9 },
  { type: 'card', re: /\b(credit|debit|atm)\s*card|card\s*(no|number|num|#)|^card$/, base: 0.9 },
  { type: 'dob', re: /\b(dob|d\.o\.b|date of birth|birth\s*date|birthday)\b/, base: 0.9 },
  { type: 'username', re: /\b(user\s*name|username|user\s*id|login\s*id)\b/, base: 0.8 },
  { type: 'application_id', re: /application\s*(id|no|number|num|ref)/, base: 0.88 },
  { type: 'identifier', re: /\b(reference|ref|receipt|txn|transaction|patient|customer|policy|claim|member|employee|student|roll)\s*(id|no|number|num|#)/, base: 0.85 },
  { type: 'address', re: /\b(address|residence|residential|pin\s*code|postal|zip)\b/, base: 0.8 },
];

const ACCOUNT_RE = /\b(a\/c|acct|account)\b(?!\s*(type|status|holder|name|opened|open|balance|manager|summary|overview|settings|number of))/;

export interface LabelHit { type: PiiType; base: number }

export function classifyLabel(raw: string): LabelHit | null {
  const s = normalizeLabel(raw);
  if (!s || s.length > 60) return null;
  if (NAME_LABEL.test(s)) return { type: 'name', base: 0.82 };
  for (const r of RULES) if (r.re.test(s)) return { type: r.type, base: r.base };
  if (ACCOUNT_RE.test(s) || /\b(account|a\/c|acct)\s*(no|number|num|#)\b/.test(s)) return { type: 'account', base: 0.9 };
  return null;
}

export function classifyLabels(labels: string[]): LabelHit | null {
  for (const l of labels) { const h = classifyLabel(l); if (h) return h; }
  return null;
}

export function typeFromInput(inputType?: string, autocomplete?: string): LabelHit | null {
  const t = (inputType ?? '').toLowerCase();
  if (t === 'password') return { type: 'password', base: 0.99 };
  if (t === 'email') return { type: 'email', base: 0.97 };
  if (t === 'tel') return { type: 'phone', base: 0.95 };
  const tokens = (autocomplete ?? '').toLowerCase().split(/\s+/);
  const map: Record<string, PiiType> = {
    email: 'email', tel: 'phone', 'tel-national': 'phone', 'cc-number': 'card', 'cc-csc': 'password',
    'current-password': 'password', 'new-password': 'password', 'one-time-code': 'password',
    name: 'name', 'given-name': 'name', 'family-name': 'name', 'street-address': 'address',
    'address-line1': 'address', 'address-line2': 'address', 'postal-code': 'address', bday: 'dob', username: 'username',
  };
  for (const tok of tokens) if (map[tok]) return { type: map[tok], base: 0.95 };
  return null;
}

const EMPTY_VALUE = /^(n\/?a|na|none|null|nil|-+|—+|–+|not provided|not available|\*+|•+|\.+)$/i;

/** Does the value look like something that should be treated as PII given a label-derived type? */
export function contextValueOk(type: PiiType, value: string): boolean {
  const v = value.trim();
  if (v.length < 2 || EMPTY_VALUE.test(v)) return false;
  const digits = (v.match(/\d/g) ?? []).length;
  switch (type) {
    case 'password': case 'otp': case 'captcha': return true;
    case 'email': return v.length >= 5;
    case 'phone': return digits >= 6;
    case 'card': case 'aadhaar': case 'account': return digits >= 6;
    case 'pan': case 'ifsc': case 'application_id': case 'identifier': return digits >= 3 && v.length >= 5;
    case 'name': return v.length <= 80 && /[A-Za-z]/.test(v) && !/^\d+$/.test(v);
    case 'address': return v.length >= 5 && v.length <= 250;
    case 'dob': return digits >= 4;
    case 'username': return v.length >= 3 && v.length <= 60;
    default: return true;
  }
}
