import json
import httpx
from pydantic import ValidationError
from .base import AgentProvider, ProviderError
from ..schemas.agent import AgentAction, AgentRequest
from ..utils.config import Settings

SYSTEM = """You control a web browser on behalf of a user. You only see a SANITIZED description of the page:
sensitive values were replaced by [REDACTED] on the user's device; never try to recover or guess them.
Choose ONE next action that best advances the user's task. Optional "visual" is sanitized local CV grounding (labels/boxes only — no pixels). Prefer DOM elements; use visual cues only as hints. Reply with a single JSON object and nothing else:
{"action": "click|scroll|type|select|navigate|none", "element_id": "<id from the page or omit>", "direction": "up|down|top|bottom" (scroll only),
 "amount": <pixels, scroll only>, "text": "<text, type only>", "value": "<option text, select only>", "url": "<same-origin url, navigate only>",
 "confidence": <0..1>, "reason": "<one short sentence>"}
Rules: element_id MUST be copied exactly from the provided elements. Never target elements marked sensitive. Never type into password
or sensitive fields. Never output code, selectors or scripts. If nothing fits, use {"action":"none"} with a reason."""


class OpenAICompatProvider(AgentProvider):
    def __init__(self, settings: Settings):
        self.s = settings
        self.name = f"openai-compatible:{settings.model}"

    async def generate_action(self, context: AgentRequest) -> AgentAction:
        body = {
            "model": self.s.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": json.dumps({"task": context.task, "page": context.page.model_dump(exclude_none=True), "visual": (context.visual.model_dump(exclude_none=True) if getattr(context, "visual", None) else None)}, ensure_ascii=False)},
            ],
        }
        if self.s.json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            async with httpx.AsyncClient(timeout=self.s.timeout_s) as c:
                r = await c.post(f"{self.s.base_url}/chat/completions", json=body, headers={"Authorization": f"Bearer {self.s.api_key}"})
        except httpx.TimeoutException:
            raise ProviderError("AI provider timed out", 504)
        except httpx.HTTPError:
            raise ProviderError("AI provider unreachable", 502)
        if r.status_code >= 400:
            raise ProviderError(f"AI provider returned HTTP {r.status_code}", 502)
        try:
            text = r.json()["choices"][0]["message"]["content"].strip()
            if text.startswith("```"):
                text = text.strip("`").removeprefix("json").strip()
            return AgentAction.model_validate(json.loads(text))
        except (KeyError, IndexError, ValueError, ValidationError):
            raise ProviderError("AI provider returned an invalid response", 502)
