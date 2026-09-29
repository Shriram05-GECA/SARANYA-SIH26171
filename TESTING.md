# AEGIS — Step-by-step testing guide

This guide walks a judge or developer through verifying the **SIH-hardened** AEGIS build after the final upgrade pass.

## Prerequisites

- Chrome / Chromium 116+
- Node 18+ (for rebuild/tests)
- Python 3.10+ (for agent server)

## 1. Install & build

```bash
cd privacy-agent
npm install
npm run build          # produces extension/dist
```

Optional unit tests:

```bash
npm test
```

## 2. Start the agent server

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # leave AI_API_KEY empty for deterministic demo fallback
cd ..
npm run server
# → http://127.0.0.1:8000
```

Health check: open `http://127.0.0.1:8000/health` — should report provider `demo_fallback` when no API key is set.

## 3. Start demo sites

```bash
# from repo root
npm run demo
# → http://127.0.0.1:5500
```

Recommended page: **SecureBank Demo**  
`http://127.0.0.1:5500/securebank/`

Also available: government portal, banking, healthcare.

## 4. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `privacy-agent/extension/dist`
4. Pin the AEGIS icon

## 5. Core privacy demo (guided)

Open SecureBank Demo, then run these steps from the extension **popup** or **dashboard**.

| Step | What you do | What you should see |
|------|-------------|---------------------|
| 1 | Page shows Username, Password, CAPTCHA | Local values exist only in the browser |
| 2 | Click extension → optional **Highlight sensitive items** | Fields outlined |
| 3 | Task: `Login` or `Click Login` → **Run** | Dashboard status → **● PRIVACY FIREWALL ACTIVE** |
| 4 | Open **Dashboard** → Overview | **RAW SENSITIVE DATA SENT = 0** |
| 5 | Tab **Redaction** | Password / CAPTCHA shown as `••••••••`, not the real value |
| 6 | Tab **Sanitized context** | Tree with `[REDACTED_PASSWORD]` / `[REDACTED_CAPTCHA]` style tokens; **View payload** JSON has no raw secrets |
| 7 | **Privacy verification** panel | Raw values found in payload = **0** · **VERIFIED SAFE** |
| 8 | Tab **Agent action** | Agent returns `click` on login; local policy **Allowed**; execution **Completed** |
| 9 | Browser | Login succeeds on the demo page |

### Demo step indicator (conceptual)

```
01 Detect → 02 Redact → 03 Verify → 04 Reason → 05 Validate → 06 Execute
```

All of these happen on-device except **04 Reason** (remote agent receives sanitized context only).

## 6. Privacy checks checklist

- [ ] Password never appears in payload JSON
- [ ] CAPTCHA text never appears in payload JSON
- [ ] Account number / card / phone redacted in payload
- [ ] Independent verification reports **0** raw hits
- [ ] Dashboard never displays real password / OTP / CAPTCHA / card numbers
- [ ] OCR timing shows **— Not required** when OCR did not run (not `0.0 ms`)
- [ ] WebGPU shown as Available/Unavailable, not claimed as used

## 7. Evaluation tab

Dashboard → **Evaluation**:

- Live run history with Total / Local / Network / Exec columns
- Mean, Median, Samples, Range (p95 only if enough samples)
- Offline DOM / OCR metrics loaded from `benchmark-report.json` (sample sizes visible)
- Label: **Synthetic evaluation dataset**

Regenerate offline report (optional):

```bash
npm run eval
npm run build
```

## 8. Error / security states

| Scenario | Expected UI |
|----------|-------------|
| Server stopped | **SERVER OFFLINE** — privacy still active |
| Force raw PII into payload (tests only) | **REQUEST BLOCKED** / firewall blocked |
| Invalid agent action (`execute_javascript`, etc.) | **ACTION BLOCKED** by local validator |
| OCR unavailable | DOM privacy remains active |

## 9. Server tests

```bash
cd server
source .venv/bin/activate
pytest -q
```

## 10. Rebuild after edits

```bash
npm run build
# then reload the extension on chrome://extensions
```

## Architecture reminder

```
┌──────────── USER DEVICE ──────────────┐
│ Browser → Local Perception (DOM+OCR)  │
│ → Sensitive Information Firewall      │
│   Detect → Redact → Verify            │
│ → Sanitized Context only              │
└──────────────────┬────────────────────┘
                   │ SAFE CONTEXT ONLY
                   ▼
             Remote AI Agent
                   │ structured action
                   ▼
             Local Action Validator → Browser
```

---

**Product:** AEGIS — On-device Visual Privacy Firewall  
**Problem statement:** SIH26171
