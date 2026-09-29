# SARANYA — Final Implementation (SIH26171)

**Team Gamma · Team ID 119213**  
**Tagline:** Local Vision. Private Context. Intelligent Action.

## Architecture
```
LOCAL EYES: DOM → adaptive ONNX CV → OCR/Face when needed
SARANYA SHIELD: PII detect → redaction → fail-closed firewall
REMOTE BRAIN: sanitized context (+ visual labels/boxes only) → one action
LOCAL HANDS: validate → execute → re-perceive (multi-step)
```

## Gaps closed (this build)
| Gap | Resolution |
|-----|------------|
| Local ONNX vision packaged | `extension/models/aegis-vision.onnx` (~4.8 MB) |
| WebGPU → WASM fallback | `vision/runtime.ts` reports **actual** backend |
| Adaptive DOM→CV→OCR | `content/index.ts` + CAPTCHA skip |
| Visual context to server | `payload.visual` (detections, backend, trace) — no pixels |
| Multi-step loop | background max 8 steps / 30s / repeat stop |
| Floating UI all http(s) | content script matches + `floating-ui.ts` |
| Dashboard vision metrics | CV / WebGPU available vs inference / trace |
| Metrics methodology | `evaluation/reports/SIH26171_METRICS.md` |

## Model
- **File:** models/aegis-vision.onnx (SqueezeNet 1.1 ONNX Model Zoo lineage)
- **Role:** visual grounding backbone + spatial proposals → structured regions
- **Not claimed:** full UI detector trained on production e-commerce

## Run (Windows PowerShell)
```powershell
cd aegis
npm install
npm run build
# Terminal 1
npm run server
# Terminal 2
npm run demo
# Chrome → Load unpacked → extension\dist
# Open http://127.0.0.1:5500/securebank/
```

## Known limitations
- chrome:// pages cannot host content scripts (Chrome policy)
- Vision quality depends on WebGPU/WASM and page imagery
- Long open-web shopping agents are out of SIH26171 scope
