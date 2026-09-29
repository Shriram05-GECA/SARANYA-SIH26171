import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { scanDocument, finalizePayload } from '../src/content/extractor';
import { verifyPayload } from '../src/privacy/firewall';

const root = path.resolve(__dirname, '../../demo-sites');
async function load(rel: string) {
  const dom = await JSDOM.fromFile(path.join(root, rel), { runScripts: 'dangerously', url: 'http://localhost:5500/' + rel.replace('index.html', ''), pretendToBeVisual: true });
  return dom.window.document;
}
const RAW = ['Shriram Vaidya', 'shriram@example.com', '9876543210', '123 Example Street', '123456789012', 'APP-2026-001', 'ABCDE1234F', '2345 6789 0123', '14/03/2001', 'Demo@Pass123', 'Shriram'];

describe('DOM extraction + redaction on the demo portals', () => {
  for (const site of ['government/index.html', 'banking/index.html', 'healthcare/index.html']) {
    it(`${site}: no raw PII in the outgoing payload, controls preserved`, async () => {
      const doc = await load(site);
      const scan = scanDocument(doc, { layout: false });
      const { payload, raw, redactions } = finalizePayload(scan, 'Open my application details');
      const s = JSON.stringify(payload);
      for (const r of RAW) expect(s.toLowerCase(), r).not.toContain(r.toLowerCase());
      expect(s).not.toMatch(/\b\d{9,}\b/);
      expect(redactions).toBeGreaterThan(4);
      expect(verifyPayload(payload, raw)).toMatchObject({ allowed: true, violations: 0 });
      const btns = payload.page.elements.filter((e) => e.type === 'button').map((e) => e.text);
      expect(btns).toContain(site.startsWith('health') ? 'Book Appointment' : 'View Details');
    });
  }

  it('government: expected structure, sensitive flags, redacted values, preserved status', async () => {
    const doc = await load('government/index.html');
    const scan = scanDocument(doc, { layout: false });
    const { payload } = finalizePayload(scan, 'Open my application details');
    const els = payload.page.elements;
    expect(payload.page.page_type).toBe('government_portal');
    expect(payload.page.demo_site).toBe(true);
    expect(els.find((e) => e.text === 'Transaction History')?.type).toBe('button');
    expect(els.some((e) => e.content === 'Approved')).toBe(true);
    expect(els.filter((e) => e.sensitive && e.content === '[REDACTED]').length).toBeGreaterThanOrEqual(7);
    expect(els.find((e) => e.type === 'input' && e.input_type === 'password')?.sensitive).toBe(true);
    const search = els.find((e) => e.type === 'input' && /search/i.test(e.label ?? ''));
    expect(search && !search.sensitive).toBe(true);
    expect(els.filter((e) => e.type === 'image')).toHaveLength(2);
  });

  it('typed values in inputs are never transmitted', async () => {
    const doc = await load('government/index.html');
    (doc.getElementById('f-search') as HTMLInputElement).value = 'call 9876543210';
    const scan = scanDocument(doc, { layout: false });
    const { payload } = finalizePayload(scan, 'x');
    expect(JSON.stringify(payload)).not.toContain('9876543210');
  });

  it('task text containing PII is redacted too', async () => {
    const doc = await load('government/index.html');
    const { payload } = finalizePayload(scanDocument(doc, { layout: false }), 'Email shriram@example.com my details');
    expect(payload.task).not.toContain('shriram@example.com');
  });
});
