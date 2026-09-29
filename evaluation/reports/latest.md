# AEGIS evaluation (synthetic data, measured)

Generated 2026-09-29 16:24:14 UTC · AMD Ryzen 7 7445HS w/ Radeon 740M Graphics      · Node v24.19.0

## DOM pages (40 pages, 317 sensitive values)
| Metric | Value |
|---|---|
| PII precision | 0.99 |
| PII recall | 0.978 |
| F1 | 0.984 |
| Redaction precision (items / chars) | 0.991 / 0.992 |
| Visual context accuracy | 1 |
| Interactive-element precision | 1 |
| Firewall blocks (should be 0 on clean runs) | 0 |
| Pipeline time per page (Node+jsdom) | mean 55.512 ms, p95 105.547 ms |

Misses (7): name(prose), passport(passport), name(nominee), name(prose), name(prose), passport(passport), name(prose)

## Image OCR (12 images, 54 PII lines)
| Metric | Value |
|---|---|
| PII precision | 1 |
| PII recall | 1 |
| F1 | 1 |
| OCR time / image | mean 285.462 ms, p95 488.425 ms |
| OCR engine init | 450.271 ms |
| OCR language model | 2.816 MB |

Missed: none
