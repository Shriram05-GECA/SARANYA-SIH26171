import type { Detection, LocalRow, PiiType, SanitizedElement, SanitizedPage } from '../types';
import { analyzeText, REDACTED } from '../privacy/detector';
import { expandRawValues, scrubKnown, countRedactions } from '../privacy/firewall';
import { classifyLabels } from '../privacy/labels';

export interface ScanOptions { layout?: boolean; maxElements?: number; maxText?: number }
export interface RegistryEntry { el: Element; fingerprint: string; recompute: () => string; kind: string; sensitive: boolean }
export interface VisualTarget { id: string; el: Element }

export interface ScanResult {
  page: SanitizedPage;
  registry: Map<string, RegistryEntry>;
  rawEntries: { value: string; type: string }[];
  rows: LocalRow[];
  detections: Detection[];
  visualTargets: VisualTarget[];
  timings: { dom_scan_ms: number; detect_ms: number; redact_ms: number };
  rawHtmlBytes: number;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'SVG', 'IFRAME']);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const collapse = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'x';

export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function classifyPage(title: string, headings: string, url: string): string {
  const t = `${title} ${headings} ${url}`.toLowerCase();
  const score = (re: RegExp) => (t.match(re) ?? []).length;
  const s: [string, number][] = [
    ['banking_portal', score(/\b(bank|banking|account|transaction|ifsc|balance|statement|payments?)\b/g)],
    ['government_portal', score(/\b(government|gov|application|scheme|certificate|citizen|portal|seva)\b/g)],
    ['healthcare_portal', score(/\b(patient|hospital|clinic|prescription|appointment|lab|health|medical)\b/g)],
  ];
  s.sort((a, b) => b[1] - a[1]);
  return s[0][1] > 0 ? s[0][0] : 'generic';
}

export function interactiveKind(el: Element): SanitizedElement['type'] | null {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'hidden') return null;
    if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    return 'input';
  }
  if (tag === 'textarea') return 'input';
  if (tag === 'select') return 'select';
  if (role && ['button', 'link', 'tab', 'menuitem', 'checkbox', 'switch', 'radio'].includes(role))
    return role === 'link' ? 'link' : role === 'checkbox' || role === 'switch' ? 'checkbox' : 'button';
  if (el.hasAttribute('onclick') || el.hasAttribute('data-action')) return 'button';
  return null;
}


/** Heuristic CAPTCHA / challenge widget detection — used to skip CV and OCR. */
export function isCaptchaEl(el: Element): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  const id = (el.getAttribute('id') || '').toLowerCase();
  const cls = (el.getAttribute('class') || '').toLowerCase();
  const name = (el.getAttribute('name') || '').toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  const src = (el.getAttribute('src') || '').toLowerCase();
  const data = (el.getAttribute('data-sitekey') || el.getAttribute('data-callback') || '').toLowerCase();
  const blob = `${id} ${cls} ${name} ${aria} ${src} ${data}`;
  if (/captcha|recaptcha|hcaptcha|turnstile|cf-turnstile|g-recaptcha|h-captcha|arkose|funcaptcha|geetest/.test(blob)) {
    return true;
  }
  // Common challenge iframes / containers
  if (tag === 'iframe' && /recaptcha|hcaptcha|turnstile|captcha|challenges\.cloudflare/.test(src)) {
    return true;
  }
  // Parent context often wraps the widget
  const parent = el.parentElement;
  if (parent) {
    const pBlob = `${(parent.getAttribute('id') || '')} ${(parent.getAttribute('class') || '')}`.toLowerCase();
    if (/captcha|recaptcha|hcaptcha|turnstile/.test(pBlob)) return true;
  }
  return false;
}

export function scanDocument(doc: Document, opts: ScanOptions = {}): ScanResult {
  const t0 = now();
  let detectMs = 0;
  let redactMs = 0;
  const win = doc.defaultView as (Window & typeof globalThis);
  const layout = opts.layout ?? true;
  const maxEl = opts.maxElements ?? 250;
  const maxText = opts.maxText ?? 200;

  const registry = new Map<string, RegistryEntry>();
  const rawEntries: { value: string; type: string }[] = [];
  const rows: LocalRow[] = [];
  const allDets: Detection[] = [];
  const visualTargets: VisualTarget[] = [];
  const elements: SanitizedElement[] = [];
  const used = new Map<string, number>();
  const labelFor = new Map<string, string>();
  doc.querySelectorAll('label[for]').forEach((l) => labelFor.set(l.getAttribute('for')!, collapse(l.textContent)));

  const uid = (base: string) => { const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base}_${n}`; };
  const visible = (el: Element): boolean => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (layout && cs.display !== 'contents') { const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return false; }
    return true;
  };
  const inViewport = (el: Element) => { if (!layout) return undefined; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < win.innerHeight; };

  const analyze = (text: string, ctx: Parameters<typeof analyzeText>[1], id: string, label?: string) => {
    const a0 = now();
    const a = analyzeText(text, ctx);
    detectMs += now() - a0;
    if (a.sensitive) {
      allDets.push(...a.detections);
      for (const d of a.detections) rawEntries.push({ value: text.slice(d.start, d.end).trim(), type: d.type });
      rows.push({
        id, label, original: text, redacted: a.redacted, raw: a.raw, types: a.detections.map((d) => d.type),
        confidence: Math.max(...a.detections.map((d) => d.confidence)),
        source: a.detections.sort((x, y) => y.confidence - x.confidence)[0].source,
      });
    }
    return a;
  };

  const shortText = (n: Element | null): string | null => {
    if (!n) return null;
    if (n.querySelector('input,select,textarea,button,a,img,canvas')) return null;
    const t = collapse(n.textContent);
    return t && t.length <= 40 ? t : null;
  };
  const hintsFor = (el: Element): string[] => {
    const h: string[] = [];
    if (['LABEL', 'DT', 'TH', 'LEGEND', 'FIGCAPTION', 'CAPTION'].includes(el.tagName)) return h;
    const dl = el.getAttribute('data-label') || el.getAttribute('aria-label');
    if (dl) h.push(dl);
    const prev = el.previousElementSibling;
    const p1 = shortText(prev);
    if (p1) h.push(p1);
    else if (!prev && el.parentElement && el.parentElement !== doc.body) {
      const p2 = shortText(el.parentElement.previousElementSibling);
      if (p2) h.push(p2);
    }
    if (el.tagName === 'TD') {
      const row = el.parentElement; const table = el.closest('table');
      if (row && table) {
        const idx = Array.prototype.indexOf.call(row.children, el);
        const head = table.querySelector('thead tr') ?? table.querySelector('tr');
        const cell = head && head !== row ? head.children[idx] : null;
        const t = shortText(cell ?? null);
        if (t) h.unshift(t);
      }
    }
    return h;
  };
  const fieldLabels = (el: Element): string[] => {
    const l: string[] = [];
    const id = el.getAttribute('id');
    if (id && labelFor.has(id)) l.push(labelFor.get(id)!);
    const wrap = el.closest('label');
    if (wrap) l.push(collapse(wrap.textContent));
    const al = el.getAttribute('aria-label'); if (al) l.push(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const i of lb.split(/\s+/)) { const t = collapse(doc.getElementById(i)?.textContent); if (t) l.push(t); }
    for (const a of ['placeholder', 'name', 'id', 'title']) { const v = el.getAttribute(a); if (v) l.push(v); }
    return l.map((s) => s.replace(/([a-z])([A-Z])/g, '$1 $2'));
  };
  const ownText = (el: Element) => {
    let s = '';
    el.childNodes.forEach((n) => { if (n.nodeType === 3) s += ' ' + n.textContent; });
    return collapse(s);
  };
  const accName = (el: Element): string => {
    const t = el.getAttribute('aria-label') || collapse((el as HTMLElement).innerText ?? el.textContent) || el.getAttribute('value') || el.getAttribute('title') || el.getAttribute('alt') || '';
    return collapse(t);
  };
  const cut = (s: string) => (s.length > maxText ? s.slice(0, maxText) + '…' : s);

  const walk = (root: Element) => {
    for (const el of Array.from(root.children)) {
      if (elements.length >= maxEl) return;
      if (SKIP.has(el.tagName.toUpperCase())) continue;
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();

      if (tag === 'img' || tag === 'canvas') {
        const w = tag === 'img' ? (el as HTMLImageElement).naturalWidth || Number(el.getAttribute('width')) || 0 : (el as HTMLCanvasElement).width;
        const h = tag === 'img' ? (el as HTMLImageElement).naturalHeight || Number(el.getAttribute('height')) || 0 : (el as HTMLCanvasElement).height;
        if (w >= 40 && h >= 40 || !layout) {
          const id = uid('img');
          const alt = analyze(collapse(el.getAttribute('alt') || el.getAttribute('aria-label') || ''), {}, id + '#alt').redacted;
          elements.push({ id, type: 'image', alt: alt || undefined, ocr_status: 'pending' });
          registry.set(id, { el, fingerprint: hash(id), recompute: () => hash(id), kind: 'image', sensitive: false });
          visualTargets.push({ id, el });
        }
        continue;
      }

      const kind = interactiveKind(el);
      if (kind) {
        const id0 = (kind === 'link' ? 'link' : kind === 'button' ? 'btn' : kind === 'input' ? 'in' : kind === 'select' ? 'sel' : kind);
        if (kind === 'button' || kind === 'link') {
          const raw = accName(el);
          const a = analyze(raw, {}, `${id0}:${raw.slice(0, 20)}`);
          const id = uid(`${id0}_${a.sensitive ? 'redacted' : slug(raw)}`);
          const e: SanitizedElement = { id, type: kind, text: cut(a.redacted) };
          if (a.sensitive) e.sensitive = true;
          if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') e.disabled = true;
          if (kind === 'link') {
            try {
              const u = new URL(el.getAttribute('href')!, doc.location?.href || 'http://localhost/');
              const same = u.origin === (doc.location?.origin ?? u.origin);
              e.href_path = same ? analyze(u.pathname, {}, id + '#href').redacted : '(external)';
            } catch { e.href_path = '(invalid)'; }
          }
          const vp = inViewport(el); if (vp !== undefined) e.in_viewport = vp;
          elements.push(e);
          registry.set(id, { el, fingerprint: hash(kind + raw), recompute: () => hash(kind + accName(el)), kind, sensitive: a.sensitive });
        } else if (kind === 'input' || kind === 'checkbox' || kind === 'radio') {
          const input = el as HTMLInputElement;
          const type = (el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();
          const labels = fieldLabels(el);
          const labelClean = labels.find((l) => l && !/^[a-z0-9_-]+$/i.test(l) || false) ?? labels[0] ?? '';
          const value = input.value ?? '';
          const ctx = { labels, inputType: type, autocomplete: el.getAttribute('autocomplete') ?? undefined };
          const a = analyze(value, ctx, `${id0}:${slug(labelClean)}`, labelClean);
          const labelHit = classifyLabels(labels);
          const isSecretType = type === 'password' || labelHit?.type === 'password' || labelHit?.type === 'otp' || labelHit?.type === 'captcha';
          const fieldHit = (isSecretType || !!labelHit) && kind === 'input';
          const sensitiveField = a.sensitive || !!fieldHit;
          const secretType = a.type ?? labelHit?.type;
          const idBase = sensitiveField && secretType ? `field_${secretType}` : `${id0}_${slug(labelClean)}`;
          const id = uid(idBase);
          const ph = el.getAttribute('placeholder');
          const phA = ph ? analyze(ph, {}, id + '#placeholder') : null;
          const lab = analyze(collapse(labelClean), {}, id + '#label');
          const e: SanitizedElement = { id, type: kind, input_type: type, label: cut(lab.redacted), has_value: value.length > 0 };
          if (phA) e.placeholder = cut(phA.redacted);
          if (kind !== 'input') e.checked = input.checked;
          // Never transmit raw secret / sensitive field values — has_value + sensitive is sufficient.
          else if (value && !sensitiveField) e.value = cut(a.redacted);
          if (sensitiveField) e.sensitive = true;
          if (input.disabled) e.disabled = true;
          const vp = inViewport(el); if (vp !== undefined) e.in_viewport = vp;
          elements.push(e);
          const fpIn = hash(kind + type + labelClean);
          registry.set(id, { el, fingerprint: fpIn, recompute: () => fpIn, kind, sensitive: sensitiveField });
        } else {
          const labels = fieldLabels(el);
          const labelClean = labels[0] ?? '';
          const id = uid(`sel_${slug(labelClean)}`);
          const rawOpts = () => Array.from((el as HTMLSelectElement).options).slice(0, 30).map((o) => collapse(o.text));
          const opts2 = rawOpts().map((t) => analyze(t, {}, id + '#opt').redacted);
          const lab = analyze(collapse(labelClean), {}, id + '#label');
          elements.push({ id, type: 'select', label: cut(lab.redacted), options: opts2, has_value: !!(el as HTMLSelectElement).value });
          registry.set(id, { el, fingerprint: hash('select' + labelClean + rawOpts().join()), recompute: () => hash('select' + labelClean + rawOpts().join()), kind: 'select', sensitive: false });
        }
        continue;
      }

      const own = ownText(el);
      if (own) {
        const isHead = /^h[1-6]$/.test(tag);
        const a = isHead ? analyze(own, {}, `h:${own.slice(0, 20)}`) : analyze(own, { labels: hintsFor(el) }, `t:${own.slice(0, 20)}`, hintsFor(el)[0]);
        const idType = a.type;
        const id = uid(a.sensitive && idType ? idType : isHead ? 'h' : 'txt');
        const e: SanitizedElement = { id, type: isHead ? 'heading' : 'text' };
        if (isHead) e.text = cut(a.redacted); else e.content = cut(a.redacted);
        if (a.sensitive) {
          e.sensitive = true;
          const lbl = hintsFor(el)[0]; if (lbl) e.label = lbl;
          el.setAttribute('data-aegis-sensitive', String(idType));
        }
        elements.push(e);
        registry.set(id, { el, fingerprint: hash('text' + own), recompute: () => hash('text' + ownText(el)), kind: 'text', sensitive: a.sensitive });
      }
      walk(el);
    }
  };
  walk(doc.body);

  // Cross-field propagation: scrub every known raw value from every emitted string.
  const r0 = now();
  const raw = expandRawValues(rawEntries);
  const title0 = collapse(doc.title);
  let urlStr = '';
  try { const u = new URL(doc.location.href); urlStr = u.origin + u.pathname; } catch { urlStr = ''; }
  const titleA = analyzeText(title0);
  for (const d of titleA.detections) rawEntries.push({ value: title0.slice(d.start, d.end), type: d.type });
  const urlA = analyzeText(urlStr);
  const scrubField = (s: string) => scrubKnown(s, raw).text;
  for (const e of elements) {
    for (const k of ['text', 'content', 'label', 'placeholder', 'value', 'href_path', 'alt'] as const) {
      const v = e[k]; if (typeof v === 'string' && v) e[k] = scrubField(v);
    }
    if (e.options) e.options = e.options.map(scrubField);
  }
  const headingsText = elements.filter((e) => e.type === 'heading').map((e) => e.text).join(' ');
  const title = scrubField(titleA.redacted);
  const page: SanitizedPage = {
    title,
    url: scrubField(urlA.redacted),
    page_type: classifyPage(title, headingsText, doc.location?.pathname ?? ''),
    demo_site: !!doc.querySelector('meta[name="aegis-demo"]'),
    scroll: {
      y: Math.round(win.scrollY || 0),
      max_y: Math.max(0, Math.round((doc.documentElement.scrollHeight || 0) - (win.innerHeight || 0))),
      viewport_h: win.innerHeight || 0,
    },
    elements,
  };
  redactMs += now() - r0;
  return {
    page, registry, rawEntries, rows, detections: allDets, visualTargets,
    timings: { dom_scan_ms: Math.max(0, now() - t0 - detectMs - redactMs), detect_ms: detectMs, redact_ms: redactMs },
    rawHtmlBytes: doc.documentElement.outerHTML.length,
  };
}

/** Attach OCR results to placeholder image elements and re-scrub with newly discovered raw values. */
export function mergeVisual(scan: ScanResult, id: string, v: {
  status: 'ok' | 'failed' | 'unavailable' | 'skipped_captcha'; ocrText?: string; regions?: number; flags?: string[];
  rawValues?: { value: string; type: string }[]; rows?: { original: string; redacted: string; raw: string[]; types: PiiType[]; confidence: number; source: string }[];
}) {
  const e = scan.page.elements.find((x) => x.id === id);
  if (!e) return;
  e.ocr_status = v.status;
  if (v.ocrText) e.ocr_text = v.ocrText.slice(0, 800);
  if (v.regions !== undefined) e.ocr_regions_redacted = v.regions;
  if (v.flags?.length) e.flags = v.flags;
  if (v.regions) e.sensitive = true;
  for (const r of v.rawValues ?? []) scan.rawEntries.push(r);
  (v.rows ?? []).forEach((r, i) => scan.rows.push({ id: `${id}#line${i + 1}`, label: 'image text (OCR)', ...r }));
}

export function finalizePayload(scan: ScanResult, task: string) {
  const raw = expandRawValues(scan.rawEntries);
  const tA = analyzeText(task);
  let taskS = tA.redacted;
  for (const d of tA.detections) raw.add(task.slice(d.start, d.end).trim());
  taskS = scrubKnown(taskS, raw).text;
  for (const e of scan.page.elements) {
    for (const k of ['text', 'content', 'label', 'placeholder', 'value', 'href_path', 'alt', 'ocr_text'] as const) {
      const v = e[k]; if (typeof v === 'string' && v) e[k] = scrubKnown(v, raw).text;
    }
  }
  scan.page.title = scrubKnown(scan.page.title, raw).text;
  const payload = { task: taskS, page: scan.page };
  const strings = JSON.stringify(payload).match(/\[REDACTED\]/g) ?? [];
  return { payload, raw, redactions: strings.length + 0 * countRedactions([]) };
}

export const REDACTED_TOKEN = REDACTED;
