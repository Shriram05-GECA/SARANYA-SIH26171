import type { AgentAction, ValidationResult } from '../types';
import { analyzeText } from '../privacy/detector';

export const ALLOWED_ACTIONS = ['click', 'scroll', 'type', 'select', 'navigate', 'none'] as const;
const FORBIDDEN_KEYS = new Set(['code', 'script', 'js', 'javascript', 'eval', 'selector', 'css_selector', 'xpath', 'expression', 'function', 'payload']);
const CODE_LIKE = /javascript:|data:text\/html|vbscript:|<\s*script|\beval\s*\(|\bnew\s+Function\b|=>\s*\{|document\.(cookie|write)|window\.|innerHTML\s*=/i;
const ID_RE = /^[A-Za-z0-9_\-#]{1,80}$/;
const DESTRUCTIVE = /\b(delete (my )?account|close account|transfer (funds|money)|pay now|confirm payment|make payment|withdraw|remove all)\b/i;

/** What the content script knows about the target element right now. */
export interface TargetInfo {
  exists: boolean;
  connected: boolean;
  visible: boolean;
  disabled: boolean;
  tag: string;
  kind: string;            // button | link | input | select | checkbox | radio | text | image
  inputType?: string;
  sensitive: boolean;
  text: string;
  options?: string[];
  fingerprintMatches: boolean;
}

export interface ValidationContext {
  origin: string;
  getTarget: (id: string) => TargetInfo | null;
}

export function parseAction(raw: unknown): { ok: true; action: AgentAction } | { ok: false; code: string; reason: string } {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { ok: false, code: 'malformed_json', reason: 'Action is not valid JSON' }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, code: 'malformed_action', reason: 'Action must be an object' };
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) if (FORBIDDEN_KEYS.has(k.toLowerCase())) return { ok: false, code: 'forbidden_field', reason: `Field "${k}" is not allowed` };
  if (typeof o.action !== 'string' || !(ALLOWED_ACTIONS as readonly string[]).includes(o.action))
    return { ok: false, code: 'action_not_allowed', reason: 'Action type is not in the allowlist' };
  for (const v of Object.values(o)) if (typeof v === 'string' && CODE_LIKE.test(v)) return { ok: false, code: 'code_like_content', reason: 'Executable-looking content is not allowed' };
  const a: AgentAction = { action: o.action as AgentAction['action'] };
  if (o.element_id !== undefined) {
    if (typeof o.element_id !== 'string' || !ID_RE.test(o.element_id)) return { ok: false, code: 'bad_element_id', reason: 'element_id has invalid format' };
    a.element_id = o.element_id;
  }
  if (o.direction !== undefined) {
    if (!['up', 'down', 'top', 'bottom'].includes(o.direction as string)) return { ok: false, code: 'bad_direction', reason: 'Invalid scroll direction' };
    a.direction = o.direction as AgentAction['direction'];
  }
  if (o.amount !== undefined) {
    if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount < 1 || o.amount > 5000) return { ok: false, code: 'bad_amount', reason: 'Scroll amount out of range (1-5000 px)' };
    a.amount = Math.round(o.amount);
  }
  for (const k of ['text', 'value', 'url', 'reason'] as const) {
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'string' || (o[k] as string).length > 500) return { ok: false, code: 'bad_field', reason: `Field "${k}" invalid` };
      a[k] = o[k] as string;
    }
  }
  if (o.confidence !== undefined && typeof o.confidence === 'number') a.confidence = Math.max(0, Math.min(1, o.confidence));
  return { ok: true, action: a };
}

const deny = (code: string, reason: string, extra: Partial<ValidationResult> = {}): ValidationResult => ({ allowed: false, code, reason, ...extra });

export function validateAction(raw: unknown, ctx: ValidationContext): ValidationResult {
  const p = parseAction(raw);
  if (!p.ok) return deny(p.code, p.reason);
  const a = p.action;

  if (a.action === 'none') return { allowed: true, action: a };

  if (a.action === 'scroll') {
    if (!a.direction) return deny('missing_direction', 'Scroll requires a direction');
    return { allowed: true, action: { ...a, amount: a.amount ?? 600 } };
  }

  if (a.action === 'navigate') {
    if (!a.url) return deny('missing_url', 'Navigate requires a url');
    let u: URL;
    try { u = new URL(a.url, ctx.origin); } catch { return deny('bad_url', 'URL is invalid'); }
    if (!['http:', 'https:'].includes(u.protocol)) return deny('bad_url_scheme', 'Only http/https URLs are allowed');
    if (u.origin !== ctx.origin) return deny('cross_origin_navigation', 'Navigation to another origin is blocked by local policy');
    return { allowed: true, action: { ...a, url: u.toString() } };
  }

  // Element-targeted actions
  if (!a.element_id) return deny('missing_element', 'Action requires element_id');
  const t = ctx.getTarget(a.element_id);
  if (!t || !t.exists) return deny('element_missing', 'Target element is not on the current page');
  if (!t.connected) return deny('element_detached', 'Target element is no longer attached to the page');
  if (!t.visible) return deny('element_hidden', 'Target element is not visible');
  if (!t.fingerprintMatches) return deny('element_stale', 'Target element changed since the page was scanned');
  if (t.disabled) return deny('element_disabled', 'Target element is disabled');

  switch (a.action) {
    case 'click': {
      if (!['button', 'link', 'checkbox', 'radio'].includes(t.kind)) return deny('not_clickable', `Element type "${t.kind}" is not clickable`);
      if (t.inputType === 'password') return deny('policy_sensitive_target', 'Local policy blocks interacting with password fields');
      if (DESTRUCTIVE.test(t.text)) return deny('policy_requires_confirmation', 'This action needs explicit user confirmation', { requiresConfirmation: true });
      return { allowed: true, action: a };
    }
    case 'type': {
      if (t.kind !== 'input' || ['password', 'file', 'hidden', 'checkbox', 'radio', 'button', 'submit'].includes(t.inputType ?? ''))
        return deny('not_typable', 'Element is not a text input');
      if (t.sensitive) return deny('policy_sensitive_target', 'Local policy blocks typing into sensitive fields');
      if (typeof a.text !== 'string') return deny('missing_text', 'Type requires text');
      if (a.text.length > 200) return deny('text_too_long', 'Text exceeds 200 characters');
      if (analyzeText(a.text).sensitive) return deny('policy_sensitive_text', 'Agent-provided text looks like personal data');
      return { allowed: true, action: a };
    }
    case 'select': {
      if (t.kind !== 'select') return deny('not_selectable', 'Element is not a dropdown');
      const v = (a.value ?? '').trim().toLowerCase();
      if (!v || !(t.options ?? []).some((o) => o.trim().toLowerCase() === v)) return deny('bad_option', 'Option does not exist in this dropdown');
      return { allowed: true, action: a };
    }
  }
  return deny('unsupported', 'Unsupported action');
}
