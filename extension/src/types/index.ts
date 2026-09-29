export type PiiType =
  | 'email' | 'phone' | 'password' | 'card' | 'pan' | 'aadhaar' | 'account' | 'application_id'
  | 'identifier' | 'ifsc' | 'name' | 'address' | 'dob' | 'username' | 'captcha' | 'otp' | 'face' | 'id_document';

/** Human-readable category for Sensitive Information Firewall */
export type SensitiveCategory =
  | 'Personal Information'
  | 'Authentication Secrets'
  | 'Financial Information'
  | 'Identity Information'
  | 'Visual Sensitive Data';

export function categoryOf(type: PiiType): SensitiveCategory {
  switch (type) {
    case 'name': case 'email': case 'phone': case 'address': case 'dob':
      return 'Personal Information';
    case 'username': case 'password': case 'otp': case 'captcha':
      return 'Authentication Secrets';
    case 'account': case 'card': case 'ifsc':
      return 'Financial Information';
    case 'pan': case 'aadhaar': case 'application_id': case 'identifier':
      return 'Identity Information';
    case 'face': case 'id_document':
      return 'Visual Sensitive Data';
    default:
      return 'Personal Information';
  }
}

/** Token used in sanitized outbound context — never the raw secret. */
export const REDACTION_TOKEN: Record<string, string> = {
  password: '[REDACTED_PASSWORD]',
  otp: '[REDACTED_OTP]',
  captcha: '[REDACTED_CAPTCHA]',
  username: '[REDACTED_USERNAME]',
  card: '[REDACTED_CARD]',
  account: '[REDACTED_ACCOUNT]',
  pan: '[REDACTED_PAN]',
  aadhaar: '[REDACTED_AADHAAR]',
  email: '[REDACTED_EMAIL]',
  phone: '[REDACTED_PHONE]',
  name: '[REDACTED_NAME]',
  address: '[REDACTED_ADDRESS]',
  dob: '[REDACTED_DOB]',
  ifsc: '[REDACTED_IFSC]',
  application_id: '[REDACTED_APP_ID]',
  identifier: '[REDACTED_ID]',
  face: '[REDACTED_FACE]',
  id_document: '[REDACTED_ID_DOCUMENT]',
};

export interface Detection {
  type: PiiType;
  /** dom | dom+context | dom+regex | inline-label | inline+regex | regex | regex-heuristic | ocr ... */
  source: string;
  confidence: number;
  start: number;
  end: number;
}

export interface SanitizedElement {
  id: string;
  type: 'button' | 'link' | 'input' | 'select' | 'checkbox' | 'radio' | 'heading' | 'text' | 'image';
  text?: string;
  content?: string;
  label?: string;
  placeholder?: string;
  input_type?: string;
  value?: string;
  has_value?: boolean;
  checked?: boolean;
  options?: string[];
  href_path?: string;
  disabled?: boolean;
  sensitive?: boolean;
  in_viewport?: boolean;
  alt?: string;
  ocr_text?: string;
  ocr_status?: 'pending' | 'ok' | 'failed' | 'unavailable' | 'not_scanned' | 'skipped_captcha';
  ocr_regions_redacted?: number;
  flags?: string[];
}

export interface SanitizedPage {
  title: string;
  url: string;
  page_type: string;
  demo_site: boolean;
  scroll: { y: number; max_y: number; viewport_h: number };
  elements: SanitizedElement[];
}

/** Sanitized visual grounding from local ONNX CV — no raw pixels. */
export interface VisualDetectionSanitized {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface VisualContext {
  used: boolean;
  backend: 'webgpu' | 'wasm' | 'cpu' | 'unavailable';
  model?: string;
  model_size_mb?: number;
  inference_ms?: number;
  detections: VisualDetectionSanitized[];
  scene_summary?: string;
  /** Perception pipeline flags for judges/telemetry */
  trace?: {
    DOM_USED: boolean;
    CV_USED: boolean;
    OCR_USED: boolean;
    FACE_DETECTION_USED: boolean;
  };
}

export interface AgentPayload {
  task: string;
  page: SanitizedPage;
  visual?: VisualContext;
}

export type ActionName = 'click' | 'scroll' | 'type' | 'select' | 'navigate' | 'none';

export interface AgentAction {
  action: ActionName;
  element_id?: string;
  direction?: 'up' | 'down' | 'top' | 'bottom';
  amount?: number;
  text?: string;
  value?: string;
  url?: string;
  confidence?: number;
  reason?: string;
}

export interface FirewallReport {
  allowed: boolean;
  redactions: number;
  violations: number;
  reason?: string;
  checked_strings: number;
  violation_types?: string[];
}

export interface StageTimings {
  dom_scan_ms: number;
  vision_ms?: number;
  ocr_ms: number;
  detect_ms: number;
  redact_ms: number;
  verify_ms: number;
  perception_total_ms: number;
  network_ms?: number;
  server_ai_ms?: number;
  validate_ms?: number;
  exec_ms?: number;
  total_ms?: number;
}

export interface ValidationResult {
  allowed: boolean;
  code?: string;
  reason?: string;
  requiresConfirmation?: boolean;
  action?: AgentAction;
}

export interface ExecutionResult {
  executed: boolean;
  detail?: string;
  mutations?: number;
  scroll_delta?: number;
  navigated?: boolean;
}

export interface LocalRow {
  id: string;
  label?: string;
  original: string;
  redacted: string;
  raw: string[];
  types: PiiType[];
  confidence: number;
  source: string;
}

export interface ResourceStats {
  hardware_concurrency: number;
  device_memory_gb?: number;
  webgpu_available: boolean;
  webgpu_inference_active?: boolean;
  js_heap_used_mb?: number;
  js_heap_delta_mb?: number;
  face_detector_available: boolean;
  ocr_model_size_mb?: number;
  ocr_engine?: string;
  ocr_available?: boolean;
  vision_backend?: 'webgpu' | 'wasm' | 'cpu' | 'unavailable';
  vision_model_name?: string;
  vision_model_size_mb?: number;
  vision_available?: boolean;
  vision_inference_ms?: number;
  vision_init_ms?: number;
  vision_input?: string;
  perception_trace?: {
    DOM_USED: boolean;
    CV_USED: boolean;
    OCR_USED: boolean;
    FACE_DETECTION_USED: boolean;
    cv_reason?: string;
    ocr_reason?: string;
  };
  payload_bytes: number;
  raw_page_bytes: number;
}

export interface PerceiveResult {
  ok: boolean;
  error?: string;
  blocked?: boolean;
  payload?: AgentPayload;
  report: FirewallReport;
  timings: StageTimings;
  resources: ResourceStats;
  stats: { elements: number; sensitive_items: number; redacted: number; by_type: Record<string, number>; visuals: number; vision?: { executed: boolean; backend: string; detections: number; modelName?: string } };
}

export interface RunRecord {
  id: string;
  ts: number;
  task: string;
  status: 'completed' | 'blocked' | 'error' | 'action_rejected';
  error?: string;
  error_code?: string;
  url?: string;
  privacy?: {
    sensitive_items: number;
    redacted: number;
    raw_pii_sent: number;
    firewall: FirewallReport;
    second_layer?: FirewallReport;
    network: 'SANITIZED' | 'BLOCKED' | 'NOT_SENT';
    by_type: Record<string, number>;
  };
  payload?: AgentPayload;
  server_action?: AgentAction;
  provider?: string;
  validation?: ValidationResult;
  execution?: ExecutionResult;
  timings?: StageTimings;
  resources?: ResourceStats;
}
