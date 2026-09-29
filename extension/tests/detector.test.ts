import { describe, it, expect } from 'vitest';
import { analyzeText, detectPii } from '../src/privacy/detector';

const types = (t: string, ctx = {}) => detectPii(t, ctx).map((d) => d.type);

describe('PII detector', () => {
  it('email', () => { expect(types('Contact shriram@example.com now')).toContain('email'); });
  it('phone (Indian formats)', () => {
    for (const p of ['9876543210', '+91 98765 43210', '+91-9876543210', '98765-43210']) expect(types(p)).toContain('phone');
  });
  it('password field via DOM signal', () => {
    const a = analyzeText('hunter2!', { inputType: 'password' });
    expect(a.sensitive).toBe(true); expect(a.detections[0].type).toBe('password'); expect(a.detections[0].confidence).toBeGreaterThan(0.95);
  });
  it('card (Luhn-valid only)', () => {
    expect(types('4111 1111 1111 1111')).toContain('card');
    expect(types('4111 1111 1111 1112')).not.toContain('card');
  });
  it('PAN-like', () => { expect(types('PAN ABCDE1234F')).toContain('pan'); });
  it('Aadhaar-like', () => { expect(types('2345 6789 0123')).toContain('aadhaar'); });
  it('account number via label context', () => {
    const a = analyzeText('123456789012', { labels: ['Account Number'] });
    expect(a.detections[0].type).toBe('account'); expect(a.detections[0].source).toContain('dom');
  });
  it('application id', () => { expect(types('APP-2026-001')).toContain('application_id'); });
  it('inline "Label: value" (name)', () => {
    const a = analyzeText('Name: Shriram Vaidya');
    expect(a.redacted).toMatch(/Name: \[REDACTED/); expect(a.detections[0].type).toBe('name');
  });
  it('label context redacts whole value (address, dob)', () => {
    expect(analyzeText('123 Example Street, Pune 411001', { labels: ['Address'] }).redacted).toMatch(/\[REDACTED/);
    expect(analyzeText('14/03/2001', { labels: ['Date of Birth'] }).redacted).toMatch(/\[REDACTED/);
  });
  it('confidence is higher when DOM context and regex agree', () => {
    const both = analyzeText('shriram@example.com', { labels: ['Email'] }).detections[0];
    const rx = analyzeText('shriram@example.com').detections[0];
    expect(both.source).toBe('dom+regex'); expect(both.confidence).toBeGreaterThanOrEqual(rx.confidence);
  });
  it('does NOT flag ordinary content', () => {
    for (const t of ['Approved', 'View Details', 'Transaction History', '₹1,25,000.00', '2026-01-22', 'Account type: Savings', 'Bank Name: Example Bank', 'Card offers for you', 'Application Dashboard', 'Status: Approved'])
      expect(analyzeText(t).sensitive, t).toBe(false);
  });
  it('label text itself is not redacted', () => {
    expect(analyzeText('Account Number', { labels: ['Email'] }).sensitive).toBe(false);
  });

  it('CAPTCHA field via label context', () => {
    const a = analyzeText('X7K9', { labels: ['Enter CAPTCHA'] });
    expect(a.sensitive).toBe(true);
    expect(a.detections[0].type).toBe('captcha');
    expect(a.redacted).toMatch(/REDACTED/);
  });
  it('OTP via label', () => {
    const a = analyzeText('482913', { labels: ['OTP'] });
    expect(a.sensitive).toBe(true);
    expect(['otp', 'password']).toContain(a.detections[0].type);
  });
  it('username via label', () => {
    const a = analyzeText('demo.user', { labels: ['Username'] });
    expect(a.sensitive).toBe(true);
    expect(a.detections[0].type).toBe('username');
  });
});
