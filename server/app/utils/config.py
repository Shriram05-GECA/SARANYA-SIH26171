import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # dotenv optional
    pass


@dataclass(frozen=True)
class Settings:
    api_key: str
    base_url: str
    model: str
    timeout_s: float
    json_mode: bool
    cors_origins: list[str]


def get_settings() -> Settings:
    return Settings(
        api_key=os.getenv("AI_API_KEY", "").strip(),
        base_url=os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        model=os.getenv("AI_MODEL", "gpt-4o-mini"),
        timeout_s=float(os.getenv("AI_TIMEOUT_S", "20")),
        json_mode=os.getenv("AI_JSON_MODE", "true").lower() != "false",
        cors_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()],
    )
