# SARANYA

### Privacy-Enforcing Browser Agent

> **Give AI the capability, not the secret.**

SARANYA is a privacy-enforcing browser agent designed to let AI agents operate browser interfaces without giving remote reasoning systems unrestricted access to sensitive information.

The system places a **local privacy and control layer between the browser and the AI agent**.

Instead of sending the complete browser environment to a remote model, SARANYA performs perception, sensitive-information detection, redaction, privacy verification, and action validation locally.

Only the minimum sanitized context required for reasoning is allowed to cross the privacy boundary.

---

## SIH 2026

| Field | Details |
|---|---|
| **Problem Statement** | SIH26171 |
| **Title** | On-device Visual Perception for Light-weight Browser Agents |
| **Organization** | ISRO |
| **Category** | Software |
| **Theme** | Miscellaneous |
| **Team** | Team Gamma |
| **Team ID** | 119213 |
| **Project** | SARANYA |

---

# 1. Overview

Modern browser agents can understand webpages and perform actions such as:

- clicking buttons
- navigating pages
- filling forms
- scrolling
- reading interface structure
- interacting with complex workflows

However, giving an AI agent unrestricted access to a browser can expose sensitive information such as:

- passwords
- OTPs
- CAPTCHA values
- email addresses
- phone numbers
- financial information
- identity information
- private documents
- sensitive visual content
- confidential application interfaces

This creates a fundamental privacy problem:

> **The agent may need the capability to interact with an environment without needing access to everything visible inside that environment.**

SARANYA addresses this by moving privacy enforcement to the user's device.

The remote AI is responsible for **reasoning**.

SARANYA remains responsible for **privacy decisions and browser control**.

---

# 2. The Core Idea

A conventional browser-agent architecture can look like:

```text
Browser
   |
   v
Complete Page / Screenshot
   |
   v
Remote AI Agent
   |
   v
Action
   |
   v
Browser
```

This creates a large privacy boundary.

SARANYA changes the architecture:

```text
                    USER DEVICE
┌─────────────────────────────────────────────┐
│                                             │
│  Browser                                    │
│     │                                       │
│     ▼                                       │
│  Local Perception                           │
│  DOM + OCR + Visual                         │
│     │                                       │
│     ▼                                       │
│  Sensitive Information Firewall             │
│     │                                       │
│     ├── Detect                              │
│     ├── Redact                              │
│     └── Verify                              │
│     │                                       │
│     ▼                                       │
│  Sanitized Structured Context               │
│                                             │
└───────────────────┬─────────────────────────┘
                    │
                    │ SAFE CONTEXT ONLY
                    ▼
             Remote AI Agent
                    │
                    │ Structured Action
                    ▼
┌─────────────────────────────────────────────┐
│  Local Action Validator                     │
│           │                                 │
│           ▼                                 │
│  Browser Execution                          │
└─────────────────────────────────────────────┘
```

The important principle is:

> **The AI receives the capability required to reason about the task, not unrestricted access to the underlying secret.**

---

# 3. Why This Matters

AI agents increasingly operate inside environments containing information that should not automatically be exposed to a remote model.

Examples include:

### Personal environments

- email
- passwords
- addresses
- phone numbers
- identity documents
- medical information
- payment information

### Enterprise environments

- internal dashboards
- employee information
- customer records
- proprietary documents
- internal applications
- financial systems

### Government and strategic environments

Potential applications include environments containing:

- internal operational information
- confidential interfaces
- mission identifiers
- operator information
- sensitive telemetry
- restricted documents

These are application examples rather than claims about specific operational requirements.

The broader problem is:

> **AI agents need contextual visibility to act, but contextual visibility does not have to mean unrestricted visibility.**

---

# 4. SARANYA's Privacy Principle

SARANYA follows a simple principle:

```text
                 CAPABILITY
                    ↑
                    |
              ┌───────────┐
              │    AI     │
              └───────────┘
                    |
             Sanitized Context
                    |
          ┌──────────────────┐
          │     SARANYA      │
          │ Privacy Boundary │
          └──────────────────┘
                    |
              Sensitive Data
                    |
                 LOCAL
```

The system separates:

```text
What the AI needs to KNOW
              from
What the browser needs to USE
```

For example:

### User request

```text
Use my saved email to complete this form.
```

A conventional agent might receive:

```text
Email: user@example.com
```

SARANYA's current prototype can instead provide:

```text
Email: [REDACTED_EMAIL]
```

The proposed final architecture extends this further:

```text
Email: EMAIL_REF_01
```

The remote model reasons about the reference while SARANYA keeps the underlying value local.

---

# 5. System Architecture

SARANYA consists of two major planes.

## Local Privacy and Control Plane

Runs inside the user's environment.

Responsible for:

- browser perception
- DOM analysis
- OCR
- visual perception
- sensitive-information detection
- local redaction
- privacy verification
- context sanitization
- action validation
- browser execution
- local telemetry

## Remote Reasoning Plane

Responsible for:

- interpreting sanitized context
- understanding the user's task
- deciding the next browser action
- returning structured actions

The remote model does **not** become the final authority over the browser.

---

# 6. End-to-End Flow

```text
1. User provides a browser task
              |
              v
2. SARANYA perceives the page locally
              |
              v
3. DOM / OCR / visual information is processed
              |
              v
4. Sensitive information is detected
              |
              v
5. Sensitive values are redacted locally
              |
              v
6. Outbound payload is independently verified
              |
              v
7. Sanitized context is generated
              |
              v
8. Sanitized context is sent to the reasoning agent
              |
              v
9. Agent returns a structured action
              |
              v
10. SARANYA validates the action locally
              |
              v
11. Browser executes the approved action
              |
              v
12. Result and telemetry are recorded
```

---

# 7. Local Perception

SARANYA uses multiple local perception sources.

## DOM Perception

The browser extension can inspect page structure locally.

This provides information such as:

- buttons
- inputs
- labels
- links
- visible text
- element identifiers
- form structure
- navigation elements

The DOM provides useful structural information without requiring the complete raw page to be sent to a remote model.

---

## OCR

SARANYA uses local OCR for visual text perception.

The prototype uses:

```text
Tesseract.js
```

OCR can identify text that may not exist directly as accessible DOM content.

Examples include:

- text embedded inside images
- CAPTCHA-like visual text
- identity information
- visual labels
- document text

OCR processing is performed locally.

The extracted raw sensitive text must remain inside the local privacy boundary.

---

## Visual Perception

The prototype also contains a local visual-perception pipeline.

The repository includes an ONNX-based vision pipeline with:

```text
ONNX Runtime Web
```

and local browser-side inference support.

The system attempts appropriate local execution backends and records the backend used by the runtime.

The important security property is:

> **Visual perception happens locally before sanitized visual context is exposed to the remote reasoning system.**

---

# 8. Sensitive Information Firewall

SARANYA detects information that should not automatically leave the user's device.

The conceptual categories include:

## Personal Information

- Name
- Email
- Phone
- Address
- Date of birth

## Authentication Secrets

- Username
- Password
- OTP
- PIN
- CAPTCHA

## Financial Information

- Account numbers
- Card numbers
- CVV
- Transaction identifiers

## Identity Information

- PAN-like identifiers
- Aadhaar-like identifiers
- Application IDs
- Identity-document information

## Visual Sensitive Information

- faces
- sensitive document regions
- OCR-detected sensitive text

Only categories actually supported by the active detector should be presented as detected capabilities.

---

# 9. Local Redaction

Sensitive values are transformed locally before sanitized context is created.

For example:

```text
Original:

Email:
user@example.com

Password:
••••••••

CAPTCHA:
K8P2X
```

Sanitized context:

```text
Email:
[REDACTED_EMAIL]

Password:
[REDACTED_PASSWORD]

CAPTCHA:
[REDACTED_CAPTCHA]
```

The purpose is not simply to hide information visually.

The privacy firewall must also ensure that raw sensitive values do not appear in the outbound payload.

---

# 10. CAPTCHA Protection

CAPTCHA is treated as security-sensitive information.

The raw CAPTCHA value must remain local.

The remote context should contain:

```json
{
  "label": "Enter CAPTCHA",
  "sensitive": true,
  "value": "[REDACTED_CAPTCHA]"
}
```

and never:

```json
{
  "value": "actual-captcha-value"
}
```

The same rule applies to OCR-derived CAPTCHA text.

Raw CAPTCHA values must not appear in:

- remote requests
- server logs
- dashboard output
- benchmark results
- screenshots
- debugging output

---

# 11. Visual Privacy

One of SARANYA's important design decisions is that the original screenshot is not required to cross the privacy boundary.

The visual pipeline is:

```text
Original Browser Visual
          |
          v
Local Visual Perception
          |
          v
Sensitive Region Detection
          |
          v
Local Redaction
          |
          +----------------------+
          |                      |
          v                      v
 Redacted Preview          Structured Context
    LOCAL ONLY             Sanitized for Agent
          |                      |
          |                      v
          |                Remote Reasoning
          |
          X
    NOT TRANSMITTED
```

The current prototype keeps the redacted screenshot/preview local.

The remote reasoning system receives structured visual information rather than the original screenshot pixels.

This distinction is important:

> **Redaction does not mean that the redacted screenshot is automatically uploaded.**

The current design instead minimizes what crosses the boundary.

---

# 12. What Leaves the Browser?

The privacy boundary can be summarized as follows:

| Information | Local | Remote |
|---|:---:|:---:|
| Original screenshot pixels | Yes | No |
| Raw sensitive values | Yes | No |
| Raw CAPTCHA | Yes | No |
| Raw password | Yes | No |
| Raw OTP | Yes | No |
| Redacted visual preview | Yes | No |
| DOM structure | Yes | Sanitized subset |
| Sanitized values | Yes | Yes |
| Visual labels | Yes | Sanitized/structured |
| Bounding boxes | Yes | Structured where required |
| Scene summary | Yes | Yes |
| Action proposal | Yes | Yes |
| Browser execution | Yes | No |

The exact outbound fields depend on the current runtime payload.

The security goal is that sensitive raw values never cross the privacy boundary.

---

# 13. Independent Privacy Verification

SARANYA does not rely only on the redaction step.

The system performs an independent check of the outbound payload.

Conceptually:

```text
Sensitive values detected locally
              |
              v
       Privacy Firewall
              |
              v
       Sanitized Payload
              |
              v
     Independent Verification
              |
        ┌─────┴─────┐
        |           |
       SAFE       VIOLATION
        |           |
        v           v
      SEND        BLOCK
```

The verifier searches the exact outbound payload for detected raw sensitive values.

Expected result:

```text
Raw sensitive values detected locally     N
Outbound payload scanned                  M
Raw values found in payload               0

STATUS: VERIFIED SAFE
```

The values `N` and `M` must come from actual runtime measurements.

They must never be hard-coded as evidence.

---

# 14. Privacy Firewall States

SARANYA uses explicit privacy states.

### Protected

```text
PRIVACY FIREWALL ACTIVE

Raw sensitive data sent: 0
```

### Warning

Used when the system detects a condition requiring attention.

### Blocked

```text
REQUEST BLOCKED

Sensitive information detected
in outbound payload.
```

The system should fail safely rather than silently continuing.

---

# 15. Task-Aware Minimum Disclosure

A major direction of SARANYA is **task-aware minimum disclosure**.

Not every task requires every piece of information visible on a page.

For example:

```text
Task:
Open the transaction history.
```

The reasoning system may need:

```text
Navigation:
Dashboard
Transactions
Profile
Logout
```

It does not necessarily need:

```text
Account number
Card number
Password
OTP
Personal address
```

Therefore SARANYA aims to disclose:

> **Only the context required for the current task.**

This is stronger than simply masking a fixed list of fields.

---

# 16. Semantic Capability References

The current prototype primarily uses explicit redaction tokens such as:

```text
[REDACTED_EMAIL]
[REDACTED_PASSWORD]
[REDACTED_CAPTCHA]
```

The proposed final architecture extends this into semantic capability references.

Example:

```text
EMAIL_REF_01
```

The remote model can reason:

```text
Use EMAIL_REF_01 in the email field.
```

SARANYA can then resolve the reference locally.

The actual value remains inside the local environment.

---

# 17. Proposed Reference Architecture

```text
USER
 |
 | "Use my saved email to complete this form"
 v
SARANYA
 |
 | Local policy determines:
 | Email is required for this action
 |
 v
EMAIL_REF_01
 |
 | Sanitized reference
 v
REMOTE AI
 |
 | "Type EMAIL_REF_01 into email field"
 v
SARANYA
 |
 | Local resolution
 | Local policy check
 v
LOCAL EMAIL VALUE
 |
 v
BROWSER INPUT
```

The remote model never needs to know the underlying email value.

---

# 18. Local Sensitive Computation

Sensitive computation is intended to remain local.

Examples:

```text
PII detection
Password detection
CAPTCHA detection
OCR
Visual analysis
Sensitive-region detection
Redaction
Payload verification
Action validation
Credential/reference resolution
```

This creates a strong separation between:

```text
Remote reasoning
```

and:

```text
Local authority
```

---

# 19. Agent Action Security

The remote model does not directly control the browser.

Instead it returns a structured action.

Example:

```json
{
  "action": "click",
  "target": "btn_login"
}
```

SARANYA receives the action and performs local validation.

Conceptually:

```text
REMOTE AI
    |
    | Proposed action
    v
SARANYA VALIDATOR
    |
    ├── Is action type allowed?
    ├── Is target valid?
    ├── Does target exist?
    ├── Does policy permit the action?
    └── Is execution safe?
    |
    +---- BLOCK ----> Browser
    |
    +---- ALLOW ----> Browser
```

This prevents the remote model from becoming an unrestricted browser execution layer.

---

# 20. Agent Confidence

If the remote model reports a confidence value, SARANYA displays it as:

```text
Agent-reported confidence
```

It is not treated as independent proof that the action is correct.

The local validator remains authoritative for browser execution.

Therefore:

> **AI proposes. SARANYA verifies. Browser executes.**

---

# 21. Example Agent Action

```text
AGENT ACTION

Requested:
Click Login

Agent:
click(btn_login)

Agent-reported confidence:
0.99

Local policy:
ALLOWED

Execution:
COMPLETED
```

If the action violates local policy:

```text
AGENT ACTION

Requested:
execute_javascript(...)

Local policy:
BLOCKED

Execution:
NOT PERFORMED
```

---

# 22. Security Model

SARANYA uses defense in depth.

### Layer 1 — Local perception

The browser is processed locally.

### Layer 2 — Sensitive information detection

Potentially sensitive data is identified before outbound context generation.

### Layer 3 — Local redaction

Sensitive values are replaced with safe representations.

### Layer 4 — Independent payload verification

The exact outbound payload is checked for raw sensitive values.

### Layer 5 — Sanitized remote context

Only approved context crosses the boundary.

### Layer 6 — Structured actions

The remote model returns constrained actions.

### Layer 7 — Local action validation

SARANYA verifies actions before execution.

### Layer 8 — Local browser execution

The browser performs only locally approved actions.

---

# 23. Security Properties

The system is designed around the following properties:

```text
Raw sensitive data
        |
        X
        |
Remote reasoning
```

while:

```text
Sanitized context
        |
        v
Remote reasoning
        |
        v
Structured action
        |
        v
Local validation
        |
        v
Browser
```

The remote model is therefore treated as a reasoning component rather than a trusted authority.

---

# 24. Demo Environment

SARANYA includes fictional synthetic browser environments for demonstration.

Example:

```text
SecureBank Demo
```

The demo environment can contain synthetic:

- login information
- username
- password
- CAPTCHA
- account information
- transaction history
- profile information
- certificate/application information
- fake identity-document images

The data is synthetic and should not be interpreted as real banking or government information.

The demo page should clearly identify itself as:

```text
DEMO ENVIRONMENT
Synthetic data only
```

No real bank branding or credentials are required.

---

# 25. Demonstration Scenario

A complete demonstration follows this flow:

```text
01 Detect
   ↓
02 Redact
   ↓
03 Verify
   ↓
04 Reason
   ↓
05 Validate
   ↓
06 Execute
```

### Step 1 — Detect

SARANYA locally perceives the webpage.

### Step 2 — Redact

Sensitive information is identified and locally sanitized.

### Step 3 — Verify

The outbound payload is independently scanned.

### Step 4 — Reason

The remote model receives sanitized context.

### Step 5 — Validate

The returned browser action is checked locally.

### Step 6 — Execute

The browser performs the approved action.

---

# 26. Dashboard

SARANYA includes a privacy-oriented dashboard for observing the browser-agent pipeline.

The dashboard is organized around:

- privacy status
- local perception
- sensitive-information detection
- privacy verification
- agent activity
- action validation
- performance
- visual privacy
- sanitized context
- diagnostics
- evaluation

The dashboard is intended to make the privacy boundary observable rather than hiding it inside implementation details.

---

# 27. Visual Privacy Dashboard

The visual privacy interface should distinguish:

```text
LOCAL ONLY
```

from:

```text
REMOTE MODEL
```

For example:

```text
LOCAL ONLY

Original visual
Sensitive-region detection
Redacted preview
Raw OCR text
Raw sensitive values
Local inference
```

and:

```text
REMOTE MODEL

Sanitized DOM structure
Sanitized values
Structured visual labels
Allowed bounding boxes
Scene summary
Task-relevant context
```

This makes it possible to inspect exactly what is intended to cross the privacy boundary.

---

# 28. Sanitized Context Viewer

The dashboard provides a sanitized context representation.

Example:

```text
SANITIZED CONTEXT

Page
└── SecureBank Demo

Visible UI
├── Login
├── Forgot Password
├── Register
└── Transaction History

Sensitive fields
├── Username      [REDACTED_USERNAME]
├── Password      [REDACTED_PASSWORD]
└── CAPTCHA       [REDACTED_CAPTCHA]

Visual content
├── OCR regions
├── Sensitive regions
└── Scene summary
```

A payload viewer can display the actual sanitized JSON sent to the reasoning service.

Raw sensitive values must never be shown.

---

# 29. Example Sanitized Payload

A simplified example:

```json
{
  "page": {
    "title": "SecureBank Demo",
    "url": "/securebank/"
  },
  "elements": [
    {
      "id": "username",
      "label": "Username",
      "sensitive": true,
      "value": "[REDACTED_USERNAME]"
    },
    {
      "id": "password",
      "label": "Password",
      "sensitive": true,
      "value": "[REDACTED_PASSWORD]"
    },
    {
      "id": "captcha",
      "label": "Enter CAPTCHA",
      "sensitive": true,
      "value": "[REDACTED_CAPTCHA]"
    },
    {
      "id": "login",
      "label": "Login",
      "sensitive": false
    }
  ]
}
```

The actual payload schema is determined by the implementation.

The example above illustrates the privacy principle rather than defining a fixed API contract.

---

# 30. Performance Monitoring

SARANYA records execution timing across different stages.

Example:

```text
LOCAL PERCEPTION
14 ms

NETWORK
951 ms

AI REASONING
937 ms

BROWSER EXECUTION
326 ms
```

The values displayed by the dashboard should come from actual runtime instrumentation.

The system should not manufacture latency values for presentation.

---

# 31. OCR Metrics

OCR must distinguish between:

```text
OCR EXECUTED
```

and:

```text
OCR NOT REQUIRED
```

For example:

```text
OCR
✓ Executed
401 ms
```

or:

```text
OCR
— Not required
```

A value such as:

```text
0 ms
```

must not be used to imply that OCR executed when it did not.

---

# 32. Runtime Backends

The visual pipeline can attempt supported local execution backends.

For example:

```text
WebGPU
   |
   +---- available → use appropriate backend
   |
   +---- unavailable → fallback
```

Availability must not be confused with actual utilization.

SARANYA should report the backend actually used by the runtime.

---

# 33. Live Agent Run History

The dashboard can record browser-agent runs.

Example:

| Task | Status | Action | Total | Local | Network | Execution |
|---|---|---|---:|---:|---:|---:|
| Open transaction history | Completed | click | 311 ms | 24 ms | 11 ms | 276 ms |
| Open profile | Completed | click | 428 ms | 30 ms | 14 ms | 384 ms |

Metrics should be generated from actual runs.

When enough samples exist, the system can additionally report:

- mean
- median
- p95
- range
- sample count

A p95 value should not be displayed when the sample size is insufficient to make it meaningful.

---

# 34. Evaluation

SARANYA includes a synthetic evaluation environment for measuring privacy detection and OCR performance.

The evaluation should report:

```text
DOM benchmark
Sensitive-value detection

Precision
Recall
F1

Redaction

Item precision
Character precision

OCR benchmark

Precision
Recall
F1

OCR latency
```

---

# 35. Synthetic Evaluation Dataset

Evaluation results should always identify the dataset type.

```text
Synthetic evaluation dataset
```

The results should not be interpreted as universal measurements across all websites, browsers, users, or real-world deployments.

The benchmark measures performance on the included test data.

---

# 36. Benchmark Definitions

### Precision

Of the items classified as sensitive, how many were actually sensitive?

```text
Precision =
True Positives /
(True Positives + False Positives)
```

### Recall

Of all known sensitive items, how many were detected?

```text
Recall =
True Positives /
(True Positives + False Negatives)
```

### F1

The harmonic mean of precision and recall.

```text
F1 =
2 × Precision × Recall /
(Precision + Recall)
```

### Redaction precision

Measures how accurately sensitive content is removed while preserving useful non-sensitive content.

---

# 37. Sample Size

Every evaluation metric should display its sample size.

Example:

```text
F1
0.984

317 sensitive values
```

or:

```text
OCR F1
1.000

12 synthetic images
```

This avoids presenting a metric without context.

---

# 38. Evaluation Methodology

The evaluation pipeline should:

1. load the benchmark dataset
2. run the detector
3. compare predictions with ground truth
4. calculate precision
5. calculate recall
6. calculate F1
7. evaluate redaction
8. measure OCR performance where applicable
9. report sample counts
10. store the measured results

Metrics should be generated by the evaluation system rather than manually entered into the dashboard.

---

# 39. No Metric Gaming

SARANYA does not intentionally manipulate evaluation results.

The project should not:

- remove difficult samples
- hide failures
- inflate sample counts
- hard-code benchmark results
- artificially reduce latency
- claim unavailable functionality
- present synthetic evaluation as universal accuracy
- label unavailable hardware acceleration as active

If a capability is unavailable, it should be reported as unavailable.

---

# 40. Privacy Event Timeline

The system can represent a run as a sequence of privacy and agent events.

Example:

```text
21:43:01
PII detected

21:43:01
PII redacted

21:43:01
Payload verified

21:43:01
Request sent

21:43:02
Action received

21:43:02
Action validated

21:43:02
Browser action executed
```

The timeline should contain event metadata but never raw sensitive values.

---

# 41. Error Handling

SARANYA is designed to distinguish failures from successful execution.

## Server Offline

```text
SERVER OFFLINE

Agent unavailable.

Privacy protection remains active.
```

## Privacy Violation

```text
REQUEST BLOCKED

Sensitive information detected
in outbound payload.
```

## OCR Failure

```text
OCR UNAVAILABLE

DOM privacy protection remains active.
```

## Agent Failure

```text
AGENT ERROR

No browser action executed.
```

## Invalid Action

```text
ACTION BLOCKED

Local policy rejected the requested action.
```

The interface must never represent a failed or blocked action as successful.

---

# 42. Security Testing

The security test suite should cover multiple sensitive-data classes.

## Personal Information

```text
Email
Phone
Name
Address
```

## Identity

```text
PAN-like identifiers
Aadhaar-like identifiers
Application IDs
```

## Financial

```text
Account numbers
Card numbers
CVV
Transaction identifiers
```

## Authentication

```text
Password
OTP
PIN
CAPTCHA
```

## OCR

```text
OCR email
OCR phone
OCR identity number
OCR CAPTCHA
```

---

# 43. Payload Bypass Testing

The privacy firewall should also be tested against different payload representations.

Examples:

```text
Nested JSON
Arrays
Stringified JSON
Case variation
Whitespace variation
Different object nesting
```

The goal is:

```text
Raw sensitive data
        ↓
      BLOCK
```

while:

```text
Sanitized representation
        ↓
      ALLOW
```

---

# 44. Action Validation Testing

The local action validator should reject unsafe or unsupported actions such as:

```text
execute_javascript
eval
arbitrary script
shell command
unknown action
unknown element
unsafe navigation
```

It should only permit supported actions when they satisfy the existing validation policy.

Examples of supported action types include:

```text
click
scroll
navigate
type
select
```

The exact policy is implementation-dependent.

---

# 45. Repository Security

The repository should not contain:

- API keys
- passwords
- authentication tokens
- real credentials
- real personal information
- real financial information
- production secrets

Environment-specific values should be provided through:

```text
.env
```

while the repository should contain:

```text
.env.example
```

instead of real credentials.

The `.gitignore` should exclude sensitive and generated files.

---

# 46. Technology Stack

| Layer | Technology |
|---|---|
| Browser extension | Chrome Manifest V3 |
| Browser interaction | JavaScript / TypeScript |
| DOM perception | Browser DOM APIs |
| OCR | Tesseract.js |
| Local vision | ONNX Runtime Web |
| Visual processing | Browser-side perception pipeline |
| Backend | FastAPI |
| Agent communication | HTTP / JSON |
| Reasoning | OpenAI-compatible provider interface |
| Action protocol | Structured JSON actions |
| Local validation | Browser-side policy validator |
| Demo environment | HTML / CSS / JavaScript |
| Evaluation | Python-based benchmark tooling |

---

# 47. Repository Structure

A simplified repository structure is:

```text
SARANYA-SIH26171/
│
├── extension/
│   ├── src/
│   │   ├── content/
│   │   ├── vision/
│   │   └── ...
│   ├── models/
│   ├── manifest.json
│   └── ...
│
├── server/
│   ├── ...
│   └── ...
│
├── demo-sites/
│   ├── ...
│   └── ...
│
├── evaluation/
│   ├── ...
│   └── ...
│
├── README.md
├── IMPLEMENTATION.md
├── TESTING.md
├── .env.example
├── .gitignore
└── package.json
```

The exact structure may evolve as the implementation develops.

---

# 48. Running the Demo

## 1. Start the demo website

From the demo-sites directory:

```bash
cd demo-sites
python -m http.server 5500
```

The demo environment is then available at:

```text
http://localhost:5500/
```

Example demo routes include:

```text
http://localhost:5500/securebank/
http://localhost:5500/government/
http://localhost:5500/banking/
http://localhost:5500/healthcare/
```

These environments use synthetic data.

---

# 49. Server

The FastAPI server provides the reasoning endpoint and related backend functionality.

The exact startup command depends on the current server entry point.

A typical development invocation is:

```bash
uvicorn <server_module>:app --reload
```

Use the server entry point documented in the repository.

---

# 50. Browser Extension

Load the extension through Chrome's developer extension interface.

Typical development process:

```text
1. Open Chrome
2. Navigate to chrome://extensions
3. Enable Developer mode
4. Select Load unpacked
5. Select the extension directory
6. Open the synthetic demo environment
7. Start SARANYA
```

The exact extension build/load path depends on the current repository build configuration.

---

# 51. Configuration

Create a local environment file using the provided example:

```text
.env.example
```

Copy it to:

```text
.env
```

Then configure the required provider/API settings locally.

Do not commit `.env`.

---

# 52. Development Workflow

Recommended development flow:

```text
Install dependencies
        ↓
Configure local environment
        ↓
Start demo site
        ↓
Start FastAPI server
        ↓
Load browser extension
        ↓
Open synthetic demo
        ↓
Run browser-agent task
        ↓
Inspect privacy dashboard
        ↓
Run tests
        ↓
Run evaluation
```

---

# 53. Current Prototype vs Final Architecture

SARANYA is intentionally being developed in stages.

## Implemented Foundation

The current prototype establishes:

- Chrome MV3 extension
- local DOM perception
- local sensitive-information detection
- local redaction
- OCR
- visual perception pipeline
- local privacy firewall
- independent outbound-payload verification
- sanitized context generation
- FastAPI backend
- remote/deterministic agent interface
- structured action responses
- local action validation
- local browser execution
- synthetic demo environments
- benchmark/evaluation tooling
- runtime telemetry
- privacy dashboard

---

# 54. Proposed Final Development

The next development phase extends the current foundation with stronger task-aware privacy.

Planned components include:

### Task-aware disclosure policy

Determine which pieces of context are actually required for the current task.

### Semantic capability references

Represent sensitive capabilities through local references such as:

```text
EMAIL_REF_01
```

instead of exposing the underlying value.

### Local reference memory / vault

Maintain protected local mappings such as:

```text
EMAIL_REF_01 → local email value
PHONE_REF_01 → local phone value
ACCOUNT_REF_01 → local account value
```

The underlying values remain local.

### Reference-aware action execution

Allow the agent to request:

```text
Use EMAIL_REF_01
```

while SARANYA resolves and executes the operation locally.

### Stronger disclosure policy

The final system should minimize disclosure based on:

```text
Task
+
Required capability
+
Sensitive-data policy
```

rather than only applying static redaction.

These capabilities should be implemented and experimentally validated before being presented as fully implemented functionality.

---

# 55. Why Semantic References Matter

Static redaction solves:

```text
Do not expose this secret.
```

Semantic capability references aim to solve:

```text
How can the AI request the capability
without learning the secret?
```

For example:

```text
Remote AI:

"Type EMAIL_REF_01 into the email field."
```

SARANYA:

```text
1. Resolve EMAIL_REF_01 locally
2. Verify policy
3. Identify approved target
4. Insert local value
5. Never expose the raw value to the remote model
```

This creates a separation between:

```text
Knowledge of a secret
```

and:

```text
Ability to use a secret
```

---

# 56. Privacy Boundary

The core architectural boundary can be summarized as:

```text
┌──────────────────── USER DEVICE ────────────────────┐
│                                                     │
│  Browser                                             │
│     │                                               │
│     ▼                                               │
│  Local Perception                                   │
│  DOM + OCR + Vision                                 │
│     │                                               │
│     ▼                                               │
│  Sensitive Information Firewall                    │
│     │                                               │
│     ├── Detect                                       │
│     ├── Redact                                       │
│     ├── Verify                                       │
│     └── Minimize                                     │
│     │                                               │
│     ▼                                               │
│  Sanitized Context                                  │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ SAFE CONTEXT ONLY
                       ▼
              ┌───────────────────┐
              │   REMOTE AI       │
              │   REASONING       │
              └─────────┬─────────┘
                        │
                        │ Structured Action
                        ▼
              ┌───────────────────┐
              │ LOCAL VALIDATOR   │
              └─────────┬─────────┘
                        │
                        ▼
                    BROWSER
```

The local boundary is the central security property of SARANYA.

---

# 57. Conventional Agent vs SARANYA

| Capability | Conventional Browser Agent | SARANYA |
|---|---|---|
| Browser perception | Often remote/cloud | Local |
| Sensitive-data detection | May occur after exposure | Local before disclosure |
| Raw screenshot exposure | Potentially possible | Not required |
| OCR | Potentially remote | Local |
| Sensitive-value redaction | Depends on architecture | Local |
| Payload verification | Not necessarily independent | Included |
| Remote reasoning | Yes | Yes |
| Action proposal | Yes | Yes |
| Local action validation | Architecture-dependent | Yes |
| Browser execution authority | Agent-dependent | Local SARANYA |
| Task-aware minimum disclosure | Limited / architecture-dependent | Core design direction |
| Semantic capability references | Not assumed | Proposed final architecture |

This table describes architectural differences rather than claiming that every conventional browser agent uses the same architecture.

---

# 58. SIH Problem Alignment

The SIH26171 problem focuses on combining:

```text
Local visual perception
+
Privacy-preserving filtering
+
Remote reasoning
+
Local browser execution
```

SARANYA directly implements this architectural pattern.

The system provides:

```text
Browser
   ↓
Local perception
   ↓
Sensitive-data detection
   ↓
Local redaction
   ↓
Sanitized context
   ↓
Remote reasoning
   ↓
Structured action
   ↓
Local validation
   ↓
Browser execution
```

The design therefore addresses the central tension:

> **How can an AI agent operate a browser when the complete visual/browser state should not be exposed to the remote reasoning system?**

---

# 59. Evaluation Alignment

The SIH problem statement emphasizes several evaluation dimensions.

SARANYA's evaluation framework is designed around:

| Evaluation Area | SARANYA Measurement Direction |
|---|---|
| Visual context accuracy | Local visual/structured perception |
| PII precision and recall | Sensitive-data benchmark |
| Redaction precision | Redaction evaluation |
| Client resource utilization | Runtime/resource telemetry |
| End-to-end latency | Agent execution telemetry |

The exact benchmark results depend on the dataset and runtime environment.

---

# 60. Limitations

SARANYA is a research and prototype system, not a production browser security product.

Important limitations include:

### 1. Detection is not perfect

No privacy detector can guarantee that every possible sensitive value on every website will be detected.

Unusual formats, previously unseen data types, obfuscated values, or application-specific secrets may be missed.

---

### 2. Visual perception is hardware-dependent

Local visual inference performance depends on:

- CPU
- GPU
- WebGPU support
- browser implementation
- memory availability
- model size

A configuration that performs well on one machine may behave differently on another.

---

### 3. OCR is imperfect

OCR can produce:

- false positives
- false negatives
- incorrect characters
- latency variation

Therefore OCR should be treated as one perception signal rather than an absolute source of truth.

---

### 4. Synthetic evaluation is limited

Benchmark results in this repository are based on the included evaluation data.

They should not be interpreted as:

```text
100% accuracy on the real web
```

or as universal performance across arbitrary websites.

Real-world deployment would require broader datasets and independent evaluation.

---

### 5. Browser compatibility

The current implementation primarily targets the supported Chrome/Chromium extension environment.

Other browsers may require compatibility work.

---

### 6. Website variability

Real websites frequently change:

- DOM structure
- CSS
- element identifiers
- accessibility labels
- visual layouts
- navigation behavior

A robust production browser agent would require stronger adaptation to changing interfaces.

---

### 7. Remote model dependency

When remote reasoning is configured, SARANYA depends on the availability and behavior of the selected reasoning provider.

If the reasoning service is unavailable:

```text
Agent reasoning stops
```

while the local privacy layer should remain active.

---

### 8. Model-generated actions are not inherently trustworthy

A language model can return incorrect or unexpected actions.

SARANYA therefore treats model output as a proposal rather than authority.

Local validation remains necessary.

---

### 9. Semantic capability references are a proposed extension

The current prototype demonstrates the privacy-enforcement foundation using local detection, redaction, verification, and sanitized context.

The stronger:

```text
EMAIL_REF_01
PHONE_REF_01
ACCOUNT_REF_01
```

capability-reference architecture is part of the final development direction and must be fully implemented and validated before being described as production-ready.

---

### 10. Local secrets still require secure storage

Keeping a secret on the user's device does not automatically make it secure.

A final reference/vault implementation would need protections such as:

- secure local storage
- access control
- encryption where appropriate
- reference lifecycle management
- explicit consent
- safe deletion
- protection against malicious browser content

---

### 11. Privacy policy coverage is incomplete by definition

A fixed detector cannot understand every organization's definition of sensitive information.

Production deployments would require configurable policies appropriate to the environment.

---

### 12. Prompt injection remains a browser-agent threat

A webpage can contain malicious instructions designed to influence an agent.

Privacy protection and action validation reduce certain risks, but a complete production system would also require stronger:

- instruction isolation
- origin trust policies
- action provenance
- navigation controls
- prompt-injection defenses
- goal verification

---

### 13. No security system should rely on a single layer

SARANYA therefore treats:

```text
Detection
+
Redaction
+
Verification
+
Policy
+
Action validation
```

as complementary layers.

The system should not assume that detection alone guarantees privacy.

---

# 61. Future Work

The next development stage can focus on:

```text
Task-aware minimum disclosure
        ↓
Semantic capability references
        ↓
Local reference vault
        ↓
Reference-aware browser actions
        ↓
Stronger policy engine
        ↓
Prompt-injection resistance
        ↓
Goal verification
        ↓
Broader visual benchmarks
        ↓
Resource optimization
        ↓
Offline/local reasoning
```

Additional future work includes:

- stronger multimodal local models
- improved visual grounding
- cross-browser support
- stronger action provenance
- encrypted local reference storage
- configurable enterprise privacy policies
- larger real-world benchmark datasets
- improved low-resource inference
- offline reasoning configurations

---

# 62. Security Philosophy

SARANYA is built around three principles.

## Principle 1 — Privacy before reasoning

Sensitive information should be processed locally before remote reasoning.

## Principle 2 — Reasoning is not authority

The AI can propose what should happen.

It does not automatically get authority to execute it.

## Principle 3 — Capability can be separated from knowledge

An AI may need the ability to use information without needing to learn the underlying secret.

This is the long-term direction of semantic capability references.

---

# 63. Project Status

### Current prototype

```text
✓ Browser extension
✓ Local DOM perception
✓ Local sensitive-data detection
✓ Local redaction
✓ OCR
✓ Visual perception
✓ Privacy firewall
✓ Independent payload verification
✓ Sanitized context
✓ Remote reasoning interface
✓ Structured actions
✓ Local action validation
✓ Local browser execution
✓ Synthetic demo environments
✓ Evaluation tooling
✓ Runtime telemetry
✓ Privacy dashboard
```

### Final development direction

```text
→ Task-aware minimum disclosure
→ Semantic capability references
→ Local reference/vault layer
→ Reference-aware action execution
→ Stronger policy enforcement
→ Broader security evaluation
```

The distinction between implemented and proposed functionality is intentional.

SARANYA should not claim a capability until it is actually implemented and tested.

---

# 64. Example Final Vision

The intended final interaction is:

```text
USER
│
│ "Use my saved email to complete this form."
│
▼
SARANYA
│
│ Detect task requirements locally
│
▼
TASK-AWARE PRIVACY POLICY
│
│ Email capability required
│
▼
EMAIL_REF_01
│
│ Sanitized context
│
▼
REMOTE AI
│
│ "Enter EMAIL_REF_01 into email field"
│
▼
SARANYA
│
│ Resolve locally
│ Validate locally
│
▼
BROWSER
│
│ Form completed
│
▼
USER
```

At no point does the remote reasoning system need to learn the underlying email value.

That is the core direction of:

> **Give AI the capability, not the secret.**

---

# 65. Conclusion

SARANYA explores a privacy-first architecture for browser agents.

Instead of treating the remote AI model as an unrestricted observer and controller of the browser, SARANYA introduces a local enforcement layer that:

```text
Perceives locally
      ↓
Detects sensitive information
      ↓
Redacts locally
      ↓
Verifies outbound context
      ↓
Sends sanitized context
      ↓
Receives structured actions
      ↓
Validates locally
      ↓
Executes locally
```

The current prototype demonstrates the foundation of this architecture.

The proposed final architecture extends that foundation toward task-aware minimum disclosure and semantic capability references, allowing an AI system to request capabilities without automatically learning the sensitive values behind those capabilities.

The broader goal is simple:

> **Let AI operate the environment without giving AI unrestricted access to everything inside it.**

---

# 66. References

### Smart India Hackathon

**SIH26171 — On-device Visual Perception for Light-weight Browser Agents**

The repository's problem-statement references should be kept aligned with the official SIH material used for the project submission.

### Browser Agent Privacy Research

Research into browser-agent privacy and security motivates the need for privacy-aware browser-agent architectures.

One relevant research direction is the systematic study of privacy vulnerabilities in browser agents:

```text
https://arxiv.org/abs/2512.07725
```

### Technologies

- Chrome Extensions / Manifest V3
- Web APIs
- WebAssembly
- WebGPU
- ONNX Runtime Web
- Tesseract.js
- FastAPI
- Python
- TypeScript / JavaScript

---

# 67. License

Add the project's chosen license here before public release.

Example:

```text
MIT License
```

Do not claim a license unless a corresponding license file is included in the repository.

---

# 68. Team

**Team Gamma**

**Team ID:** 119213

**Problem Statement:** SIH26171

**Project:** SARANYA

> **Privacy-Enforcing Browser Agent**

> **Give AI the capability, not the secret.**