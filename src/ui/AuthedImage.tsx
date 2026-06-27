import { useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientContext'
import { fetchMediaObjectUrl, type ThumbSize } from '../client/media'

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
}: {
  mxc: string
  width?: ThumbSize
  alt?: string
  maxHeight?: number
  onClick?: () => void
}) {
  const { client } = useClient()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // Track the current object URL across renders so cleanup always revokes the
  // exact blob this instance created, even if mxc changes mid-flight.
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    setSrc(null)
    setError(false)

    fetchMediaObjectUrl(client, mxc, width)
      .then((objUrl) => {
        if (cancelled) {
          // Component moved on before the fetch resolved — revoke immediately.
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
  }, [client, mxc, width])

  if (error) {
    return (
      <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--cpd-color-text-secondary)' }}>
        [image unavailable]
      </span>
    )
  }

  if (!src) {
    return (
      <span
        style={{
          display: 'inline-block',
          width: 120,
          height: 90,
          borderRadius: 8,
          background: 'var(--cpd-color-bg-subtle-secondary)',
        }}
        aria-label="loading image"
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt ?? 'image'}
      onClick={onClick}
      style={{
        maxWidth: '100%',
        maxHeight,
        borderRadius: 8,
        display: 'block',
        cursor: onClick ? 'pointer' : 'default',
      }}
    />
  )
}
