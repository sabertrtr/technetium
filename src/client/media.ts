import type { MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// Media gateway client. This is the ONE place that knows how an mxc:// URI
// becomes bytes: the fourier-auth gateway origin, the URL shape, and the
// bearer-token fetch. Everything else (timeline, composer previews) goes
// through here, so changing the gateway — origin, thumbnail params, a future
// signed-URL scheme — is a single-file change, never a hunt.
// ---------------------------------------------------------------------------

// Gateway origin, configurable per build so dev / prod / future hosts don't
// require a code edit. Falls back to the production gateway when unset, so the
// client works with zero config. Trailing slashes trimmed for clean joins.
const MEDIA_BASE = (
  (import.meta.env.VITE_MEDIA_BASE as string | undefined) ?? 'https://mxc.41chan.net'
).replace(/\/+$/, '')

// In-memory cache of resolved presigned R2 URLs for ORIGINALS, keyed by mxc.
// The presigned URL changes signature on every mint, so without this each
// re-view (gallery left/right, timeline scrollback) is a fresh URL = a fresh
// browser cache key = a full re-download. Reusing the same URL within its life
// lets the browser's disk cache (immutable header on the R2 response) hit.
// Reuse only while >60s of the presign's life remains, so <img> never gets a
// URL about to expire mid-load.
const REUSE_MARGIN_MS = 60 * 1000
const originalUrlCache = new Map<string, { url: string; expiresAt: number }>()

// Thumbnail widths the gateway honors (snapped server-side to its
// ALLOWED_THUMB_SIZES). Exposed so callers pick a real size, not an arbitrary
// one that would just get snapped anyway.
export const THUMB_SIZES = [180, 320, 360, 720, 850] as const
export type ThumbSize = (typeof THUMB_SIZES)[number]

export interface ParsedMxc {
  serverName: string
  mediaId: string
}

// Parse an mxc:// URI into { serverName, mediaId }, or null if it isn't a
// well-formed mxc:// (so callers can fall back to showing the raw body).
export function parseMxc(mxc: string): ParsedMxc | null {
  const m = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(mxc.trim())
  if (!m) return null
  return { serverName: m[1], mediaId: m[2] }
}

// Build the gateway URL for an mxc. With `width`, requests a thumbnail;
// without, the full download. Returns null for a malformed mxc.
export function mediaUrl(mxc: string, width?: ThumbSize): string | null {
  const parsed = parseMxc(mxc)
  if (!parsed) return null
  const path = `${MEDIA_BASE}/media/${encodeURIComponent(
    parsed.serverName,
  )}/${encodeURIComponent(parsed.mediaId)}`
  return width ? `${path}?w=${width}` : path
}

// Fetch an mxc through the gateway with the client's MAS token as Bearer and
// return an object URL for the bytes. The caller MUST URL.revokeObjectURL the
// result when done, or it leaks the blob. Throws on a missing token or non-2xx
// response, so the UI can show an error/retry rather than a broken <img>.
export async function fetchMediaObjectUrl(
  client: MatrixClient,
  mxc: string,
  width?: ThumbSize,
): Promise<string> {
  const url = mediaUrl(mxc, width)
  if (!url) throw new Error(`invalid mxc URI: ${mxc}`)

  const token = client.getAccessToken()
  if (!token) throw new Error('no access token available for media fetch')

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    throw new Error(`media fetch failed (${resp.status}) for ${mxc}`)
  }
  return URL.createObjectURL(await resp.blob())
}

// Resolve an mxc to a directly-loadable <img src>.
//
// Two response shapes from the gateway, by request type:
//   - ORIGINAL (no width): the gateway authorizes, then returns JSON
//     { url } with a short-lived presigned R2 URL. We return that URL as-is;
//     the caller loads it with a plain <img src>, which fetches bytes straight
//     from R2 (cross-origin <img> is unrestricted; the presigned URL self-
//     authorizes). No blob, and no CORS-on-redirect problem.
//   - THUMBNAIL (width set): the gateway streams image bytes directly, so we
//     fall back to the blob path.
//
// Returns { src, revoke }: `revoke` is a no-op for the original path (nothing
// to free) and revokes the object URL for the thumbnail path. The caller
// always calls revoke() on cleanup and needn't know which path ran.
export async function fetchMediaSrc(
  client: MatrixClient,
  mxc: string,
  width?: ThumbSize,
): Promise<{ src: string; revoke: () => void }> {
  if (width) {
    const objUrl = await fetchMediaObjectUrl(client, mxc, width)
    return { src: objUrl, revoke: () => URL.revokeObjectURL(objUrl) }
  }

  // Reuse a still-valid cached presigned URL so the browser cache can hit.
  const cached = originalUrlCache.get(mxc)
  if (cached && cached.expiresAt - Date.now() > REUSE_MARGIN_MS) {
    return { src: cached.url, revoke: () => {} }
  }

  const url = mediaUrl(mxc)
  if (!url) throw new Error(`invalid mxc URI: ${mxc}`)

  const token = client.getAccessToken()
  if (!token) throw new Error('no access token available for media fetch')

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    throw new Error(`media fetch failed (${resp.status}) for ${mxc}`)
  }
  const data = (await resp.json()) as { url?: string; expiresIn?: number }
  if (!data.url) throw new Error(`gateway returned no url for ${mxc}`)
  // Gateway presigns for 300s; cache with that lifetime (default if unsent).
  const ttlMs = (data.expiresIn ?? 300) * 1000
  originalUrlCache.set(mxc, { url: data.url, expiresAt: Date.now() + ttlMs })
  return { src: data.url, revoke: () => {} }
}
