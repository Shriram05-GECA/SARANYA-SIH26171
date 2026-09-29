import type { AgentAction, ExecutionResult } from '../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function flash(el: Element) {
  const h = el as HTMLElement;
  const prev = h.style.outline;
  h.style.outline = '3px solid #12a150';
  setTimeout(() => { h.style.outline = prev; }, 900);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
}

/** Executes an ALREADY VALIDATED action. Never evaluates code; only dispatches DOM events / scroll / navigation. */
export async function executeAction(doc: Document, action: AgentAction, el: Element | null): Promise<ExecutionResult> {
  const win = doc.defaultView!;
  let mutations = 0;
  const mo = new win.MutationObserver((m) => { mutations += m.filter((r) => !(r.type === 'attributes' && r.attributeName?.startsWith('data-aegis')) && !(r.type === 'attributes' && r.attributeName === 'style')).length; });
  mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const y0 = win.scrollY;
  try {
    switch (action.action) {
      case 'none': return { executed: false, detail: 'No action needed' };
      case 'scroll': {
        const amt = action.amount ?? 600;
        const dir = action.direction!;
        const top = dir === 'top' ? -1e9 : dir === 'bottom' ? 1e9 : dir === 'up' ? -amt : amt;
        win.scrollBy({ top, left: 0, behavior: 'auto' });
        await sleep(120);
        return { executed: true, detail: `scroll ${dir}`, scroll_delta: Math.round(win.scrollY - y0), mutations };
      }
      case 'click': {
        if (!el) return { executed: false, detail: 'target missing' };
        flash(el);
        const isNav = el.tagName === 'A' && (el as HTMLAnchorElement).href && !(el as HTMLAnchorElement).href.startsWith('#') && (el as HTMLAnchorElement).getAttribute('href') !== '#';
        if (isNav) { setTimeout(() => (el as HTMLElement).click(), 60); return { executed: true, detail: 'click dispatched (navigation link)', navigated: true }; }
        (el as HTMLElement).click();
        await sleep(250);
        return { executed: true, detail: 'click', mutations };
      }
      case 'type': {
        if (!el) return { executed: false, detail: 'target missing' };
        const inp = el as HTMLInputElement;
        inp.focus();
        setNativeValue(inp, action.text ?? '');
        inp.dispatchEvent(new win.Event('input', { bubbles: true }));
        inp.dispatchEvent(new win.Event('change', { bubbles: true }));
        flash(el);
        await sleep(150);
        return { executed: true, detail: 'type', mutations };
      }
      case 'select': {
        if (!el) return { executed: false, detail: 'target missing' };
        const sel = el as HTMLSelectElement;
        const v = (action.value ?? '').trim().toLowerCase();
        const opt = Array.from(sel.options).find((o) => o.text.trim().toLowerCase() === v);
        if (!opt) return { executed: false, detail: 'option missing' };
        sel.value = opt.value;
        sel.dispatchEvent(new win.Event('input', { bubbles: true }));
        sel.dispatchEvent(new win.Event('change', { bubbles: true }));
        flash(el);
        return { executed: true, detail: 'select', mutations };
      }
      case 'navigate': {
        setTimeout(() => win.location.assign(action.url!), 60);
        return { executed: true, detail: 'navigate dispatched', navigated: true };
      }
    }
  } finally { setTimeout(() => mo.disconnect(), 400); }
}
