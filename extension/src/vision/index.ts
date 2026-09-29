/**
 * Public entry for the local learned visual perception layer (SIH26171).
 *
 * Architecture role:
 *   DOM semantics  +  learned visual grounding  +  OCR (when needed)
 *
 * The model provides visual region grounding. It does NOT claim full
 * semantic understanding of browser UI by itself.
 */

export {
  detectVisualRegions,
  shouldRunVision,
  warmVisionModel,
  getVisionStats,
  ensureSession,
} from './detector';

export type {
  VisionBackend,
  VisionDetection,
  VisionResult,
  VisionStats,
  VisionBBox,
  VisionConfig,
} from './types';

export { resetVisionState } from './model';
