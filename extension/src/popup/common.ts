import { sget } from '../utils/storage';
import type { RunRecord } from '../types';
import { DEFAULT_SERVER } from '../communication/agent-client';

export const TASKS = ['Open my application details', 'Open transaction history', 'Scroll down', 'Download my certificate'];
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export async function getRun(): Promise<RunRecord | null> { return (await sget<RunRecord>('pl_last_run')) ?? null; }
export async function serverUrl(): Promise<string> { return (await sget<{ serverUrl?: string }>('pl_settings'))?.serverUrl || DEFAULT_SERVER; }

export async function agentConnected(): Promise<{ ok: boolean; provider?: string }> {
  try {
    const r = await fetch((await serverUrl()) + '/health', { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    return { ok: r.ok, provider: j.provider };
  } catch { return { ok: false }; }
}

export function statusOf(run: RunRecord | null): { label: string; cls: string } {
  if (!run) return { label: '● READY', cls: '' };
  if (run.status === 'blocked') return { label: '● BLOCKED (fail-closed)', cls: 'bad' };
  if (run.privacy && run.privacy.raw_pii_sent === 0) return { label: '● PROTECTED', cls: 'ok' };
  return { label: '● CHECK', cls: 'bad' };
}

export function lastActionText(run: RunRecord | null): string {
  if (!run) return '—';
  const a = run.server_action;
  if (!a) return run.status === 'error' ? 'none (' + (run.error_code ?? 'error') + ')' : '—';
  const target = a.element_id ? run.payload?.page.elements.find((e) => e.id === a.element_id) : undefined;
  const name = target?.text ?? target?.label ?? a.element_id ?? a.direction ?? '';
  return `${a.action.toUpperCase()} ${name}`.trim();
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i.test(url);
}

export async function activeTab(): Promise<{ id?: number; url?: string }> {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { id: t?.id, url: t?.url };
}

export async function activeTabId(): Promise<number | undefined> {
  const t = await activeTab();
  return t.id;
}
