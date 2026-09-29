import type { AgentPayload } from '../types';

export class AgentError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const DEFAULT_SERVER = 'http://localhost:8000';

/** POSTs an already-verified, sanitized payload. Never falls back to anything else on failure. */
export async function postToAgent(serverUrl: string, payload: AgentPayload, timeoutMs = 25000): Promise<{ body: unknown; network_ms: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(serverUrl.replace(/\/$/, '') + '/agent/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal,
    });
    const network_ms = Math.round((performance.now() - t0) * 10) / 10;
    let body: unknown = null;
    try { body = await res.json(); } catch { throw new AgentError('invalid_server_response', 'Server returned a non-JSON response'); }
    if (res.status === 422) throw new AgentError('server_rejected_payload', 'Server rejected the request (validation or privacy guard)');
    if (res.status === 504) throw new AgentError('ai_provider_timeout', 'AI provider timed out');
    if (res.status >= 500) throw new AgentError('ai_provider_failure', 'Agent server or AI provider failed');
    if (!res.ok) throw new AgentError('server_error', `Server returned HTTP ${res.status}`);
    return { body, network_ms };
  } catch (e) {
    if (e instanceof AgentError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new AgentError('network_timeout', 'Request to agent server timed out');
    throw new AgentError('server_unavailable', 'Agent server is unreachable (is it running on ' + serverUrl + '?)');
  } finally { clearTimeout(timer); }
}
