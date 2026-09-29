import { describe, it, expect } from 'vitest';
import { validateAction, parseAction, type TargetInfo } from '../src/actions/validator';

const t = (o: Partial<TargetInfo> = {}): TargetInfo => ({ exists: true, connected: true, visible: true, disabled: false, tag: 'button', kind: 'button', sensitive: false, text: 'View Details', fingerprintMatches: true, ...o });
const ctx = (targets: Record<string, TargetInfo>) => ({ origin: 'http://localhost:5500', getTarget: (id: string) => targets[id] ?? null });

describe('action validator', () => {
  it('ALLOWS a valid click', () => {
    const r = validateAction({ action: 'click', element_id: 'btn_view_details', confidence: 0.9, reason: 'ok', provider: 'x', server_ms: 3 }, ctx({ btn_view_details: t() }));
    expect(r.allowed).toBe(true);
  });
  it('ALLOWS scroll with defaults, rejects bad scroll', () => {
    expect(validateAction({ action: 'scroll', direction: 'down' }, ctx({})).action?.amount).toBe(600);
    expect(validateAction({ action: 'scroll', direction: 'sideways' }, ctx({})).allowed).toBe(false);
    expect(validateAction({ action: 'scroll', direction: 'down', amount: 99999 }, ctx({})).allowed).toBe(false);
  });
  it('BLOCKS non-allowlisted / arbitrary JavaScript', () => {
    for (const a of [
      { action: 'execute_javascript', code: 'alert(1)' }, { action: 'eval', element_id: 'x' },
      { action: 'click', element_id: 'btn', script: 'alert(1)' }, { action: 'click', element_id: 'btn', selector: '#a' },
      { action: 'navigate', url: 'javascript:alert(1)' }, { action: 'type', element_id: 'in', text: '<script>alert(1)</script>' },
      { action: 'click', element_id: "btn'); alert(1);//" }, 'not json {', null, [],
    ]) expect(validateAction(a, ctx({ btn: t(), in: t({ kind: 'input', inputType: 'text' }) })).allowed, JSON.stringify(a)).toBe(false);
  });
  it('BLOCKS missing / stale / hidden / disabled / wrong-type targets', () => {
    expect(validateAction({ action: 'click', element_id: 'nope' }, ctx({})).code).toBe('element_missing');
    expect(validateAction({ action: 'click', element_id: 'a' }, ctx({ a: t({ connected: false }) })).code).toBe('element_detached');
    expect(validateAction({ action: 'click', element_id: 'a' }, ctx({ a: t({ visible: false }) })).code).toBe('element_hidden');
    expect(validateAction({ action: 'click', element_id: 'a' }, ctx({ a: t({ fingerprintMatches: false }) })).code).toBe('element_stale');
    expect(validateAction({ action: 'click', element_id: 'a' }, ctx({ a: t({ disabled: true }) })).code).toBe('element_disabled');
    expect(validateAction({ action: 'click', element_id: 'a' }, ctx({ a: t({ kind: 'text' }) })).code).toBe('not_clickable');
  });
  it('local policy: no typing into sensitive/password fields, no PII typed, destructive needs confirmation', () => {
    const c = ctx({ pw: t({ kind: 'input', inputType: 'password', sensitive: true }), q: t({ kind: 'input', inputType: 'text' }), pay: t({ text: 'Transfer funds' }) });
    expect(validateAction({ action: 'type', element_id: 'pw', text: 'x' }, c).allowed).toBe(false);
    expect(validateAction({ action: 'type', element_id: 'q', text: 'income certificate' }, c).allowed).toBe(true);
    expect(validateAction({ action: 'type', element_id: 'q', text: '9876543210' }, c).allowed).toBe(false);
    const d = validateAction({ action: 'click', element_id: 'pay' }, c);
    expect(d.allowed).toBe(false); expect(d.requiresConfirmation).toBe(true);
  });
  it('navigate: same-origin http(s) only', () => {
    expect(validateAction({ action: 'navigate', url: '/government/' }, ctx({})).allowed).toBe(true);
    expect(validateAction({ action: 'navigate', url: 'https://evil.example/x' }, ctx({})).code).toBe('cross_origin_navigation');
  });
  it('parseAction handles malformed JSON strings', () => { expect(parseAction('{bad').ok).toBe(false); });
});
