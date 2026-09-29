import time
from ..providers import AgentProvider, ProviderError
from ..schemas.agent import AgentRequest, AgentResponse

INTERACTIVE = {"button", "link", "input", "select", "checkbox", "radio"}


def check_action(req: AgentRequest, a) -> None:
    """Server-side sanity check; the extension re-validates everything locally regardless."""
    if a.action in ("click", "type", "select"):
        ids = {e.id: e for e in req.page.elements}
        el = ids.get(a.element_id or "")
        if el is None or el.type not in INTERACTIVE:
            raise ProviderError("AI provider chose an element that is not on the page", 502)
        if el.sensitive:
            raise ProviderError("AI provider chose a sensitive element", 502)
    if a.action == "scroll" and not a.direction:
        raise ProviderError("AI provider returned a scroll without direction", 502)


async def run_agent(req: AgentRequest, provider: AgentProvider) -> AgentResponse:
    t0 = time.perf_counter()
    action = await provider.generate_action(req)
    check_action(req, action)
    return AgentResponse(**action.model_dump(), provider=provider.name, server_ms=round((time.perf_counter() - t0) * 1000, 2))
