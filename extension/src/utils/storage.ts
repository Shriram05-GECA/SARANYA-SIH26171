export async function sget<T>(key: string): Promise<T | undefined> {
  const r = (await chrome.storage.local.get(key)) as Record<string, unknown>;
  return r[key] as T | undefined;
}
