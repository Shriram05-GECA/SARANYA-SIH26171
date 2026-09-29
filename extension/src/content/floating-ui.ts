/**
 * Compact on-page SARANYA control panel (SIH26171 Phase 11).
 * Small floating shield → expandable panel. Does not replace popup/dashboard.
 */

type PanelState = {
  open: boolean;
  running: boolean;
  step?: string;
  status?: string;
  privacy?: string;
  backend?: string;
  lastAction?: string;
};

const ROOT_ID = 'aegis-floating-root';
let state: PanelState = { open: false, running: false };

function ensureStyles(): void {
  if (document.getElementById('aegis-floating-css')) return;
  const s = document.createElement('style');
  s.id = 'aegis-floating-css';
  s.textContent = `
#${ROOT_ID}{all:initial;position:fixed;z-index:2147483646;right:16px;bottom:16px;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:12.5px;line-height:1.4;color:#e8eef5}
#${ROOT_ID} *{box-sizing:border-box}
#${ROOT_ID} .fab{width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(145deg,#0b5c73,#0e7490);color:#fff;font-weight:700;font-size:11px;letter-spacing:.04em;box-shadow:0 6px 20px rgba(11,92,115,.45);display:flex;align-items:center;justify-content:center}
#${ROOT_ID} .fab:hover{filter:brightness(1.08)}
#${ROOT_ID} .fab.running{animation:aegis-pulse 1.2s ease-in-out infinite}
@keyframes aegis-pulse{0%,100%{box-shadow:0 0 0 0 rgba(14,116,144,.5)}50%{box-shadow:0 0 0 10px rgba(14,116,144,0)}}
#${ROOT_ID} .panel{display:none;position:absolute;right:0;bottom:56px;width:300px;background:#0f1a24;border:1px solid #243040;border-radius:14px;padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
#${ROOT_ID} .panel.open{display:block}
#${ROOT_ID} .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
#${ROOT_ID} .hd strong{font-size:13px;color:#7dd3fc}
#${ROOT_ID} .pill{font-size:10px;padding:2px 8px;border-radius:99px;background:#14532d;color:#86efac;font-weight:600}
#${ROOT_ID} .pill.warn{background:#713f12;color:#fde68a}
#${ROOT_ID} input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#0b1220;color:#e8eef5;margin:6px 0 8px}
#${ROOT_ID} .row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
#${ROOT_ID} button.act{flex:1;padding:8px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:12px}
#${ROOT_ID} button.run{background:#0e7490;color:#fff}
#${ROOT_ID} button.stop{background:#7f1d1d;color:#fecaca}
#${ROOT_ID} button.ghost{background:#1e293b;color:#cbd5e1;border:1px solid #334155}
#${ROOT_ID} .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:11px;color:#94a3b8;margin-top:6px}
#${ROOT_ID} .meta b{color:#e2e8f0;font-weight:600}
#${ROOT_ID} .foot{margin-top:8px;display:flex;gap:6px}
`;
  document.documentElement.appendChild(s);
}

function render(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const panel = root.querySelector('.panel') as HTMLElement;
  const fab = root.querySelector('.fab') as HTMLButtonElement;
  if (panel) panel.classList.toggle('open', state.open);
  if (fab) fab.classList.toggle('running', state.running);
  const set = (sel: string, text: string) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = text;
  };
  set('[data-k=step]', state.step || '—');
  set('[data-k=status]', state.status || 'Idle');
  set('[data-k=privacy]', state.privacy || 'Protected');
  set('[data-k=backend]', state.backend || '—');
  set('[data-k=action]', state.lastAction || '—');
  const pill = root.querySelector('.pill');
  if (pill) {
    pill.textContent = state.running ? 'RUNNING' : 'PRIVACY ON';
    pill.className = 'pill' + (state.running ? ' warn' : '');
  }
}

export function mountFloatingUi(): void {
  if (document.getElementById(ROOT_ID)) return;
  // Inject on every normal web page. Chrome blocks content scripts on chrome://, edge://, etc.
  try {
    const u = location.href;
    if (/^(chrome|edge|about|devtools|chrome-extension|moz-extension):/i.test(u)) return;
  } catch { /* ignore */ }

  ensureStyles();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="panel">
      <div class="hd"><strong>SARANYA</strong><span class="pill">PRIVACY ON</span></div>
      <input type="text" data-task placeholder="Task: Open transaction history" />
      <div class="row">
        <button class="act run" data-run>Run</button>
        <button class="act stop" data-stop>Stop</button>
      </div>
      <div class="meta">
        <span>Step</span><b data-k="step">—</b>
        <span>Status</span><b data-k="status">Idle</b>
        <span>Privacy</span><b data-k="privacy">Protected</b>
        <span>Backend</span><b data-k="backend">—</b>
        <span>Last action</span><b data-k="action">—</b>
      </div>
      <div class="foot">
        <button class="act ghost" data-dash style="flex:1">Dashboard</button>
      </div>
    </div>
    <button class="fab" type="button" title="SARANYA">SARANYA</button>
  `;
  document.documentElement.appendChild(root);

  root.querySelector('.fab')?.addEventListener('click', () => {
    state.open = !state.open;
    render();
  });
  root.querySelector('[data-run]')?.addEventListener('click', async () => {
    const input = root.querySelector('[data-task]') as HTMLInputElement;
    const task = (input?.value || '').trim();
    if (!task) return;
    state.running = true;
    state.status = 'Starting…';
    state.step = '1/?';
    render();
    try {
      await chrome.runtime.sendMessage({ type: 'RUN_TASK_ACTIVE', task });
    } catch {
      // Fallback: background resolves active tab from storage
      try {
        await chrome.runtime.sendMessage({ type: 'RUN_TASK_FROM_PAGE', task });
      } catch (e) {
        state.status = 'Failed to start';
        state.running = false;
        render();
      }
    }
  });
  root.querySelector('[data-stop]')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_TASK' }).catch(() => {});
    state.running = false;
    state.status = 'Stopped';
    render();
  });
  root.querySelector('[data-dash]')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }).catch(() => {});
  });

  chrome.storage.onChanged.addListener((c) => {
    if (c.pl_status?.newValue) {
      const s = c.pl_status.newValue as { stage?: string; step?: number };
      if (s.stage && s.stage !== 'idle') {
        state.running = true;
        state.status = s.stage;
        if (s.step) state.step = String(s.step);
      } else if (s.stage === 'idle') {
        state.running = false;
        state.status = 'Idle';
      }
      render();
    }
    if (c.pl_last_run?.newValue) {
      const run = c.pl_last_run.newValue as {
        status?: string;
        server_action?: { action?: string; element_id?: string };
        resources?: { vision_backend?: string; webgpu_inference_active?: boolean };
        privacy?: { raw_pii_sent?: number; network?: string };
      };
      state.running = false;
      state.status = run.status || 'Done';
      state.lastAction = run.server_action?.action
        ? `${run.server_action.action}${run.server_action.element_id ? ' ' + run.server_action.element_id : ''}`
        : '—';
      const vb = run.resources?.vision_backend;
      state.backend = vb === 'webgpu' ? 'WebGPU' : vb === 'wasm' ? 'WASM' : vb === 'unavailable' ? 'Vision off' : '—';
      if (run.privacy?.raw_pii_sent === 0) state.privacy = 'Protected · 0 raw';
      else if (run.privacy?.network === 'BLOCKED') state.privacy = 'Blocked';
      render();
    }
  });

  render();
}

export function updateFloatingFromPage(partial: Partial<PanelState>): void {
  state = { ...state, ...partial };
  render();
}
