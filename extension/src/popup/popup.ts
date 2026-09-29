/**
 * SARANYA extension popup — compact security console.
 */
import type { RunRecord } from '../types';
import {
  $,
  TASKS,
  getRun,
  statusOf,
  lastActionText,
  agentConnected,
  activeTabId,
  activeTab,
  isRestrictedUrl,
  esc,
} from './common';

function pageName(url?: string): string {
  if (!url) return '—';
  try {
    const u = new URL(url);
    if (/localhost|127\.0\.0\.1/.test(u.hostname) && /securebank/i.test(u.pathname)) return 'SecureBank Demo';
    if (/localhost|127\.0\.0\.1/.test(u.hostname)) return u.pathname.split('/').filter(Boolean)[0] || 'Local demo';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '—';
  }
}

async function render() {
  const run = await getRun();
  const st = statusOf(run);
  const tab = await activeTab();
  const conn = await agentConnected();
  const p = run?.privacy;

  const badge = $('badge');
  badge.textContent = st.label.replace('PROTECTED', 'PROTECTED').replace('READY', 'READY');
  badge.className = 'badge ' + st.cls;

  const statusLine = $('status-line');
  if (run?.status === 'blocked' || (p?.raw_pii_sent !== undefined && p.raw_pii_sent > 0)) {
    statusLine.className = 'status-line bad';
    statusLine.textContent = '● Protection blocked / review required';
  } else if (run && p?.raw_pii_sent === 0) {
    statusLine.className = 'status-line ok';
    statusLine.textContent = '● Protection active · 0 secrets disclosed';
  } else if (conn.ok) {
    statusLine.className = 'status-line ok';
    statusLine.textContent = '● Protection ready · agent online';
  } else {
    statusLine.className = 'status-line warn';
    statusLine.textContent = '● Agent offline · start local server';
  }

  const network =
    p?.network ??
    (p?.raw_pii_sent === 0 ? 'SANITIZED' : run?.status === 'blocked' ? 'BLOCKED' : '—');

  const rows: [string, string][] = [
    ['Current page', pageName(tab.url)],
    ['Sensitive detected', String(p?.sensitive_items ?? p?.redacted ?? '—')],
    ['Values disclosed', p?.raw_pii_sent === undefined ? '—' : String(p.raw_pii_sent)],
    ['Network', network],
    ['Last action', lastActionText(run)],
    ['Last run', run?.timings?.total_ms != null ? `${Math.round(run.timings.total_ms)} ms` : '—'],
  ];

  $('kv').innerHTML = rows
    .map(
      ([k, v]) =>
        `<div class="pk-row"><span class="pk-k">${esc(k)}</span><span class="pk-v${
          k === 'Values disclosed' && v === '0' ? ' ok' : ''
        }">${esc(v)}</span></div>`,
    )
    .join('');

  const m = $('msg');
  if (run && (run.status === 'error' || run.status === 'blocked' || run.status === 'action_rejected')) {
    m.className = 'msg err';
    m.textContent = `${run.status}: ${run.error ?? ''}`.trim();
  } else if (run?.status === 'completed') {
    m.className = 'msg';
    m.textContent = run.server_action?.reason ? String(run.server_action.reason).slice(0, 120) : 'Task completed.';
  } else {
    m.className = 'msg hidden';
  }
}

async function run(task: string) {
  const tab = await activeTab();
  if (!tab.id) return;
  if (isRestrictedUrl(tab.url)) {
    const m = $('msg');
    m.className = 'msg err';
    m.textContent = 'Cannot run on chrome:// or store pages. Open an http(s) site (e.g. SecureBank demo).';
    return;
  }
  const btn = $<HTMLButtonElement>('run');
  btn.disabled = true;
  const m = $('msg');
  m.className = 'msg';
  m.textContent = 'Running…';
  try {
    await chrome.runtime.sendMessage({ type: 'RUN_TASK', tabId: tab.id, task });
  } finally {
    btn.disabled = false;
    await render();
  }
}

$('chips').innerHTML = TASKS.map((t) => `<button type="button" class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join('');
$('chips').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).dataset.t;
  if (t) {
    ($('task') as HTMLInputElement).value = t;
    void run(t);
  }
});
$('run').addEventListener('click', () => {
  const t = ($('task') as HTMLInputElement).value.trim();
  if (t) void run(t);
});
$('task').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') $('run').click();
});
$('hl').addEventListener('change', async (e) => {
  const id = await activeTabId();
  if (id)
    chrome.tabs
      .sendMessage(id, { type: 'HIGHLIGHT', on: (e.target as HTMLInputElement).checked })
      .catch(() => {});
});
$('dash').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
$('scan').addEventListener('click', async () => {
  const id = await activeTabId();
  if (!id) return;
  try {
    await chrome.tabs.sendMessage(id, { type: 'LOCAL_PREVIEW', task: '' });
    const m = $('msg');
    m.className = 'msg';
    m.textContent = 'Page scanned locally. Open Dashboard → Visual Privacy.';
  } catch {
    const m = $('msg');
    m.className = 'msg err';
    m.textContent = 'Scan failed — reload the page and try again.';
  }
  await render();
});

chrome.storage.onChanged.addListener((c) => {
  if (c.pl_last_run) void render();
  if (c.pl_status) {
    const s = (c.pl_status.newValue as { stage?: string } | undefined)?.stage;
    if (s && s !== 'idle') {
      const m = $('msg');
      m.className = 'msg';
      m.textContent = s;
    }
  }
});

void render();
export type { RunRecord };
