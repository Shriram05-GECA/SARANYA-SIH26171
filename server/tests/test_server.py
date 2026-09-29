import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.providers import get_provider, DemoFallbackProvider
from app.providers.base import AgentProvider, ProviderError
from app.privacy.guard import scan_payload
from app.schemas.agent import AgentAction

client = TestClient(app)
ELEMENTS = [
    {"id": "link_my_applications", "type": "link", "text": "My Applications"},
    {"id": "btn_view_details", "type": "button", "text": "View Details"},
    {"id": "btn_transaction_history", "type": "button", "text": "Transaction History"},
    {"id": "btn_download", "type": "button", "text": "Download"},
    {"id": "email", "type": "text", "label": "Email", "content": "[REDACTED]", "sensitive": True},
]


def req(task, demo=True, elements=None):
    return {"task": task, "page": {"title": "Application Dashboard", "page_type": "government_portal", "demo_site": demo, "elements": elements or ELEMENTS}}


@pytest.fixture(autouse=True)
def fallback(monkeypatch):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    app.dependency_overrides.clear()


def test_health_reports_fallback_honestly():
    j = client.get("/health").json()
    assert j["is_llm"] is False and "not an LLM" in j["provider"]


@pytest.mark.parametrize("task,el", [("Open my application details.", "btn_view_details"), ("Open transaction history.", "btn_transaction_history")])
def test_click_tasks(task, el):
    r = client.post("/agent/execute", json=req(task))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["action"] == "click" and j["element_id"] == el and 0 < j["confidence"] <= 1 and j["reason"]


def test_scroll_task():
    j = client.post("/agent/execute", json=req("Scroll down.")).json()
    assert j["action"] == "scroll" and j["direction"] == "down"


def test_fallback_refuses_non_demo_pages():
    j = client.post("/agent/execute", json=req("Open my application details", demo=False)).json()
    assert j["action"] == "none"


def test_malformed_request_is_validation_error_and_does_not_echo_input():
    r = client.post("/agent/execute", json={"task": "", "page": {"elements": [{"id": "x y", "type": "bogus", "text": "secret-looking"}]}})
    assert r.status_code == 422
    assert "secret-looking" not in r.text and r.json()["detail"]["error"] == "validation_error"


def test_missing_task_rejected():
    assert client.post("/agent/execute", json={"page": {"elements": []}}).status_code == 422


@pytest.mark.parametrize("bad", ["shriram@example.com", "9876543210", "ABCDE1234F", "2345 6789 0123", "4111 1111 1111 1111", "123456789012", "APP-2026-001"])
def test_privacy_guard_blocks_raw_pii(bad):
    els = ELEMENTS + [{"id": "leak", "type": "text", "content": f"Value {bad}"}]
    r = client.post("/agent/execute", json=req("Open my application details", elements=els))
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "privacy_violation"
    assert bad not in r.text


def test_guard_allows_sanitized():
    assert scan_payload(req("Open my application details")) == {}
    assert scan_payload({"a": "₹1,25,000.00 on 2026-01-22"}) == {}


class BadProvider(AgentProvider):
    name = "bad"
    def __init__(self, action): self.action = action
    async def generate_action(self, context): return self.action


def test_provider_choosing_missing_element_is_rejected():
    app.dependency_overrides[get_provider] = lambda: BadProvider(AgentAction(action="click", element_id="nope"))
    assert client.post("/agent/execute", json=req("x")).status_code == 502


def test_provider_choosing_sensitive_element_is_rejected():
    app.dependency_overrides[get_provider] = lambda: BadProvider(AgentAction(action="click", element_id="email"))
    assert client.post("/agent/execute", json=req("x")).status_code == 502


def test_provider_failure_message_is_sanitized():
    class Boom(AgentProvider):
        name = "boom"
        async def generate_action(self, context): raise ProviderError("AI provider timed out", 504)
    app.dependency_overrides[get_provider] = lambda: Boom()
    r = client.post("/agent/execute", json=req("x"))
    assert r.status_code == 504 and "timed out" in r.text


def test_default_provider_is_fallback_without_key():
    assert isinstance(get_provider(), DemoFallbackProvider)
