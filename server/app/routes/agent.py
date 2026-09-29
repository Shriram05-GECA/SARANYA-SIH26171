import logging
from fastapi import APIRouter, Depends, HTTPException
from ..agent.controller import run_agent
from ..privacy.guard import scan_payload
from ..providers import AgentProvider, ProviderError, get_provider
from ..schemas.agent import AgentRequest, AgentResponse

log = logging.getLogger("aegis")
router = APIRouter()


@router.post("/agent/execute", response_model=AgentResponse, response_model_exclude_none=True)
async def execute(req: AgentRequest, provider: AgentProvider = Depends(get_provider)):
    found = scan_payload(req.model_dump())
    if found:
        # Counts only. Values are never logged or echoed.
        log.warning("privacy guard rejected request: %s", {k: v for k, v in found.items()})
        raise HTTPException(status_code=422, detail={"error": "privacy_violation", "types": sorted(found), "message": "Payload contains unredacted sensitive values"})
    try:
        res = await run_agent(req, provider)
    except ProviderError as e:
        raise HTTPException(status_code=e.status, detail={"error": "provider_error", "message": e.public})
    log.info("action=%s elements=%d server_ms=%.1f provider=%s", res.action, len(req.page.elements), res.server_ms, res.provider.split(" ")[0])
    return res
