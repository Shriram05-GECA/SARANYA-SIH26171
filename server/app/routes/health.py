from fastapi import APIRouter
from ..providers import get_provider

router = APIRouter()


@router.get("/health")
async def health():
    p = get_provider()
    return {"status": "ok", "provider": p.name, "is_llm": not p.name.startswith("DEV/DEMO")}
