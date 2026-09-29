"""Real-Chrome end-to-end test: loads the built extension, drives the demo portal, inspects the actual network request.
Requires: server on :8000, demo site on :5500, `npm run build`, playwright (pip) with Chromium.
Run headless-safe with:  xvfb-run -a python3 evaluation/scripts/browser_e2e.py
"""
import json, os, sys, tempfile, time
from pathlib import Path
os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EXT = str(ROOT / "extension" / "dist")
SITE = os.environ.get("DEMO_URL", "http://localhost:5500/government/")
RAW = ["Shriram Vaidya", "shriram@example.com", "9876543210", "123 Example Street", "123456789012", "APP-2026-001",
       "ABCDE1234F", "2345 6789 0123", "14/03/2001", "Demo@Pass123", "4111 1111 1111 1111", "4111111111111111"]
out = {"checks": [], "runs": []}


def check(name, ok, detail=""):
    out["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=False, args=[
        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--no-sandbox", "--window-size=1280,900"])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    ext_id = sw.url.split("/")[2]
    sent = []
    ctx.on("request", lambda r: sent.append(r) if ":8000/agent/execute" in r.url else None)

    page = ctx.new_page(); page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(SITE); page.wait_for_load_state("load"); page.wait_for_timeout(600)
    ui = ctx.new_page(); ui.goto(f"chrome-extension://{ext_id}/popup.html")
    tab_id = ui.evaluate("async () => (await chrome.tabs.query({url: 'http://localhost:5500/*'}))[0].id")

    def run(task):
        r = ui.evaluate("async ([tabId, task]) => chrome.runtime.sendMessage({type:'RUN_TASK', tabId, task})", [tab_id, task])
        out["runs"].append({"task": task, "status": r.get("status"), "action": r.get("server_action"), "timings": r.get("timings"),
                            "privacy": {k: r["privacy"][k] for k in ("sensitive_items", "redacted", "raw_pii_sent", "network")} if r.get("privacy") else None,
                            "resources": r.get("resources"), "validation": r.get("validation"), "execution": r.get("execution"), "error": r.get("error_code")})
        return r

    # Task 1
    r1 = run("Open my application details.")
    check("task1 completed", r1["status"] == "completed", r1.get("error", ""))
    check("task1 server chose View Details", r1.get("server_action", {}).get("element_id") == "btn_view_details", json.dumps(r1.get("server_action")))
    check("task1 browser actually opened details panel", page.locator("#details-panel").is_visible())
    check("task1 raw_pii_sent == 0 and network SANITIZED", r1["privacy"]["raw_pii_sent"] == 0 and r1["privacy"]["network"] == "SANITIZED", json.dumps(r1["privacy"]["by_type"]))
    bt = r1["privacy"]["by_type"]
    check("all expected PII types detected in real Chrome", all(k in bt for k in ("name", "email", "phone", "address", "account", "application_id", "pan", "aadhaar", "dob", "password", "card")), json.dumps(bt))

    # Real network request inspection
    check("a real request reached the server", len(sent) >= 1)
    body = sent[0].post_data or "" if sent else ""
    leaked = [v for v in RAW if v.lower() in body.lower()]
    check("outgoing network body contains none of the synthetic raw PII", not leaked, f"{len(body)} bytes; leaked={len(leaked)}")
    check("outgoing body contains [REDACTED] markers", body.count("[REDACTED]") >= 6, str(body.count("[REDACTED]")))
    check("non-sensitive context preserved (status, buttons)", all(x in body for x in ("Approved", "View Details", "Transaction History", "Download", "Logout")))
    check("outgoing body has no pixel data", "data:image" not in body)
    pl = json.loads(body) if body else {"page": {"elements": []}}
    imgs = [e for e in pl["page"]["elements"] if e["type"] == "image"]
    check("visual-only PII: OCR ran locally on image + canvas", len(imgs) == 2 and all(i.get("ocr_status") == "ok" for i in imgs), json.dumps([{k: i.get(k) for k in ("id", "ocr_status", "ocr_regions_redacted", "flags")} for i in imgs]))
    check("visual-only PII: OCR text in payload is redacted", all("[REDACTED]" in (i.get("ocr_text") or "") for i in imgs))

    # Task 2
    r2 = run("Open transaction history.")
    check("task2 click Transaction History executed", r2["status"] == "completed" and r2["server_action"]["element_id"] == "btn_transaction_history" and page.locator("#txn-panel").is_visible())

    # Task 3
    y0 = page.evaluate("window.scrollY")
    r3 = run("Scroll down.")
    y1 = page.evaluate("window.scrollY")
    check("task3 scroll executed in the page", r3["status"] == "completed" and r3["server_action"]["action"] == "scroll" and y1 > y0, f"{y0}->{y1}")

    # Local validation rejects a hostile action even if a server were compromised
    bad = page.evaluate("""async () => 1""")  # placeholder to keep page alive
    res = ui.evaluate("""async (tabId) => chrome.tabs.sendMessage(tabId, {type:'EXECUTE', action:{action:'execute_javascript', code:'alert(1)'}})""", tab_id)
    check("hostile action blocked by local validator", res["validation"]["allowed"] is False, res["validation"].get("code", ""))
    res = ui.evaluate("""async (tabId) => chrome.tabs.sendMessage(tabId, {type:'EXECUTE', action:{action:'click', element_id:'field_password'}})""", tab_id)
    check("click on password field blocked", res["validation"]["allowed"] is False, res["validation"].get("code", ""))

    # Fail closed: server down -> nothing else is sent
    n = len(sent)
    ui.evaluate("chrome.storage.local.set({pl_settings:{serverUrl:'http://localhost:8999'}})")
    r4 = run("Open my application details")
    check("server unavailable -> fail closed, no fallback", r4["status"] == "error" and r4["error_code"] == "server_unavailable" and len(sent) == n, r4.get("error_code", ""))
    ui.evaluate("chrome.storage.local.remove('pl_settings')")

    run("Open my application details")  # successful run so the dashboard has a payload to verify
    # Dashboard renders and independently verifies
    ui.goto(f"chrome-extension://{ext_id}/dashboard.html"); ui.wait_for_timeout(800)
    Path(ROOT / "evaluation/reports").mkdir(exist_ok=True, parents=True)
    ui.screenshot(path=str(ROOT / "evaluation/reports/dashboard_overview.png"))
    ui.click("button[data-k=redaction]"); ui.wait_for_timeout(1500)
    txt = ui.inner_text("#view")
    check("dashboard shows RAW PII TRANSMITTED: 0", "RAW PII TRANSMITTED: 0" in txt)
    ui.screenshot(path=str(ROOT / "evaluation/reports/dashboard_redaction.png"), full_page=True)
    ctx.close()

(ROOT / "evaluation/reports/browser_e2e.json").write_text(json.dumps(out, indent=2))
failed = [c for c in out["checks"] if not c["ok"]]
print(f"\n{len(out['checks']) - len(failed)}/{len(out['checks'])} checks passed")
sys.exit(1 if failed else 0)
