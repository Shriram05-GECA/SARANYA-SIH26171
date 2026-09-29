# AEGIS

**An on-device Sensitive Information Firewall that lets browser agents operate without exposing sensitive user information.**

Built for Smart India Hackathon 2026 — PS **SIH26171**, *On-device Visual Perception for Light-weight Browser Agents*.

## Problem

Browser agents that "see" a page (DOM, screenshots) ship that page to a remote model. On a bank, government or hospital portal
that means names, account numbers, PAN/Aadhaar, phone numbers and passwords leave the user's device just so the model can find a "View Details" button.

## Solution

```
LOCAL PERCEPTION -> LOCAL DETECTION -> LOCAL REDACTION -> SENSITIVE INFORMATION FIREWALL -> SANITIZED CONTEXT
        -> REMOTE AI REASONING -> ACTION JSON -> LOCAL VALIDATION -> LOCAL EXECUTION
```

The Chrome extension is the privacy boundary. The server only ever sees a structured, redacted description of the page
(buttons, links, headings, non-sensitive text, `[REDACTED]` placeholders) and answers with one action (`click`, `scroll`, `type`, `select`, `navigate`).
The extension re-validates that action and executes it itself.

## Architecture

```
 USER ─▶ Chrome page ─────────────────────────────────────────────────────────────────────────────┐
                                                                                                   │
 ┌───────────────────────── Chrome extension (MV3, TypeScript) — ON DEVICE ─────────────────────┐  │
 │ content script                                                                                │  │
 │  DOM extraction ─▶ layered PII detector (DOM signals + labels + regex + heuristics) ─┐        │  │
 │  <img>/<canvas> ─▶ offscreen doc: Tesseract WASM OCR ─▶ same detector ─▶ region boxes ┤        │  │
 │                                                                                       ▼        │  │
 │                                  local redaction + cross-field scrub ─▶ PRIVACY FIREWALL #1 ──┼─▶ blocked? STOP (fail closed)
 │ background service worker: FIREWALL #2 (pattern re-scan) ─▶ POST sanitized JSON only          │  │
 │ content script: action VALIDATOR (allowlist, element checks, policy) ─▶ EXECUTOR              │  │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘  │
                     │ sanitized context (localhost)                ▲ action JSON                     │
                     ▼                                              │                                 │
 ┌──────────────── FastAPI server ────────────────┐                                                   │
 │ schema validation ─▶ server privacy guard (422)│──▶ AgentProvider ──▶ OpenAI-compatible LLM/VLM   │
 │ action sanity check ◀───────────────────────── │    or DEV/DEMO fallback (not an LLM)             │
 └─────────────────────────────────────────────────┘                                                  │
```

## Features (all implemented and exercised)

- DOM extraction into a compact structured context (buttons/links/inputs/selects/headings/text/images), page-type classification, viewport info
- Layered local PII detection with per-item `{type, source, confidence}`: input types & `autocomplete`, labels/`aria`/`name`/`id`, `dt/dd`, table columns, inline `Label: value`, regex for email, Indian phone, Luhn-valid cards, PAN, Aadhaar, IFSC, application IDs, long numeric IDs, names in greetings
- Local redaction that keeps structure, controls and non-sensitive text; cross-field scrubbing (a name found once is removed everywhere, incl. title/URL/task)
- Input values are never transmitted (only `has_value` + sanitized label)
- CAPTCHA, OTP, passwords, and other authentication secrets use typed tokens (`[REDACTED_CAPTCHA]`, etc.) and are never sent or shown in the dashboard
- **Privacy firewall** (fail-closed) in the content script (knows the raw values) and again in the service worker (pattern-only), plus a server-side guard that returns 422 without echoing values
- Local **OCR** (Tesseract.js WASM, bundled, no network) on `<img>`/`<canvas>`; OCR text goes through the same detector; regions are blacked out in a local preview; pixels are never sent
- ID-document-like heuristic on OCR results; `FaceDetector` API used when the browser exposes it
- Action allowlist + local validation (exists / attached / visible / enabled / unchanged since scan / type-appropriate / same-origin / local policy) — no `eval`, no selectors, no JS from the model
- Actions: `click`, `scroll`, `type`, `select`, `navigate` (same-origin), `none`
- Popup with `● PROTECTED` status, dashboard with redaction preview (original / local result / server payload), sanitized-context view, action view, live + offline benchmarks
- Provider abstraction (`AgentProvider`) with an OpenAI-compatible provider (works with OpenAI, Gemini's OpenAI endpoint, etc.) and a clearly labelled deterministic demo fallback
- Evaluation harness with synthetic ground truth; unit/integration tests; real-Chrome end-to-end test

## Tech stack

Chrome MV3 · TypeScript · esbuild · Tesseract.js (WASM) · FastAPI · Pydantic · httpx · Uvicorn · Vitest + jsdom · Pytest · Playwright (E2E)

## Setup

Requirements: Node 18+ (tested on 22), Python 3.10+ (tested on 3.12), Chrome/Chromium 116+.

```bash
# 1. JS deps + extension build (repo root)
npm install
npm run build              # -> extension/dist

# 2. Server
cd server
python -m venv .venv
# Windows:  .venv\Scripts\activate      macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # Windows: copy .env.example .env
```

## Environment variables (`server/.env`, see `.env.example`)

| Variable | Meaning |
|---|---|
| `AI_API_KEY` | Provider key. **Empty = deterministic DEV/DEMO fallback** (demo sites only, not an LLM) |
| `AI_BASE_URL` | OpenAI-compatible base URL (default `https://api.openai.com/v1`; Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/`) |
| `AI_MODEL` | Model name, e.g. `gpt-4o-mini` or `gemini-2.0-flash` |
| `AI_TIMEOUT_S` | Provider timeout (default 20) |
| `AI_JSON_MODE` | `true` sends `response_format=json_object` (set `false` if your endpoint rejects it) |
| `CORS_ORIGINS` | Extra CORS origins (localhost and `chrome-extension://` allowed by default) |

Keys live only on the server; nothing secret is in the extension.

## Running

```bash
# terminal 1 — agent server (from repo root)
cd server && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# terminal 2 — demo websites (from repo root)
python -m http.server 5500 --directory demo-sites
```

Open <http://localhost:5500/government/> (main demo), `/banking/` or `/healthcare/`.

## Loading the extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `extension/dist`.
3. Reload the demo page (a page opened before install also works: the extension injects on demand).

## Demo

1. Open the government portal. Click the AEGIS toolbar icon.
2. Tick **Highlight sensitive items** — name, email, phone, address, account, PAN, Aadhaar, DOB, password and text inside the ID image/canvas are outlined.
3. Press a task chip: **Open my application details** → server returns `click btn_view_details`, the extension validates and clicks, the details panel appears.
   **Open transaction history** → clicks *Transaction History*. **Scroll down** → scrolls the page.
4. The popup shows `● PROTECTED`, sensitive items / redaction tokens, `Raw PII sent: 0`, `Network request: SANITIZED`, agent status and last action.
5. **Open dashboard** →
   *Redaction preview*: original local value | local privacy result | server payload, the black-box image previews, and a live re-check
   `RAW PII TRANSMITTED: 0` (searches the exact sent payload for every raw value read from the live page);
   *Sanitized context*: the exact JSON the server received; *Agent action*: server response, local validation, execution; *Benchmark*: per-stage latency and the offline report.
6. Fail-closed check: stop the server and run a task → `server_unavailable`, nothing is sent, no fallback.

## Privacy guarantee

Raw values that the local layer detects (DOM text, input values, OCR text, title, URL, task) are replaced with `[REDACTED]`
before any network call. Every outbound payload is then verified: (1) none of the raw values collected from the page may appear in it (case/space/separator-insensitive; name tokens included),
(2) no PII-shaped value may remain in any string. Any violation **blocks the request** — there is no fallback path that sends page data.
The service worker and the server repeat the pattern check independently. Errors and logs never contain page values (server logs counts/timings only; validation errors do not echo input).

What this does **not** promise: detection is heuristic. A sensitive value that no layer recognises (see Limitations) is not redacted.

## Evaluation

```bash
python evaluation/scripts/make_dataset.py   # regenerate synthetic data (already committed)
npm run eval                                # DOM + OCR metrics -> evaluation/reports/latest.{json,md}
python evaluation/scripts/browser_e2e.py    # real Chrome + extension + server (needs: pip install playwright && playwright install chromium)
```

Metrics: PII precision `TP/(TP+FP)`, recall `TP/(TP+FN)`, F1, redaction precision (share of non-sensitive text preserved, items and characters),
visual-context accuracy (expected buttons/links represented with right type/text), per-stage latency, payload size, OCR model size, JS heap, CPU cores, WebGPU availability.
Only measured values are reported; definitions are in `latest.json`.

Measured in the build sandbox (Intel Xeon 2.1 GHz, 1 core exposed to Chromium; **synthetic data written by the authors, so treat as optimistic**):

| | DOM pages (40 pages, 317 values) | Image OCR (12 images, 54 values) |
|---|---|---|
| Precision / Recall / F1 | 0.990 / 0.978 / 0.984 | 1.0 / 1.0 / 1.0 |
| Redaction precision (items / chars) | 0.991 / 0.992 | — |
| Context accuracy | 1.0 | — |

The 7 DOM misses are deliberately hard cases: names in prose, a "Nominee:" name, passport numbers.
In real Chrome (Playwright Chromium, demo portal): first run 1.8 s total including first-time OCR engine start (OCR ≈ 1.4 s for 2 images); repeat runs 0.18–0.31 s;
payload ≈ 5.4 KB vs ≈ 6.0 KB page HTML on this small page; server-side deterministic fallback ≈ 0.1 ms. Note `exec_ms` includes a 120–250 ms wait to observe DOM effects, not click cost.
Latency with a real cloud LLM will be dominated by the provider (not measured here).

## Tests

```bash
npm test                       # 35 Vitest tests: detector, firewall, validator, extractor on demo sites, real OCR on an image
cd server && python -m pytest  # 19 tests: API, malformed input, privacy guard, provider errors, fallback
```

## Repository layout

```
extension/  src/{background,content,privacy,actions,communication,popup,offscreen,utils,types}  tests/  build.mjs  manifest.json
server/     app/{routes,agent,providers,schemas,privacy,utils}  tests/
demo-sites/ government/ banking/ healthcare/ assets/
evaluation/ dataset/ scripts/ reports/
```

## Limitations (honest)

- **LLM path not exercised here**: the OpenAI-compatible provider is implemented and unit-tested only via stubs; no API key was available in the build sandbox. The end-to-end runs used the deterministic fallback. Test with your key before the demo.
- **No WebGPU/ONNX model**: local perception = DOM + Tesseract WASM OCR. WebGPU availability is reported, not used. Face detection works only where Chrome exposes `FaceDetector` (usually off); otherwise reported as unavailable. "ID-card-like" is an OCR keyword/PII-mix heuristic, not a vision model.
- The server never receives pixels: visual understanding beyond OCR text (layout, icons, charts) is not sent. OCR is English-only, capped at 4 images per scan, and cannot read cross-origin (tainted) images — those are marked `unavailable`.
- Detection gaps: names in free prose, nominee/passport/voter IDs, UPI IDs, addresses without labels, sensitive values in `<svg>`, CSS background images, iframes and shadow DOM are **not** covered. Balances/amounts are treated as non-sensitive.
- Manifest limits automatic injection and server access to `localhost`/`127.0.0.1`; broaden `matches` / `host_permissions` for other sites.
- Chrome only (MV3). Heuristic labels are English. No CI pipeline.
- The server guard and second firewall layer are regex-based; they catch structured identifiers, not names.
- The demo fallback is a keyword matcher for the bundled demo sites only and is labelled as such in every response.
