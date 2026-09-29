import { describe, it, expect } from 'vitest';
import { verifyPayload, scrubKnown, expandRawValues } from '../src/privacy/firewall';

const clean = { task: 'Open my application details', page: { title: 'Application Dashboard', elements: [{ id: 'email', type: 'text', content: '[REDACTED]', sensitive: true }, { id: 'btn', type: 'button', text: 'View Details' }] } };

describe('privacy firewall', () => {
  it('ALLOWS a sanitized payload', () => {
    const r = verifyPayload(clean, ['shriram@example.com']);
    expect(r).toMatchObject({ allowed: true, violations: 0, redactions: 1 });
  });
  it('BLOCKS a payload that contains a raw value from the page', () => {
    const p = structuredClone(clean); p.page.elements[0].content = 'shriram@example.com';
    const r = verifyPayload(p, ['shriram@example.com']);
    expect(r.allowed).toBe(false); expect(r.violations).toBeGreaterThan(0); expect(r.reason).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('shriram@example.com');
  });
  it('BLOCKS PII-shaped values even when no raw list is known (second layer)', () => {
    for (const bad of ['9876543210', 'ABCDE1234F', '2345 6789 0123', '4111111111111111', 'APP-2026-001', 'a@b.co']) {
      const p = structuredClone(clean); p.page.elements[1].text = `Pay ${bad}`;
      expect(verifyPayload(p, []).allowed, bad).toBe(false);
    }
  });
  it('catches reformatted numbers', () => {
    const p = structuredClone(clean); p.page.elements[1].text = 'ref 9876 543 210';
    expect(verifyPayload(p, ['9876543210']).allowed).toBe(false);
  });
  it('scrubKnown propagates redaction across fields and name tokens', () => {
    const raw = expandRawValues([{ value: 'Shriram Vaidya', type: 'name' }]);
    expect(scrubKnown("Shriram's dashboard", raw).text).toBe("[REDACTED]'s dashboard");
    expect(scrubKnown('shriram vaidya', raw).text).toBe('[REDACTED]');
  });

  it('ALLOWS typed redaction tokens', () => {
    const p = { task: 'x', page: { elements: [
      { id: 'pw', type: 'input', label: 'Password', sensitive: true, has_value: true },
      { id: 'cap', type: 'input', label: 'CAPTCHA', value: '[REDACTED_CAPTCHA]', sensitive: true },
    ]}};
    expect(verifyPayload(p, ['Demo@Pass123', 'X7K9']).allowed).toBe(true);
  });
  it('BLOCKS nested / stringified payload leaks', () => {
    const nested = { task: 'x', meta: { nested: { email: 'leak@example.com' } } };
    expect(verifyPayload(nested, ['leak@example.com']).allowed).toBe(false);
    const arr = { task: 'x', items: ['safe', '9876543210'] };
    expect(verifyPayload(arr, ['9876543210']).allowed).toBe(false);
    const stringified = { task: 'x', blob: JSON.stringify({ phone: '9876543210' }) };
    expect(verifyPayload(stringified, ['9876543210']).allowed).toBe(false);
  });
  it('BLOCKS case / whitespace variations of raw secrets', () => {
    const p = structuredClone(clean);
    p.page.elements[0].content = 'Shriram@Example.COM';
    expect(verifyPayload(p, ['shriram@example.com']).allowed).toBe(false);
  });
});
