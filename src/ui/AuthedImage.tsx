import { useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientContext'
import { fetchMediaSrc, type ThumbSize } from '../client/media'

// Renders an mxc:// image by fetching it through the media gateway with the
// client's bearer token and showing the resulting blob. Owns the object-URL
// lifecycle: fetch on mount / mxc change, revoke on cleanup so blobs don't leak
// as the timeline scrolls. `width` requests a thumbnail; omit for full size.
export function AuthedImage({
  mxc,
  width,
  alt,
  maxHeight = 320,
  onClick,
  fill = false,
  transparentLoading = false,
}: {
  mxc: string
  width?: ThumbSize
  alt?: string
  maxHeight?: number
  onClick?: () => void
  fill?: boolean
  transparentLoading?: boolean
}) {
  const { client } = useClient()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // Track the current object URL across renders so cleanup always revokes the
  // exact blob this instance created, even if mxc changes mid-flight.
  const revokeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    setSrc(null)
    setError(false)

    fetchMediaSrc(client, mxc, width)
      .then(({ src: resolved, revoke }) => {
        if (cancelled) {
          // Component moved on before the fetch resolved — clean up immediately.
          revoke()
          return
        }
        revokeRef.current = revoke
        setSrc(resolved)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
      if (revokeRef.current) {
        revokeRef.current()
        revokeRef.current = null
      }
    }
  }, [client, mxc, width])

  if (error) {
    return (
      <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--cpd-color-text-secondary)' }}>
        [image unavailable]
      </span>
    )
  }

  if (!src) {
    // Render nothing while loading so a layer behind (e.g. a gallery cell's
    // pending graphic) shows through until the image paints over it.
    if (transparentLoading) return null
    return (
      <span
        style={
          fill
            ? { display: 'block', width: '100%', height: '100%', background: 'var(--cpd-color-bg-subtle-secondary)' }
            : {
                display: 'inline-block',
                width: 120,
                height: 90,
                borderRadius: 8,
                background: 'var(--cpd-color-bg-subtle-secondary)',
              }
        }
        aria-label="loading image"
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt ?? 'image'}
      onClick={onClick}
      style={
        fill
          ? {
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              cursor: onClick ? 'pointer' : 'default',
            }
          : {
              maxWidth: '100%',
              maxHeight,
              borderRadius: 8,
              display: 'block',
              cursor: onClick ? 'pointer' : 'default',
            }
      }
    />
  )
}
