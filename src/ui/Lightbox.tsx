import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientContext'
import { fetchMediaObjectUrl, parseMxc } from '../client/media'

// Full-screen image viewer, mounted once at App root as a provider so any
// descendant (timeline, thread panel) opens it via useLightbox() with no
// prop-drilling. Holds an ordered SET of images plus the current index: a
// single image is just a one-element set (no nav shown); a gallery passes its
// whole batch so prev/next steps within it. Shows the current image full-res
// (no thumbnail width), fetched through the same authed gateway path as inline
// images. Owns the object-URL lifecycle and retains the fetched blob so Save
// reuses it -- no second download.

// A single image in the viewer: the mxc to show, an optional name for the
// download filename / alt text, and an optional mimetype to derive an extension.
export interface LightboxItem {
  mxc: string
  name?: string
  mimetype?: string
}

interface LightboxApi {
  // Open the viewer on a set of images at startIndex (clamped). A one-element
  // set shows no navigation.
  open: (items: LightboxItem[], startIndex?: number) => void
}

const LightboxContext = createContext<LightboxApi | null>(null)

// Hook for any descendant of LightboxProvider to open the viewer.
export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext)
  if (!ctx) throw new Error('useLightbox must be used within a LightboxProvider')
  return ctx
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

// Build a safe download filename: prefer the message's name, else the mxc
// mediaId; strip path separators; ensure an extension, deriving one from the
// mimetype when the name carries none.
function downloadName(item: LightboxItem): string {
  const parsed = parseMxc(item.mxc)
  let base = (item.name?.trim() || parsed?.mediaId || 'image').replace(/[/\\]+/g, '_')
  if (!/\.[a-z0-9]{1,8}$/i.test(base)) {
    const ext = item.mimetype ? MIME_EXT[item.mimetype] : undefined
    if (ext) base = `${base}.${ext}`
  }
  return base
}

const toolbarBtn: React.CSSProperties = {
  fontSize: 13,
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
  background: 'var(--cpd-color-bg-subtle-secondary)',
  color: 'var(--cpd-color-text-primary)',
  cursor: 'pointer',
}

const navBtn: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 44,
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 28,
  lineHeight: 1,
  borderRadius: 8,
  border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
  background: 'rgba(20,20,20,0.6)',
  color: 'var(--cpd-color-text-primary)',
  cursor: 'pointer',
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const { client } = useClient()
  const [items, setItems] = useState<LightboxItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // The fetched full-res object URL, retained so Save reuses the exact blob the
  // viewer already downloaded. Revoked on close / item change.
  const urlRef = useRef<string | null>(null)

  const current = items && index >= 0 && index < items.length ? items[index] : null
  const hasNav = !!items && items.length > 1
  const atFirst = index <= 0
  const atLast = !items || index >= items.length - 1

  const open = useCallback((next: LightboxItem[], startIndex = 0) => {
    if (next.length === 0) return
    setItems(next)
    setIndex(Math.min(Math.max(0, startIndex), next.length - 1))
  }, [])
  const close = useCallback(() => setItems(null), [])
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const next = useCallback(
    () => setIndex((i) => (items ? Math.min(items.length - 1, i + 1) : i)),
    [items],
  )

  // Fetch the current image full-res whenever it changes; revoke the prior blob.
  useEffect(() => {
    const cur = items && index >= 0 && index < items.length ? items[index] : null
    if (!client || !cur) {
      setSrc(null)
      setError(false)
      return
    }
    let cancelled = false
    setSrc(null)
    setError(false)

    fetchMediaObjectUrl(client, cur.mxc)
      .then((objUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objUrl)
          return
        }
        urlRef.current = objUrl
        setSrc(objUrl)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [client, items, index])

  // Keyboard: Escape closes; arrows navigate (when a set is open).
  useEffect(() => {
    if (!items) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, close, prev, next])

  // Download the already-fetched blob under a friendly filename. Reuses the
  // viewer's object URL, so no network round-trip.
  const save = useCallback(() => {
    if (!src || !current) return
    const a = document.createElement('a')
    a.href = src
    a.download = downloadName(current)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [src, current])

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      {current && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Toolbar: stopPropagation so its clicks don't hit the closing backdrop. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center' }}
          >
            {hasNav && (
              <span style={{ fontSize: 13, color: 'var(--cpd-color-text-secondary)', marginRight: 4 }}>
                {index + 1} / {items!.length}
              </span>
            )}
            <button type="button" onClick={save} disabled={!src} style={toolbarBtn}>
              Save
            </button>
            <button type="button" onClick={close} style={toolbarBtn}>
              Close
            </button>
          </div>

          {hasNav && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
              disabled={atFirst}
              aria-label="Previous image"
              style={{ ...navBtn, left: 16, opacity: atFirst ? 0.35 : 1 }}
            >
              {'\u2039'}
            </button>
          )}

          {/* Image area: stopPropagation so clicking the picture doesn't close. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '92vw',
              maxHeight: '92vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {error ? (
              <span style={{ color: 'var(--cpd-color-text-secondary)', fontStyle: 'italic' }}>
                [image unavailable]
              </span>
            ) : src ? (
              <img
                src={src}
                alt={current.name ?? 'image'}
                style={{
                  maxWidth: '92vw',
                  maxHeight: '92vh',
                  objectFit: 'contain',
                  display: 'block',
                  borderRadius: 4,
                }}
              />
            ) : (
              <span style={{ color: 'var(--cpd-color-text-secondary)' }}>Loading...</span>
            )}
          </div>

          {hasNav && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
              disabled={atLast}
              aria-label="Next image"
              style={{ ...navBtn, right: 16, opacity: atLast ? 0.35 : 1 }}
            >
              {'\u203a'}
            </button>
          )}
        </div>
      )}
    </LightboxContext.Provider>
  )
}
