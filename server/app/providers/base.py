from abc import ABC, abstractmethod
from ..schemas.agent import AgentAction, AgentRequest


class ProviderError(Exception):
    """Raised for provider failures. `public` is safe to return to the client (never contains page data)."""

    def __init__(self, public: str, status: int = 502):
        super().__init__(public)
        self.public = public
        self.status = status


class AgentProvider(ABC):
    name: str = "provider"

    @abstractmethod
    async def generate_action(self, context: AgentRequest) -> AgentAction:
        """Return exactly one structured action for the sanitized context."""
