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
