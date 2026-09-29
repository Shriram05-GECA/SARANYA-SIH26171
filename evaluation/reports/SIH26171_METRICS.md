# SIH26171 Evaluation Mapping — AEGIS

## Official weights
1. Accuracy of visual context from screen — **25%**
2. Recall and precision for detection of sensitive/PII data — **20%**
3. Precision of redaction — **20%**
4. Client-side resource utilization — **20%**
5. Overall end-to-end latency of the provided task — **15%**

## How AEGIS measures each

### 1. Visual context accuracy (25%)
- **Source:** local ONNX model (`aegis-vision.onnx`) + spatial region proposals
- **Output:** `payload.visual.detections[]` (label, confidence, bbox) — **no pixels**
- **Method:** On synthetic demo pages / SecureBank image regions, compare proposed regions to annotated UI regions (IoU ≥ 0.3 = hit)
- **Run:** After `npm run build`, exercise pages with images; dashboard shows CV_USED, backend, inference_ms
- **Honesty:** Backbone is SqueezeNet-class features + spatial energy proposals — not a custom UI detector trained on Amazon-scale data

### 2. PII recall / precision (20%)
- **Source:** existing synthetic suite `evaluation/dataset` (40 pages, 317 sensitive values historically)
- **Run:** `npm run eval`
- **Report:** precision / recall / F1 from harness (do not invent numbers — use measured output)

### 3. Redaction precision (20%)
- Same harness: redaction precision on DOM + OCR paths
- Dashboard: Raw PII sent must be **0** on successful SANITIZED runs
- Visual: OCR regions blacked in local preview; secrets never in server payload

### 4. Client resources (20%)
Dashboard / run record fields:
- `vision_model_size_mb`, `vision_inference_ms`, `vision_backend` (webgpu|wasm)
- `ocr_model_size_mb`, `js_heap_used_mb`, `hardware_concurrency`
- WebGPU **available** vs **inference active** (distinct)

### 5. E2E latency (15%)
Fixed demo task on SecureBank, e.g. “Open transaction history”:
- Record: dom_scan_ms, vision_ms, ocr_ms, verify_ms, network_ms, server_ai_ms, exec_ms, total_ms
- Report mean over ≥5 runs on the same machine

## Demo script for judges (3 minutes)
1. Open SecureBank demo → show account fields with sensitive data
2. Run agent task → show popup PROTECTED, Raw PII sent = 0, SANITIZED
3. Open Dashboard → Local CV backend, perception trace, latency bars
4. Show sanitized context JSON includes `visual` without pixels
5. Optional: CAPTCHA page path → processing skipped
