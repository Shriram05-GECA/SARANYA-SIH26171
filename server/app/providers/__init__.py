from .base import AgentProvider, ProviderError
from .demo_fallback import DemoFallbackProvider
from .openai_compat import OpenAICompatProvider
from ..utils.config import get_settings


def get_provider() -> AgentProvider:
    s = get_settings()
    if s.api_key:
        return OpenAICompatProvider(s)
    return DemoFallbackProvider()


__all__ = ["AgentProvider", "ProviderError", "DemoFallbackProvider", "OpenAICompatProvider", "get_provider"]
