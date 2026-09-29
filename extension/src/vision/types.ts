/** Local learned visual perception types for SIH26171. */

export type VisionBackend = 'webgpu' | 'wasm' | 'cpu' | 'unavailable';

export interface VisionBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionDetection {
  label: string;
  confidence: number;
  bbox: VisionBBox;
}

export interface VisionResult {
  backend: VisionBackend;
  modelName: string;
  modelSizeBytes: number;
  inferenceMs: number;
  initMs?: number;
  inputWidth: number;
  inputHeight: number;
  detections: VisionDetection[];
  /** True when the model actually ran (not a stub). */
  executed: boolean;
  fallbackReason?: string;
}

export interface VisionStats {
  available: boolean;
  backend: VisionBackend;
  modelName: string;
  modelSizeBytes: number;
  initMs?: number;
  inferenceCount: number;
  lastInferenceMs?: number;
  meanInferenceMs?: number;
  p50InferenceMs?: number;
  p95InferenceMs?: number;
  inputWidth?: number;
  inputHeight?: number;
  heapBeforeMb?: number;
  heapAfterMb?: number;
  heapDeltaMb?: number;
}

export interface VisionConfig {
  /** Prefer WebGPU when available and model loads successfully. */
  preferWebGPU: boolean;
  /** Confidence threshold for keeping detections. */
  confidenceThreshold: number;
  /** Max detections to return. */
  maxDetections: number;
  /** Input size the model expects (square). */
  inputSize: number;
}
