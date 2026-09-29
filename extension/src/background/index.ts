import type { EventItem, ExecutionResult, PerceiveResult, RunRecord, StageTimings, ValidationResult } from '../types';
import { verifyPayload } from '../privacy/firewall';
import { parseAction } from '../actions/validator';
import { AgentError, DEFAULT_SERVER, postToAgent } from '../communication/agent-client';
import { round, safeError } from '../utils/env';
import { sget } from '../utils/storage';


function isRestrictedTabUrl(url?: string): boolean {
  if (!url) return false;
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i.test(url);
}

const OFFSCREEN = 'offscreen.html';
let assetsCache: { ocr_model_size_mb?: number; engine?: string } | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEP_PAUSE_MS = 700;

async function setStage(stage: string, step?: number) { await chrome.storage.local.set({ pl_status: { stage, step, ts: Date.now() } }); }

async function ensureOffscreen() {
  const has = await (chrome.runtime as unknown as { getContexts(f: object): Promise<unknown[]> }).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (has.length) return;
  await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Run local OCR (Tesseract) and ONNX vision (ORT WASM) on page images' });
}

async function loadAssets() {
  if (assetsCache) return assetsCache;
  try {
    const m = await (await fetch(chrome.runtime.getURL('assets-manifest.json'))).json();
    assetsCache = { ocr_model_size_mb: m.ocr_total_mb, engine: m.engine };
  } catch { assetsCache = {}; }
  return assetsCache;
}

async function sendToTab<T>(tabId: number, msg: object): Promise<T> {
  try { return await chrome.tabs.sendMessage(tabId, msg) as T; }
  catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, msg) as T;
  }
}

async function loadSettings() {
  const s = await sget<{ serverUrl?: string; guided?: boolean }>('pl_settings');
  return { serverUrl: s?.serverUrl || DEFAULT_SERVER, guided: !!s?.guided };
}

async function save(run: RunRecord) {
  const hist = (await sget<unknown[]>('pl_history')) ?? [];
  const slim = {
    id: run.id, ts: run.ts, task: run.task, status: run.status, action: run.server_action?.action, element: run.server_action?.element_id, guided: run.guided,
    timings: run.timings, provider: run.provider, raw_pii_sent: run.privacy?.raw_pii_sent, redacted: run.privacy?.redacted, error_code: run.error_code,
  };
  await chrome.storage.local.set({ pl_last_run: run, pl_history: [...hist, slim].slice(-60) });
  await setStage('idle', 7);
}

const zeroTimings = (): StageTimings => ({ dom_scan_ms: 0, detect_ms: 0, redact_ms: 0, verify_ms: 0, perception_total_ms: 0 });

/** Multi-step agent loop limits (SIH26171). */
/** Multi-step ceiling: enough for form fills + navigation demos (SIH). */
const MAX_STEPS = 15;
const MAX_TASK_TIME_MS = 90_000;

async function runTask(tabId: number, task: string): Promise<RunRecord> {
  const t0 = performance.now();
  let paused = 0;
  const id = crypto.randomUUID();
  const base: RunRecord = { id, ts: Date.now(), task, status: 'error' };
  const events: EventItem[] = [];
  let keepPriv: RunRecord['privacy'];
  let keepOcr: RunRecord['ocr'];
  let lastResources: RunRecord['resources'];
  let lastPayload: RunRecord['payload'];
  let lastAction: RunRecord['server_action'];
  let lastValidation: RunRecord['validation'];
  let lastExecution: RunRecord['execution'];
  let lastProvider: string | undefined;
  let lastTimings: StageTimings = zeroTimings();
  const recentActions: string[] = [];

  await chrome.storage.local.set({ pl_last_tab: tabId });
  try {
    const { serverUrl, guided } = await loadSettings();
    base.guided = guided;
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedTabUrl(tab.url)) {
      const rec: RunRecord = {
        ...base, status: 'error',
        error: 'Cannot run on chrome:// or other restricted pages. Open a normal http/https site (e.g. localhost demo).',
        error_code: 'restricted_url',
        url: tab.url,
        privacy: { sensitive_items: 0, redacted: 0, raw_pii_sent: 0, firewall: { allowed: true, redactions: 0, violations: 0, checked_strings: 0 }, network: 'NOT_SENT', by_type: {} },
        timings: { dom_scan_ms: 0, detect_ms: 0, redact_ms: 0, verify_ms: 0, perception_total_ms: 0, total_ms: 0 },
      };
      await save(rec); return rec;
    }
    base.url = tab.url ? new URL(tab.url).origin + new URL(tab.url).pathname : undefined;

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (performance.now() - t0 - paused > MAX_TASK_TIME_MS) {
        events.push({ ts: Date.now(), type: 'error', label: `Task timeout after ${MAX_TASK_TIME_MS / 1000}s`, level: 'bad' });
        break;
      }

      await setStage(`Step ${step}/${MAX_STEPS}: Perceiving locally`, 1);
      const per = await sendToTab<PerceiveResult>(tabId, { type: 'PERCEIVE', task, guided: guided && step === 1 });
      if (!per.ok) throw new AgentError('perception_failed', per.error ?? 'Perception failed');
      paused += (per as {paused_ms?: number}).paused_ms ?? 0;
      if (Array.isArray((per as {events?: unknown[]}).events)) events.push(...(per as {events: EventItem[]}).events);
      keepOcr = (per.stats as {ocr?: unknown}).ocr as RunRecord["ocr"];
      lastResources = per.resources;
      lastTimings = { ...per.timings };
      const priv = { sensitive_items: per.stats.sensitive_items, redacted: per.stats.redacted, by_type: per.stats.by_type };
      keepPriv = { ...priv, raw_pii_sent: 0, firewall: per.report, network: 'NOT_SENT' };

      if (per.blocked || !per.payload) {
        const rec: RunRecord = {
          ...base, status: 'blocked', error: per.report.reason ?? 'Blocked by firewall', error_code: 'privacy_violation', events,
          privacy: { ...priv, raw_pii_sent: 0, firewall: per.report, network: 'BLOCKED' },
          timings: { ...per.timings, total_ms: round(performance.now() - t0 - paused) },
          resources: per.resources, ocr: per.stats.ocr,
        };
        await save(rec); return rec;
      }
      lastPayload = per.payload;

      await setStage(`Step ${step}: Verifying outbound payload`, 3);
      const s0 = performance.now();
      const second = verifyPayload(per.payload, []);
      per.timings.verify_ms = round((per.timings.verify_ms ?? 0) + (performance.now() - s0));
      if (!second.allowed) {
        events.push({ ts: Date.now(), type: 'verify', label: 'Second-layer check BLOCKED the request', level: 'bad' });
        const rec: RunRecord = {
          ...base, status: 'blocked', error: 'Second-layer firewall check failed', error_code: 'privacy_violation', events,
          privacy: { ...priv, raw_pii_sent: 0, firewall: per.report, second_layer: second, network: 'BLOCKED' },
          timings: { ...per.timings, total_ms: round(performance.now() - t0 - paused) },
          resources: per.resources, ocr: per.stats.ocr,
        };
        await save(rec); return rec;
      }

      await setStage(`Step ${step}: Sanitized context → remote agent`, 4);
      if (guided && step === 1) { await sleep(STEP_PAUSE_MS); paused += STEP_PAUSE_MS; }
      events.push({ ts: Date.now(), type: 'send', label: `Step ${step}: sanitized request (${per.resources.payload_bytes} bytes)` });
      const { body, network_ms } = await postToAgent(serverUrl, per.payload);
      const b = body as Record<string, unknown>;
      events.push({ ts: Date.now(), type: 'response', label: `Step ${step}: action received` });
      lastTimings = { ...per.timings, network_ms, server_ai_ms: typeof b?.server_ms === 'number' ? b.server_ms : undefined };
      lastProvider = typeof b?.provider === 'string' ? b.provider : undefined;

      const priv2: NonNullable<RunRecord['privacy']> = {
        ...priv, raw_pii_sent: 0, firewall: per.report, second_layer: second, network: 'SANITIZED',
      };
      keepPriv = priv2;

      const parsed = parseAction(body);
      if (!parsed.ok) {
        events.push({ ts: Date.now(), type: 'validate', label: `Action BLOCKED (${parsed.code})`, level: 'bad' });
        const rec: RunRecord = {
          ...base, status: 'action_rejected', error: parsed.reason, error_code: parsed.code,
          privacy: priv2, payload: per.payload, events, ocr: per.stats.ocr,
          validation: { allowed: false, code: parsed.code, reason: parsed.reason },
          timings: { ...lastTimings, total_ms: round(performance.now() - t0 - paused) },
          resources: per.resources,
        };
        await save(rec); return rec;
      }

      // Completion / none action ends the loop
      if (parsed.action.action === 'none') {
        events.push({ ts: Date.now(), type: 'complete', label: `Task complete (agent returned none) after ${step} step(s)` });
        const rec: RunRecord = {
          ...base, status: 'completed', privacy: priv2, payload: per.payload,
          server_action: parsed.action, provider: lastProvider, events, ocr: per.stats.ocr,
          validation: { allowed: true, action: parsed.action },
          execution: { executed: true, detail: 'no-op (none)' },
          timings: { ...lastTimings, total_ms: round(performance.now() - t0 - paused) },
          resources: per.resources,
        };
        await save(rec); return rec;
      }

      // Repeated-action detection
      const actionKey = `${parsed.action.action}:${parsed.action.element_id ?? ''}:${parsed.action.direction ?? ''}:${parsed.action.text ?? ''}`;
      if (recentActions.filter((a) => a === actionKey).length >= 2) {
        events.push({ ts: Date.now(), type: 'error', label: 'Repeated action detected — stopping to avoid loop', level: 'warn' });
        const rec: RunRecord = {
          ...base, status: 'completed', error: 'Stopped: repeated action', error_code: 'repeated_action',
          privacy: priv2, payload: per.payload, server_action: parsed.action, provider: lastProvider,
          events, ocr: per.stats.ocr,
          timings: { ...lastTimings, total_ms: round(performance.now() - t0 - paused) },
          resources: per.resources,
        };
        await save(rec); return rec;
      }
      recentActions.push(actionKey);
      if (recentActions.length > 6) recentActions.shift();

      const ex = await sendToTab<{
        ok: boolean; validation: ValidationResult; validate_ms?: number; exec_ms?: number;
        execution: ExecutionResult; events?: EventItem[]; paused_ms?: number;
      }>(tabId, { type: 'EXECUTE', action: parsed.action, guided: guided && step === 1 });
      paused += ex.paused_ms ?? 0;
      if (ex.events) events.push(...ex.events);
      lastTimings.validate_ms = ex.validate_ms;
      lastTimings.exec_ms = ex.exec_ms;
      lastAction = parsed.action;
      lastValidation = ex.validation;
      lastExecution = ex.execution;

      if (!ex.validation.allowed) {
        const rec: RunRecord = {
          ...base, status: 'action_rejected', error: ex.validation.reason, error_code: ex.validation.code,
          privacy: priv2, payload: per.payload, server_action: parsed.action, provider: lastProvider,
          validation: ex.validation, execution: ex.execution, events, ocr: per.stats.ocr,
          timings: { ...lastTimings, total_ms: round(performance.now() - t0 - paused) },
          resources: per.resources,
        };
        await save(rec); return rec;
      }

      if (!ex.execution.executed) {
        events.push({ ts: Date.now(), type: 'error', label: `Execution failed: ${ex.execution.detail ?? 'unknown'}`, level: 'bad' });
        // Continue to re-perceive if possible (stale target recovery)
        if (step === MAX_STEPS) break;
        continue;
      }

      // Successful action — if navigation or significant mutation, re-perceive on next iteration
      if (ex.execution.navigated || (ex.execution.mutations ?? 0) > 0 || step < MAX_STEPS) {
        events.push({ ts: Date.now(), type: 'step', label: `Step ${step} done → re-perceive` });
        // Small settle delay after DOM mutation / navigation
        await sleep(150);
        continue;
      }
      break;
    }

    // Final record after loop
    lastTimings.total_ms = round(performance.now() - t0 - paused);
    const ok = lastValidation?.allowed && (lastExecution?.executed || lastAction?.action === 'none');
    const rec: RunRecord = {
      ...base,
      status: !lastValidation?.allowed ? 'action_rejected' : ok ? 'completed' : 'error',
      privacy: keepPriv,
      payload: lastPayload,
      server_action: lastAction,
      provider: lastProvider,
      validation: lastValidation,
      execution: lastExecution,
      timings: lastTimings,
      resources: lastResources,
      ocr: keepOcr,
      events,
      error: lastValidation?.allowed
        ? (ok ? undefined : lastExecution?.detail)
        : lastValidation?.reason,
      error_code: lastValidation?.allowed
        ? (ok ? undefined : 'execution_failed')
        : lastValidation?.code,
    };
    await save(rec); return rec;
  } catch (e) {
    const code = e instanceof AgentError ? e.code : 'internal_error';
    events.push({ ts: Date.now(), type: 'error', label: e instanceof AgentError ? e.message : 'Internal error', level: 'bad' });
    const rec: RunRecord = {
      ...base, status: 'error',
      error: e instanceof AgentError ? e.message : safeError(e),
      error_code: code, events, ocr: keepOcr,
      privacy: keepPriv ?? {
        sensitive_items: 0, redacted: 0, raw_pii_sent: 0,
        firewall: { allowed: true, redactions: 0, violations: 0, checked_strings: 0 },
        network: 'NOT_SENT', by_type: {},
      },
      timings: { ...zeroTimings(), total_ms: round(performance.now() - t0 - paused) },
    };
    await save(rec); return rec;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.target === 'offscreen') return false;
  (async () => {
    switch (msg?.type) {
      case 'RUN_TASK': return runTask(msg.tabId, String(msg.task ?? '').slice(0, 500));
      case 'RUN_TASK_FROM_PAGE':
      case 'RUN_TASK_ACTIVE': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'no_active_tab' };
        return runTask(tab.id, String(msg.task ?? '').slice(0, 500));
      }
      case 'OPEN_DASHBOARD': {
        await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
        return { ok: true };
      }
      case 'STOP_TASK': {
        await chrome.storage.local.set({ pl_status: { stage: 'idle', ts: Date.now() } });
        return { ok: true };
      }
      case 'GET_ASSETS': return loadAssets();
      case 'OCR_IMAGE': {
        await ensureOffscreen();
        return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OCR_RUN', dataUrl: msg.dataUrl });
      }
      case 'VISION_IMAGE': {
        await ensureOffscreen();
        return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'VISION_RUN', dataUrl: msg.dataUrl });
      }
      default: return { ok: false, error: 'unknown_message' };
    }
  })().then(send).catch((e) => send({ ok: false, error: safeError(e) }));
  return true;
});
