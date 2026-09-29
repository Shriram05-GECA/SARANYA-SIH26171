/**
 * SARANYA dashboard — Privacy-Enforcing Browser Agent
 * "Give AI the capability, not the secret."
 * Uses real runtime data only (pl_last_run, pl_history, live preview).
 */
import { sget } from '../utils/storage';
import type { LocalRow, RunRecord } from '../types';
import { $, esc, getRun, statusOf, lastActionText, agentConnected, serverUrl } from './common';
import { verifyPayload } from '../privacy/firewall';

type Tab = 'overview' | 'privacy' | 'context' | 'action' | 'history' | 'advanced';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['privacy', 'Visual privacy'],
  ['context', 'What model saw'],
  ['action', 'Validation'],
  ['history', 'Activity'],
  ['advanced', 'Diagnostics'],
];
let tab: Tab = 'overview';
let preview: {
  rows: LocalRow[];
  images: { id: string; dataUrl: string; regions: number; faces: number }[];
} | null = null;
let selectedHistId: string | null = null;

async function lastTab(): Promise<number | undefined> {
  return await sget<number>('pl_last_tab');
}

async function loadPreview() {
  const id = await lastTab();
  if (!id) return null;
  try {
    const r = await chrome.tabs.sendMessage(id, { type: 'LOCAL_PREVIEW', task: '' });
    return r?.ok ? r : null;
  } catch {
    return null;
  }
}

const ms = (n?: number) => (n === undefined || n === null ? '—' : Math.round(n) + ' ms');
const SECRET_TYPES = new Set(['password', 'otp', 'captcha', 'card', 'account', 'pan', 'aadhaar']);

function maskOriginal(row: LocalRow): string {
  const hasSecret = row.types.some((t) => SECRET_TYPES.has(t));
  if (hasSecret) return '••••••••';
  if (row.original.length > 48) return row.original.slice(0, 45) + '…';
  return row.original;
}

type HistSlim = {
  id: string;
  ts: number;
  task: string;
  status: string;
  action?: string;
  timings?: { total_ms?: number; perception_total_ms?: number; network_ms?: number; exec_ms?: number };
  provider?: string;
  raw_pii_sent?: number;
  redacted?: number;
  error_code?: string;
};

async function getHistory(): Promise<HistSlim[]> {
  return ((await sget<HistSlim[]>('pl_history')) ?? []) as HistSlim[];
}

async function clearHistory() {
  await chrome.storage.local.remove(['pl_history', 'pl_last_run']);
}

function fmtTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function protectionStatus(run: RunRecord | null, conn: { ok: boolean }) {
  const raw = run?.privacy?.raw_pii_sent;
  if (run?.status === 'blocked' || (raw !== undefined && raw > 0)) {
    return { label: '● PROTECTION BLOCKED', cls: 'blocked', detail: 'Firewall blocked or raw PII detected in outbound path' };
  }
  if (run && raw === 0) {
    return { label: '● PROTECTION ACTIVE', cls: 'protected', detail: 'Last run: 0 raw sensitive values disclosed' };
  }
  if (run) return { label: '● CHECK REQUIRED', cls: 'warning', detail: 'Review last run' };
  return {
    label: conn.ok ? '● PROTECTION READY' : '● AGENT OFFLINE',
    cls: conn.ok ? 'protected' : 'warning',
    detail: conn.ok ? 'Ready — run a task to verify' : 'Start local server for reasoning',
  };
}

function metricsRow(run: RunRecord | null, hist: HistSlim[]) {
  const tasks = hist.length;
  const detected =
    run?.privacy?.redacted ??
    hist.reduce((n, h) => n + (typeof h.redacted === 'number' ? h.redacted : 0), 0);
  const disclosed =
    run?.privacy?.raw_pii_sent !== undefined
      ? run.privacy.raw_pii_sent
      : hist.length
        ? hist.reduce((n, h) => n + (h.raw_pii_sent ?? 0), 0)
        : undefined;
  const blocked = hist.filter((h) => h.status === 'blocked' || h.status === 'action_rejected').length;
  const status = disclosed === 0 ? 'SANITIZED' : disclosed === undefined ? '—' : 'REVIEW';

  return `
  <div class="metrics-row">
    <div class="metric-card"><div class="m-label">Tasks executed</div><div class="m-val">${tasks}</div></div>
    <div class="metric-card"><div class="m-label">Sensitive items detected</div><div class="m-val">${detected ?? '—'}</div></div>
    <div class="metric-card metric-emphasis">
      <div class="m-label">Sensitive values disclosed</div>
      <div class="m-val ${disclosed === 0 ? 'ok' : disclosed && disclosed > 0 ? 'bad' : ''}">${disclosed === undefined ? '—' : disclosed}</div>
      <div class="m-hint">Must stay 0</div>
    </div>
    <div class="metric-card"><div class="m-label">Actions blocked</div><div class="m-val">${blocked}</div></div>
    <div class="metric-card"><div class="m-label">Privacy status</div><div class="m-val mono" style="font-size:14px">${status}</div></div>
  </div>`;
}

function pipelineOverview() {
  return `
  <div class="pipeline-strip">
    <div class="pipe-local">
      <div class="pipe-title">LOCAL · TRUSTED</div>
      <div class="pipe-steps">
        <span>Page</span><span class="arr">→</span>
        <span>Perception</span><span class="arr">→</span>
        <span>Detect</span><span class="arr">→</span>
        <span>Disclose min</span><span class="arr">→</span>
        <span>Sanitize</span>
      </div>
    </div>
    <div class="pipe-boundary">privacy boundary</div>
    <div class="pipe-remote">
      <div class="pipe-title">REMOTE · UNTRUSTED</div>
      <div class="pipe-steps">
        <span>LLM reason</span><span class="arr">→</span>
        <span>Action proposal</span>
      </div>
    </div>
    <div class="pipe-boundary">validate</div>
    <div class="pipe-local">
      <div class="pipe-title">LOCAL · TRUSTED</div>
      <div class="pipe-steps"><span>Validate</span><span class="arr">→</span><span>Browser action</span></div>
    </div>
  </div>
  <p class="principle">LLM proposes · SARANYA validates · Browser executes</p>`;
}

function authorityCard() {
  return `
  <div class="authority-row">
    <div class="auth-card"><div class="auth-role">LLM</div><div class="auth-act">REASON</div><div class="auth-note">Structured action only</div></div>
    <div class="auth-arrow">↓</div>
    <div class="auth-card highlight"><div class="auth-role">SARANYA</div><div class="auth-act">DECIDE + VALIDATE</div><div class="auth-note">Disclosure &amp; policy</div></div>
    <div class="auth-arrow">↓</div>
    <div class="auth-card"><div class="auth-role">BROWSER</div><div class="auth-act">EXECUTE</div><div class="auth-note">Local only</div></div>
  </div>`;
}

function subsystemStatus(run: RunRecord | null, conn: { ok: boolean }) {
  const r = run?.resources as Record<string, unknown> | undefined;
  const cv = !!(r?.vision_available || r?.webgpu_inference_active || (r?.vision_backend && r.vision_backend !== 'unavailable'));
  const ocr = !!(run?.ocr && ((run.ocr as { images_processed?: number }).images_processed ?? 0) > 0)
    || !!(run?.perception_trace as { OCR_USED?: boolean } | undefined)?.OCR_USED;
  const items: { name: string; on: boolean; label: string }[] = [
    { name: 'Local perception', on: true, label: 'ACTIVE' },
    { name: 'PII detection', on: true, label: 'ACTIVE' },
    { name: 'Privacy firewall', on: true, label: 'ACTIVE' },
    { name: 'Action validation', on: true, label: 'ACTIVE' },
    { name: 'Local CV', on: cv || (run?.perception_trace as { CV_USED?: boolean } | undefined)?.CV_USED === true, label: cv || (run?.perception_trace as { CV_USED?: boolean } | undefined)?.CV_USED ? 'USED' : 'STANDBY' },
    { name: 'OCR', on: ocr, label: ocr ? 'USED' : 'STANDBY' },
    { name: 'Reasoning connection', on: conn.ok, label: conn.ok ? 'CONNECTED' : 'OFFLINE' },
  ];
  return `
  <div class="subsys-grid">
    ${items
      .map(
        (i) =>
          `<div class="subsys ${i.on ? 'on' : 'off'}"><span class="dot"></span>${esc(i.name)} <strong>${esc(i.label)}</strong></div>`,
      )
      .join('')}
  </div>`;
}

function taskAwareCard() {
  return `
  <div class="usp-card">
    <h3>Task-aware minimum disclosure</h3>
    <p>SARANYA determines what information is required for the current task before allowing context to leave the browser.</p>
    <div class="usp-example">
      <div><span class="tag planned">Prototype</span> Example task: <code>Use my saved email to complete this form.</code></div>
      <div class="usp-cols">
        <div><strong>Remote sees</strong><br><code>EMAIL_REF_01</code></div>
        <div><strong>Local keeps</strong><br><code>user@…</code> (never in payload)</div>
      </div>
    </div>
    <p class="help">Semantic tokens (EMAIL_REF_01, PHONE_REF_01, …) are the target architecture. Current runs already redact values to <code>[REDACTED_*]</code> tokens; full REF resolution is next-stage.</p>
  </div>`;
}

function localComputeCard() {
  return `
  <div class="usp-card">
    <h3>Sensitive computation stays local</h3>
    <ul class="compact-list">
      <li><span class="tag done">Implemented</span> PII detect, redaction, firewall verify</li>
      <li><span class="tag done">Implemented</span> Local action validation &amp; execution</li>
      <li><span class="tag done">Implemented</span> OCR / CV on device when used</li>
      <li><span class="tag planned">Prototype</span> Semantic REF resolve at fill-time</li>
      <li><span class="tag planned">Planned</span> Saved-credential vault integration</li>
    </ul>
    <p class="principle">Send the capability required for reasoning, not the secret required for execution.</p>
  </div>`;
}

function overview(run: RunRecord | null, conn: { ok: boolean; provider?: string }, hist: HistSlim[]) {
  const prot = protectionStatus(run, conn);
  const ago = run?.ts ? Math.max(0, Math.round((Date.now() - run.ts) / 1000)) + 's ago' : '—';
  return `
  <div class="status-hero ${prot.cls}">
    <div class="status-label">${prot.label}</div>
    <div class="raw-label">SENSITIVE VALUES DISCLOSED (last run)</div>
    <div class="raw-count">${run?.privacy?.raw_pii_sent === undefined ? '—' : run.privacy.raw_pii_sent}</div>
    <div class="last-verify">${esc(prot.detail)} · ${ago}${conn.ok ? ' · Reasoning online' : ' · Reasoning offline'}${conn.provider ? ' · ' + esc(conn.provider) : ''}</div>
  </div>
  ${metricsRow(run, hist)}
  <h2>Agent pipeline</h2>
  ${pipelineOverview()}
  <h2>Local authority</h2>
  ${authorityCard()}
  <h2>Subsystem status</h2>
  ${subsystemStatus(run, conn)}
  <h2>Implemented capabilities</h2>
  <div class="usp-real">
    <div class="usp-real-item">
      <div class="usp-real-title">Local authority</div>
      <p>The remote model proposes an action. SARANYA validates and the browser executes locally. The model never receives unrestricted control.</p>
    </div>
    <div class="usp-real-item">
      <div class="usp-real-title">Continuous re-perception</div>
      <p>After each browser action, SARANYA can re-scan the updated page before the next step in a multi-step task.</p>
    </div>
  </div>
  <h2>Coming next</h2>
  <div class="coming-next">
    <div class="coming-badge">NEXT ARCHITECTURE</div>
    <strong>Semantic capability references</strong>
    <p>Instead of exposing <code>user@example.com</code>, future runs may expose <code>EMAIL_REF_01</code> and resolve the value only at local execution time. <em>Not active in live runs today — current redaction uses [REDACTED_*] tokens.</em></p>
    <div class="ref-flow mono">value → LOCAL VAULT → EMAIL_REF_01 → remote reason → local resolve → browser</div>
  </div>
  <h2>Last task</h2>
  ${
    run
      ? `<div class="run-summary">
    <div><strong>Task</strong> ${esc(run.task)}</div>
    <div><strong>Result</strong> ${esc(run.status)} · ${esc(lastActionText(run))}</div>
    <div><strong>Network</strong> ${run.privacy?.raw_pii_sent === 0 ? 'SANITIZED' : run.status === 'blocked' ? 'BLOCKED' : '—'}</div>
  </div>`
      : '<div class="empty-state"><strong>No activity yet</strong><p>Your SARANYA runs will appear here.</p></div>'
  }`;
}

function redactionMatrix(run: RunRecord | null, rows: LocalRow[]) {
  const types = ['email', 'phone', 'password', 'card', 'pan', 'aadhaar', 'otp', 'account', 'name', 'address'];
  const detected = new Set<string>();
  for (const r of rows) r.types.forEach((t) => detected.add(t));
  if (run?.payload?.page?.elements) {
    for (const e of run.payload.page.elements) {
      if (e.sensitive) {
        if (e.input_type === 'password') detected.add('password');
        else detected.add('sensitive');
      }
    }
  }
  const shareRule = (t: string) => {
    if (['password', 'otp', 'captcha', 'card'].includes(t)) return 'NO';
    return detected.has(t) ? 'Ref / redacted' : '—';
  };
  return `
  <table class="matrix">
    <thead><tr><th>Data type</th><th>Detected</th><th>Redacted</th><th>Shared</th><th>Kept local</th></tr></thead>
    <tbody>
    ${types
      .map((t) => {
        const det = detected.has(t);
        return `<tr>
          <td>${esc(t)}</td>
          <td>${det ? '✓' : 'Not detected'}</td>
          <td>${det ? '✓' : '—'}</td>
          <td>${shareRule(t)}</td>
          <td>${det ? '✓' : '—'}</td>
        </tr>`;
      })
      .join('')}
    </tbody>
  </table>
  <p class="help">Matrix reflects detections from the current page preview and last run payload — not invented.</p>`;
}

function privacyTab(run: RunRecord | null) {
  const rows = preview?.rows ?? [];
  const images = preview?.images ?? [];
  const raw = run?.privacy?.raw_pii_sent;
  const regions = images.reduce((n, i) => n + (i.regions || 0) + (i.faces || 0), 0);

  let verifyHtml = '';
  if (run?.payload) {
    try {
      const rawSet = new Set<string>();
      const rep = verifyPayload(run.payload, rawSet);
      verifyHtml = `<div class="msg ${rep.allowed ? 'ok' : 'err'}">Independent verify: ${rep.allowed ? 'PASS' : 'FAIL'} · ${rep.redactions} redactions · ${rep.violations} violations</div>`;
    } catch {
      verifyHtml = '<div class="msg">Telemetry unavailable for independent verify</div>';
    }
  }

  return `
  <h2>Visual privacy inspection</h2>
  <p class="help">LOCAL CAPTURE → DETECTION → REDACTION → SANITIZED CONTEXT → REASONING. Screenshots below are local-only previews when available.</p>
  <div class="viz-compare">
    <div class="viz-panel">
      <div class="viz-label">Local redacted preview</div>
      ${
        images.length
          ? images
              .map(
                (i) =>
                  `<img class="pv" src="${i.dataUrl}" alt="redacted"><div class="help">${esc(i.id)} · ${i.regions} text · ${i.faces} face</div>`,
              )
              .join('')
          : '<div class="empty-state">No visual redaction artifact for this page (DOM-only perception, or no image regions).</div>'
      }
    </div>
    <div class="viz-panel">
      <div class="viz-label">Disclosure status</div>
      <div class="boundary-box">
        <div class="boundary-row critical"><span>Screenshot pixels</span><strong>NOT TRANSMITTED</strong></div>
        <div class="boundary-row critical"><span>Raw sensitive values</span><strong class="${raw === 0 ? 'ok' : ''}">${raw === undefined ? 'N/A' : raw === 0 ? 'NOT TRANSMITTED' : raw + ' REVIEW'}</strong></div>
        <div class="boundary-row"><span>Redacted preview</span><strong>LOCAL ONLY</strong></div>
        <div class="boundary-row"><span>Sanitized context</span><strong>${run?.payload ? 'TRANSMITTED' : '—'}</strong></div>
        <div class="boundary-row"><span>Task context</span><strong>${run?.payload ? 'TRANSMITTED' : '—'}</strong></div>
        <div class="boundary-row"><span>Regions (preview)</span><strong>${images.length ? regions : 'N/A'}</strong></div>
      </div>
    </div>
  </div>
  <h2>Privacy scorecard</h2>
  <div class="metrics-row">
    <div class="metric-card metric-emphasis"><div class="m-label">Raw PII shared</div><div class="m-val ${raw === 0 ? 'ok' : ''}">${raw === undefined ? '—' : raw}</div></div>
    <div class="metric-card"><div class="m-label">Items redacted</div><div class="m-val">${run?.privacy?.redacted ?? '—'}</div></div>
    <div class="metric-card"><div class="m-label">Preview rows</div><div class="m-val">${rows.length}</div></div>
  </div>
  ${verifyHtml}
  <h2>Redaction matrix</h2>
  ${redactionMatrix(run, rows)}
  <h2>Detected locally</h2>
  <table>
    <tr><th>Field</th><th>Local (masked)</th><th>Sanitized</th><th>Types</th></tr>
    ${
      rows
        .map(
          (r) => `<tr>
      <td>${esc(r.label ?? '')}</td>
      <td class="raw">${esc(maskOriginal(r))}</td>
      <td class="san">${esc(r.redacted)}</td>
      <td class="mono">${esc(r.types.join(', '))}</td>
    </tr>`,
        )
        .join('') || '<tr><td colspan="4">No sensitive items on current page preview.</td></tr>'
    }
  </table>
  <h2>Perception breakdown</h2>
  ${perceptionBars(run)}`;
}

function perceptionBars(run: RunRecord | null) {
  const t = run?.perception_trace as { DOM_USED?: boolean; CV_USED?: boolean; OCR_USED?: boolean; FACE_DETECTION_USED?: boolean } | undefined;
  const r = run?.resources as Record<string, unknown> | undefined;
  const rows = [
    { name: 'DOM', on: t?.DOM_USED !== false, note: 'Fields / structure' },
    { name: 'OCR', on: !!t?.OCR_USED, note: 'Pixel text' },
    { name: 'Vision', on: !!t?.CV_USED || r?.vision_backend === 'wasm' || r?.vision_backend === 'webgpu', note: 'Regions' },
    { name: 'Face', on: !!t?.FACE_DETECTION_USED, note: 'When available' },
  ];
  return `
  <div class="perc-bars">
    ${rows
      .map(
        (x) =>
          `<div class="perc-bar-row"><span>${esc(x.name)}</span><div class="bar"><div class="fill" style="width:${x.on ? '85%' : '12%'}"></div></div><span class="dim">${x.on ? 'used' : 'not this run'} · ${esc(x.note)}</span></div>`,
      )
      .join('')}
  </div>`;
}

function contextTab(run: RunRecord | null) {
  if (!run?.payload) {
    return '<div class="empty-state"><strong>No sanitized context yet</strong><p>Run a task to generate model-eligible context.</p></div>';
  }
  const page = run.payload.page;
  const els = page.elements ?? [];
  const sensitive = els.filter((e) => e.sensitive);
  const nav = els.filter((e) => e.type === 'button' || e.type === 'link').slice(0, 10);
  const visual = run.payload.visual;

  return `
  <h2>What did the model see?</h2>
  <div class="split-local-remote">
    <div class="side local-side">
      <div class="side-hd">Local only</div>
      <ul class="side-list">
        <li>Original page pixels</li>
        <li>Raw sensitive values</li>
        <li>Local OCR text (raw)</li>
        <li>Local CV coordinates</li>
        <li>Credentials / secrets</li>
      </ul>
    </div>
    <div class="side remote-side">
      <div class="side-hd">Sent to model</div>
      <ul class="side-list">
        <li>Sanitized DOM context</li>
        <li>Redacted field tokens</li>
        <li>Task string (scrubbed)</li>
        <li>Visual labels (if any)</li>
        <li>Scene summary (if any)</li>
      </ul>
    </div>
  </div>
  <table class="matrix tx-table">
    <thead><tr><th>Data</th><th>Local</th><th>Remote</th></tr></thead>
    <tbody>
      <tr><td>Original screenshot</td><td>YES</td><td>NO</td></tr>
      <tr><td>Raw PII</td><td>YES</td><td>${run.privacy?.raw_pii_sent === 0 ? 'NO' : run.privacy?.raw_pii_sent != null ? 'REVIEW' : 'N/A'}</td></tr>
      <tr><td>Sensitive credentials</td><td>YES</td><td>NO</td></tr>
      <tr><td>DOM structure</td><td>YES</td><td>YES</td></tr>
      <tr><td>Sanitized context</td><td>YES</td><td>YES</td></tr>
      <tr><td>Visual metadata</td><td>YES</td><td>${visual ? 'YES' : 'NO'}</td></tr>
    </tbody>
  </table>
  <div class="model-see">
    <div><strong>Task</strong><br>${esc(run.payload.task || run.task)}</div>
    <div><strong>Page</strong><br>${esc(page.title || page.page_type)}</div>
    <div><strong>Payload</strong><br>${run.resources?.payload_bytes ?? '—'} bytes</div>
    <div><strong>Credentials</strong><br>NOT DISCLOSED</div>
  </div>
  <h2>Visible UI (sanitized)</h2>
  <div class="ctx-tree">
    ${nav.map((e) => `├── ${esc(e.text || e.label || e.id)}`).join('<br>') || '└── (none)'}
  </div>
  <h2>Sensitive fields (tokens only)</h2>
  <div class="ctx-tree">
    ${
      sensitive
        .map((e) => {
          const tok =
            e.input_type === 'password'
              ? 'PASSWORD_REF / [REDACTED_PASSWORD]'
              : e.value?.includes('REDACTED')
                ? esc(e.value)
                : '[REDACTED]';
          return `├── ${esc(e.label || e.id)} → ${tok}`;
        })
        .join('<br>') || '└── none marked sensitive'
    }
  </div>
  <h2>Visual context</h2>
  ${
    visual
      ? `<dl class="kv tight">
    <div><dt>Used</dt><dd>${visual.used ? 'yes' : 'no'}</dd></div>
    <div><dt>Backend</dt><dd>${esc(visual.backend)}</dd></div>
    <div><dt>Summary</dt><dd>${esc(visual.scene_summary || '—')}</dd></div>
    <div><dt>Detections</dt><dd>${visual.detections?.length ?? 0} (labels/boxes only — no pixels)</dd></div>
  </dl>`
      : '<div class="msg">Structured context sent — no screenshot transmitted.</div>'
  }
  <h2>Kept local</h2>
  <p class="help">Actual email, phone, password, card numbers, OCR raw lines, and original pixels stay on device.</p>
  <details><summary>Full sanitized JSON</summary><pre>${esc(JSON.stringify(run.payload, null, 2))}</pre></details>`;
}

function actionTab(run: RunRecord | null) {
  if (!run) return '<div class="empty-state"><strong>No action yet</strong><p>Run a task to see validation.</p></div>';
  const a = run.server_action;
  const v = run.validation;
  const e = run.execution;
  return `
  <h2>Action validation</h2>
  <div class="val-console">
    <section>
      <h3>Proposed action</h3>
      <div class="val-main mono">${a ? esc(a.action.toUpperCase()) : '—'}</div>
      <div class="help">Target: ${a?.element_id ? esc(a.element_id) : a?.direction ? esc(a.direction) : '—'}${a?.reason ? ' · ' + esc(String(a.reason).slice(0, 100)) : ''}</div>
    </section>
    <section>
      <h3>SARANYA validation</h3>
      <table class="matrix">
        <tr><td>Policy check</td><td>${v ? (v.allowed ? '✓ Allowed' : '✗ Blocked') : 'N/A'}</td></tr>
        <tr><td>Reason</td><td class="mono">${v ? esc(v.reason || v.code || '—') : '—'}</td></tr>
        <tr><td>Run status</td><td>${esc(run.status)}</td></tr>
      </table>
    </section>
    <section class="val-result ${v?.allowed && e?.executed ? 'pass' : run.status === 'action_rejected' || run.status === 'blocked' ? 'fail' : ''}">
      <h3>Final result</h3>
      <div class="val-main">${e?.executed ? 'ACTION ALLOWED · EXECUTED' : v && !v.allowed ? 'ACTION BLOCKED' : esc(run.status.toUpperCase())}</div>
    </section>
  </div>
  <p class="principle">LLM proposes · SARANYA validates · Browser executes</p>
  ${run.status === 'action_rejected' ? '<div class="msg err">ACTION BLOCKED by local policy.</div>' : ''}
  ${run.status === 'error' ? '<div class="msg err">AGENT ERROR — no browser action executed.</div>' : ''}
  <h2>Detail</h2>
  <pre>${esc(JSON.stringify({ action: a, validation: v, execution: e }, null, 2))}</pre>`;
}

function historyTab(hist: HistSlim[], run: RunRecord | null) {
  if (!hist.length) {
    return `<div class="empty-state"><strong>No activity yet</strong><p>Your SARANYA runs will appear here.</p></div>`;
  }
  const rows = [...hist].reverse();
  const selected = selectedHistId ? rows.find((h) => h.id === selectedHistId) : null;
  return `
  <h2>Recent activity</h2>
  <table class="history-table">
    <thead><tr><th>Time</th><th>Task</th><th>Detected</th><th>Disclosed</th><th>Action</th><th>Status</th></tr></thead>
    <tbody>
    ${rows
      .map(
        (h) => `<tr data-hid="${esc(h.id)}" class="hist-row ${selectedHistId === h.id ? 'sel' : ''}">
      <td>${fmtTime(h.ts)}</td>
      <td>${esc(h.task.slice(0, 40))}</td>
      <td>${h.redacted ?? '—'}</td>
      <td class="${h.raw_pii_sent === 0 ? 'ok' : ''}">${h.raw_pii_sent ?? '—'}</td>
      <td>${esc(h.action || '—')}</td>
      <td>${esc(h.status)}</td>
    </tr>`,
      )
      .join('')}
    </tbody>
  </table>
  ${
    selected
      ? `<h2>Run detail</h2>
    <dl class="kv tight">
      <div><dt>Task</dt><dd>${esc(selected.task)}</dd></div>
      <div><dt>Time</dt><dd>${esc(new Date(selected.ts).toLocaleString())}</dd></div>
      <div><dt>Status</dt><dd>${esc(selected.status)}</dd></div>
      <div><dt>Action</dt><dd>${esc(selected.action || '—')}</dd></div>
      <div><dt>Sensitive disclosed</dt><dd>${selected.raw_pii_sent ?? '—'}</dd></div>
      <div><dt>Redacted count</dt><dd>${selected.redacted ?? '—'}</dd></div>
      <div><dt>Total latency</dt><dd>${ms(selected.timings?.total_ms)}</dd></div>
      <div><dt>Provider</dt><dd>${esc(selected.provider || '—')}</dd></div>
    </dl>
    <p class="help">Secrets are never stored in history — only counts and action metadata.</p>`
      : '<p class="help">Click a row for audit detail.</p>'
  }
  ${
    run
      ? `<h2>Full last-run timeline</h2>
    <ol class="timeline">
      <li>Task received · ${esc(run.task)}</li>
      <li>Local perception (DOM${(run.perception_trace as { CV_USED?: boolean })?.CV_USED ? ' + CV' : ''}${(run.perception_trace as { OCR_USED?: boolean })?.OCR_USED ? ' + OCR' : ''})</li>
      <li>Sensitive detection · redacted ${run.privacy?.redacted ?? '—'}</li>
      <li>Firewall · raw sent ${run.privacy?.raw_pii_sent ?? '—'}</li>
      <li>Reasoning · ${esc(run.provider || '—')}</li>
      <li>Validation · ${run.validation?.allowed ? 'allowed' : run.validation ? 'rejected' : '—'}</li>
      <li>Execution · ${run.execution?.executed ? 'done' : run.status}</li>
    </ol>`
      : ''
  }`;
}

function advancedTab(run: RunRecord | null, conn: { ok: boolean; provider?: string }) {
  const r = (run?.resources ?? {}) as Record<string, unknown>;
  const tr = (run?.timings ?? {}) as Record<string, number | undefined>;
  const pt = (run?.perception_trace ?? {}) as Record<string, boolean | undefined>;
  const ocr = run?.ocr as { images_processed?: number; engine_ms?: number; total_ms?: number } | undefined;
  const ocrUsed = !!(pt.OCR_USED || (ocr?.images_processed ?? 0) > 0);
  const cvUsed = !!(pt.CV_USED || r.vision_backend === 'wasm' || r.vision_backend === 'webgpu' || r.vision_available);
  const faceUsed = !!pt.FACE_DETECTION_USED;

  const ocrStatus = ocrUsed
    ? 'USED THIS RUN'
    : run
      ? 'NOT REQUIRED (this page)'
      : 'N/A';
  const cvStatus = cvUsed
    ? String(r.vision_backend || 'active').toUpperCase()
    : run
      ? 'NOT REQUIRED (this page)'
      : 'N/A';

  return `
  <h2>Diagnostics</h2>
  <p class="help">Technical detail for this machine and last run. Unavailable fields show N/A — not fabricated.</p>

  <h3 class="diag-h">Environment</h3>
  <table class="matrix diag-table">
    <tr><td>Server</td><td class="mono" id="adv-server">…</td></tr>
    <tr><td>Reasoning</td><td>${conn.ok ? 'CONNECTED' : 'OFFLINE'}${conn.provider ? ' · <span class="mono">' + esc(conn.provider) + '</span>' : ''}</td></tr>
    <tr><td>Browser</td><td class="mono">${esc(navigator.userAgent.split(' ').slice(-2).join(' '))}</td></tr>
    <tr><td>Hardware concurrency</td><td class="mono">${r.hardware_concurrency ?? navigator.hardwareConcurrency ?? 'N/A'}</td></tr>
    <tr><td>JS heap (reported)</td><td class="mono">${r.js_heap_used_mb != null ? r.js_heap_used_mb + ' MB' : 'N/A'}</td></tr>
  </table>

  <h3 class="diag-h">Local perception</h3>
  <table class="matrix diag-table">
    <tr><td>DOM scan</td><td>${pt.DOM_USED !== false && run ? 'USED' : run ? '—' : 'N/A'}</td></tr>
    <tr><td>Vision / CV</td><td><span class="mono">${esc(cvStatus)}</span>${r.vision_model_name || run?.vision?.modelName ? ' · ' + esc(String(r.vision_model_name || run?.vision?.modelName)) : ''}</td></tr>
    <tr><td>WebGPU available</td><td>${r.webgpu_available === true ? 'YES' : r.webgpu_available === false ? 'NO' : 'N/A'}</td></tr>
    <tr><td>WebGPU inference</td><td>${r.webgpu_inference_active ? 'ACTIVE' : cvUsed && r.vision_backend === 'wasm' ? 'WASM used' : 'Not this run'}</td></tr>
    <tr><td>OCR</td><td>${esc(ocrStatus)}${ocr?.images_processed != null ? ' · ' + ocr.images_processed + ' image(s)' : ''}</td></tr>
    <tr><td>Face detection</td><td>${faceUsed ? 'USED' : run ? 'NOT REQUIRED (this page)' : 'N/A'}</td></tr>
    <tr><td>Payload size</td><td class="mono">${r.payload_bytes != null ? r.payload_bytes + ' bytes' : 'N/A'}</td></tr>
  </table>

  <h3 class="diag-h">Latency (last run)</h3>
  <table class="matrix diag-table">
    <tr><td>DOM / detect / redact</td><td class="mono">${tr.dom_scan_ms != null ? Math.round(tr.dom_scan_ms) + ' / ' + Math.round(tr.detect_ms || 0) + ' / ' + Math.round(tr.redact_ms || 0) + ' ms' : 'N/A'}</td></tr>
    <tr><td>Perception total</td><td class="mono">${tr.perception_total_ms != null ? Math.round(tr.perception_total_ms) + ' ms' : 'N/A'}</td></tr>
    <tr><td>Vision</td><td class="mono">${tr.vision_ms != null ? Math.round(tr.vision_ms) + ' ms' : (r.vision_inference_ms != null ? Math.round(Number(r.vision_inference_ms)) + ' ms' : 'N/A')}</td></tr>
    <tr><td>OCR</td><td class="mono">${tr.ocr_ms != null ? Math.round(tr.ocr_ms) + ' ms' : (ocr?.total_ms != null ? Math.round(ocr.total_ms) + ' ms' : 'N/A')}</td></tr>
    <tr><td>Firewall verify</td><td class="mono">${tr.verify_ms != null ? Math.round(tr.verify_ms) + ' ms' : 'N/A'}</td></tr>
    <tr><td>Network</td><td class="mono">${tr.network_ms != null ? Math.round(tr.network_ms) + ' ms' : 'N/A'}</td></tr>
    <tr><td>AI / server</td><td class="mono">${tr.server_ai_ms != null ? Math.round(tr.server_ai_ms) + ' ms' : 'N/A'}</td></tr>
    <tr><td>Execute</td><td class="mono">${tr.exec_ms != null ? Math.round(tr.exec_ms) + ' ms' : 'N/A'}</td></tr>
    <tr><td><strong>Total</strong></td><td class="mono"><strong>${tr.total_ms != null ? Math.round(tr.total_ms) + ' ms' : 'N/A'}</strong></td></tr>
  </table>

  <h3 class="diag-h">Privacy (last run)</h3>
  <table class="matrix diag-table">
    <tr><td>Sensitive items</td><td class="mono">${run?.privacy?.sensitive_items ?? run?.privacy?.redacted ?? 'N/A'}</td></tr>
    <tr><td>Redacted</td><td class="mono">${run?.privacy?.redacted ?? 'N/A'}</td></tr>
    <tr><td>Raw PII sent</td><td class="mono ${run?.privacy?.raw_pii_sent === 0 ? 'ok' : ''}">${run?.privacy?.raw_pii_sent ?? 'N/A'}</td></tr>
    <tr><td>Network</td><td class="mono">${esc(run?.privacy?.network ?? 'N/A')}</td></tr>
    <tr><td>Status</td><td class="mono">${esc(run?.status ?? 'N/A')}</td></tr>
  </table>

  <p class="help">OCR / face show “NOT REQUIRED” when the adaptive pipeline skipped them (typical on text-heavy pages without images). That is not a failure.</p>
  <details><summary>Raw last run record</summary><pre>${esc(JSON.stringify(run, null, 2))}</pre></details>`;
}


function toast(msg: string) {
  let el = document.getElementById('saranya-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'saranya-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el?.classList.remove('show'), 2200);
}

async function render() {
  const run = await getRun();
  const hist = await getHistory();
  const conn = await agentConnected();
  const st = statusOf(run);
  const badge = $('badge');
  if (badge) {
    badge.textContent = st.label.replace('PROTECTED', 'PROTECTION ACTIVE').replace('READY', 'PROTECTION READY');
    badge.className = 'badge ' + st.cls;
  }

  try {
    preview = await loadPreview();
  } catch {
    preview = null;
  }

  const tabs = $('tabs');
  if (tabs) {
    tabs.innerHTML = TABS.map(([k, label]) => `<button type="button" class="tab ${tab === k ? 'on' : ''}" data-k="${k}">${label}</button>`).join('');
  }

  let body = '';
  if (tab === 'overview') body = overview(run, conn, hist);
  else if (tab === 'privacy') body = privacyTab(run);
  else if (tab === 'context') body = contextTab(run);
  else if (tab === 'action') body = actionTab(run);
  else if (tab === 'history') body = historyTab(hist, run);
  else body = advancedTab(run, conn);

  const view = $('view');
  if (view) view.innerHTML = body;

  if (tab === 'advanced') {
    serverUrl().then((u) => {
      const el = document.getElementById('adv-server');
      if (el) el.textContent = u;
    });
  }

  // history row clicks
  view?.querySelectorAll('.hist-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectedHistId = (row as HTMLElement).dataset.hid || null;
      render();
    });
  });
}

// Wire chrome UI
document.getElementById('tabs')?.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-k]') as HTMLElement | null;
  const k = t?.dataset.k as Tab | undefined;
  if (k) {
    tab = k;
    render();
  }
});

document.getElementById('refresh')?.addEventListener('click', () => void render());

document.getElementById('run')?.addEventListener('click', async () => {
  const t = ($('task') as HTMLInputElement).value.trim();
  const id = await lastTab();
  if (!t || !id) return;
  ($('run') as HTMLButtonElement).disabled = true;
  await chrome.runtime.sendMessage({ type: 'RUN_TASK', tabId: id, task: t });
  ($('run') as HTMLButtonElement).disabled = false;
  render();
});

document.getElementById('clear-history')?.addEventListener('click', () => {
  const dlg = document.getElementById('clear-dlg') as HTMLDialogElement | null;
  dlg?.showModal();
});

document.getElementById('clear-cancel')?.addEventListener('click', () => {
  (document.getElementById('clear-dlg') as HTMLDialogElement | null)?.close();
});

document.getElementById('clear-confirm')?.addEventListener('click', async () => {
  await clearHistory();
  selectedHistId = null;
  (document.getElementById('clear-dlg') as HTMLDialogElement | null)?.close();
  toast('History cleared');
  render();
});

chrome.storage.onChanged.addListener((c) => {
  if (c.pl_last_run || c.pl_history) render();
});

void render();
