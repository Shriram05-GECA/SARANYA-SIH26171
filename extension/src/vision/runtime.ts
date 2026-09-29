/**
 * ONNX Runtime Web session management with WebGPU → WASM fallback.
 * Records the backend that actually succeeded (not just availability).
 */

import type { VisionBackend } from './types';

export interface SessionHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  backend: VisionBackend;
  inputName: string;
  outputNames: string[];
}

let ortModule: typeof import('onnxruntime-web') | null = null;

async function loadOrt(): Promise<typeof import('onnxruntime-web')> {
  if (ortModule) return ortModule;
  try {
    // Dynamic import keeps the initial content-script payload smaller.
    ortModule = await import('onnxruntime-web');
    return ortModule;
  } catch (e) {
    throw new Error(
      `onnxruntime-web not available: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
    );
  }
}

/**
 * Create an InferenceSession trying WebGPU first, then WASM.
 * Returns the backend that actually worked.
 */
export async function createSession(
  modelUrlOrBuffer: string | ArrayBuffer,
  opts: { preferWebGPU?: boolean } = {},
): Promise<SessionHandle> {
  const ort = await loadOrt();
  const preferWebGPU = opts.preferWebGPU !== false;

  const tryProviders: { name: VisionBackend; providers: string[] }[] = [];
  if (preferWebGPU) {
    tryProviders.push({ name: 'webgpu', providers: ['webgpu', 'wasm'] });
  }
  tryProviders.push({ name: 'wasm', providers: ['wasm'] });

  let lastError: unknown = null;

  for (const { name, providers } of tryProviders) {
    try {
      // Configure WASM paths if needed (bundled later in build).
      if (name === 'wasm' || providers.includes('wasm')) {
        try {
          ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
          ort.env.wasm.simd = true;
        } catch {
          /* ignore env config failures */
        }
      }

      const session = await ort.InferenceSession.create(modelUrlOrBuffer, {
        executionProviders: providers,
        graphOptimizationLevel: 'all',
      });

      const inputName = session.inputNames[0] ?? 'images';
      const outputNames = session.outputNames?.length ? [...session.outputNames] : ['output'];

      return { session, backend: name, inputName, outputNames };
    } catch (e) {
      lastError = e;
      // Continue to next provider
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Vision model session failed (WebGPU+WASM): ${msg.slice(0, 180)}`);
}

export async function runInference(
  handle: SessionHandle,
  tensor: Float32Array,
  dims: number[],
): Promise<Float32Array> {
  const ort = await loadOrt();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feeds: Record<string, any> = {
    [handle.inputName]: new ort.Tensor('float32', tensor, dims),
  };
  const results = await handle.session.run(feeds);
  const outName = handle.outputNames[0];
  const out = results[outName];
  if (!out || !(out.data instanceof Float32Array)) {
    const data = out?.data;
    if (data && (data as ArrayLike<number>).length) {
      return new Float32Array(data as ArrayLike<number>);
    }
    throw new Error('Vision model returned empty or non-float output');
  }
  return out.data as Float32Array;
}

export function isWebGPUUsable(): boolean {
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } };
    return !!(nav.gpu);
  } catch {
    return false;
  }
}
