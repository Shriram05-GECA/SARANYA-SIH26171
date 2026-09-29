"""DEVELOPMENT / DEMO FALLBACK — a deterministic keyword matcher. It is NOT an LLM.

It only operates on pages that declare themselves as AEGIS demo sites, and is used when no AI_API_KEY is set.
"""
import re
from .base import AgentProvider
from ..schemas.agent import AgentAction, AgentRequest, PageElement

STOP = {"the", "a", "an", "my", "me", "to", "please", "of", "for", "and", "on", "in", "go", "now", "can", "you", "i", "want", "would", "like", "page"}
SYN = {"open": "view", "show": "view", "see": "view", "check": "view", "display": "view", "statement": "history", "transactions": "transaction"}
GENERIC = {"view", "open", "my"}
LABEL = "DEV/DEMO FALLBACK (deterministic keyword matcher, not an LLM)"


def _stem(w: str) -> str:
    w = SYN.get(w, w)
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def _tokens(s: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP]


class DemoFallbackProvider(AgentProvider):
    name = LABEL

    async def generate_action(self, context: AgentRequest) -> AgentAction:
        page, task = context.page, context.task
        if not page.demo_site:
            return AgentAction(action="none", confidence=0.0, reason=f"{LABEL} only works on the bundled demo sites. Set AI_API_KEY to use a real model.")
        t = task.lower()
        m = re.search(r"\b(scroll|page down|page up|move down|move up|go down|go up)\b", t)
        if m:
            d = "up" if re.search(r"\b(up|top)\b", t) else "down"
            if "top" in t: d = "top"
            if "bottom" in t or "end" in t: d = "bottom"
            return AgentAction(action="scroll", direction=d, amount=600, confidence=0.9, reason=f"Task asks to scroll {d}. [{LABEL}]")

        tm = re.match(r"\s*(?:type|enter|search(?: for)?)\s+[\"']?(.+?)[\"']?(?:\s+(?:in|into)\s+(?:the\s+)?(.+))?\s*$", task, re.I)
        if tm:
            inputs = [e for e in page.elements if e.type == "input" and not e.sensitive and (e.input_type or "text") in ("text", "search", "textarea")]
            if inputs:
                target = inputs[0]
                if tm.group(2):
                    want = set(_tokens(tm.group(2)))
                    scored = sorted(inputs, key=lambda e: -len(want & set(_tokens((e.label or "") + " " + (e.placeholder or "")))))
                    target = scored[0]
                return AgentAction(action="type", element_id=target.id, text=tm.group(1).strip(), confidence=0.7, reason=f"Typing task text into the best matching text field. [{LABEL}]")

        toks = _tokens(task)
        n = max(len(toks), 1)
        weights = {tok: 1 + i / n for i, tok in enumerate(toks)}
        best: tuple[float, PageElement | None] = (0.0, None)
        for e in page.elements:
            if e.type not in ("button", "link") or e.disabled or e.sensitive:
                continue
            et = set(_tokens(e.text or ""))
            if not et:
                continue
            score = sum(w for tok, w in weights.items() if tok in et)
            core = {x for x in et if x not in GENERIC}
            if core and core <= set(toks):
                score += 1.0
            if score > best[0]:
                best = (score, e)
        score, el = best
        if el is None or score < 1.0:
            return AgentAction(action="none", confidence=0.2, reason=f"No visible control matches the task. [{LABEL}]")
        return AgentAction(action="click", element_id=el.id, confidence=round(min(0.98, 0.55 + 0.12 * score), 2),
                           reason=f"'{el.text}' best matches the task keywords. [{LABEL}]")
