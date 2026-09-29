import type { ResourceStats } from '../types';

export const now = () => performance.now();
export const round = (n: number) => Math.round(n * 10) / 10;

export async function collectResources(payloadBytes: number, rawBytes: number, heapBefore?: number): Promise<ResourceStats> {
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
  const nav = navigator as unknown as { deviceMemory?: number; gpu?: { requestAdapter(): Promise<unknown> } };
  let webgpu = false;
  try { webgpu = !!(nav.gpu && (await nav.gpu.requestAdapter())); } catch { webgpu = false; }
  const heap = perf.memory?.usedJSHeapSize;
  return {
    hardware_concurrency: navigator.hardwareConcurrency ?? 0,
    device_memory_gb: nav.deviceMemory,
    webgpu_available: webgpu,
    js_heap_used_mb: heap !== undefined ? round(heap / 1048576) : undefined,
    js_heap_delta_mb: heap !== undefined && heapBefore !== undefined ? round((heap - heapBefore) / 1048576) : undefined,
    face_detector_available: 'FaceDetector' in window,
    payload_bytes: payloadBytes,
    raw_page_bytes: rawBytes,
  };
}

export function heapNow(): number | undefined {
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
}

/** Errors surfaced to UI must never contain page data. */
export function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[REDACTED]').replace(/\d{6,}/g, '[REDACTED]').slice(0, 200);
}
