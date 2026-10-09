// Every static file the viewer loads goes through asset(). A single-file export defines
// window.__DATAWALK_ASSETS__ (path -> data URL), so the same code makes no network requests.
const inline = (globalThis as { __DATAWALK_ASSETS__?: Record<string, string> }).__DATAWALK_ASSETS__

export const asset = (path: string) => inline?.[path] ?? path

/** Directory URL for loaders that append file names (the KTX2 transcoder). */
export const assetDir = (dir: string) => (inline ? '' : dir)

export async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(asset(path))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}
