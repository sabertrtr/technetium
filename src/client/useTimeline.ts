import { useEffect, useRef, useState, useCallback } from 'react'
import {
  RoomEvent,
  type MatrixClient,
  type Room,
  type MatrixEvent,
} from 'matrix-js-sdk'

// Classification the renderer switches on, so it never re-parses event shape.
export type TimelineItemKind = 'message' | 'encrypted' | 'redacted' | 'other' | 'gallery'

export type GalleryLayout = 'grid' | 'stack' | 'strip'

export interface TimelineItem {
  event: MatrixEvent
  kind: TimelineItemKind
  id: string
  // kind 'gallery' only: cells sized to the batch's declared count, with images
  // placed by their net.41chan.gallery.index. null = a slot whose image hasn't
  // arrived (pending, failed, or interleaved elsewhere in the timeline).
  cells?: (MatrixEvent | null)[]
  // kind 'gallery' only: the sender's chosen layout (defaults to 'grid').
  layout?: GalleryLayout
}

function classify(ev: MatrixEvent): TimelineItemKind {
  if (ev.isRedacted()) return 'redacted'
  // Encrypted but not yet decrypted (crypto is a later phase) -> placeholder.
  if (ev.getType() === 'm.room.encrypted' || ev.isEncrypted()) return 'encrypted'
  if (ev.getType() === 'm.room.message') return 'message'
  return 'other'
}

interface GalleryTag {
  id: string
  index?: number
  count?: number
  layout?: GalleryLayout
}

// Parse the composer's batch hint off a gallery-tagged m.image, or null.
function galleryTag(ev: MatrixEvent): GalleryTag | null {
  if (ev.isRedacted()) return null
  if (ev.getType() !== 'm.room.message') return null
  const c = ev.getContent()
  if (c.msgtype !== 'm.image') return null
  const g = c['net.41chan.gallery']
  if (!g || typeof g !== 'object') return null
  const id = (g as { id?: unknown }).id
  if (typeof id !== 'string') return null
  const index = (g as { index?: unknown }).index
  const count = (g as { count?: unknown }).count
  const layout = (g as { layout?: unknown }).layout
  return {
    id,
    index: typeof index === 'number' ? index : undefined,
    count: typeof count === 'number' ? count : undefined,
    layout:
      layout === 'grid' || layout === 'stack' || layout === 'strip' ? layout : undefined,
  }
}

export function toItems(events: MatrixEvent[]): TimelineItem[] {
  const out: TimelineItem[] = []
  const consumed = new Set<string>()

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const evId = ev.getId() ?? ''
    if (!evId || consumed.has(evId)) continue

    const tag = galleryTag(ev)
    if (tag) {
      // Gather every member of this batch across the whole window (not just the
      // consecutive run), so interleaved/out-of-order images still land in-grid.
      const members = events.filter((e) => galleryTag(e)?.id === tag.id)

      // Grid size = declared count, expanded to fit any present index / overflow.
      let size = tag.count && tag.count >= 1 ? tag.count : 0
      for (const m of members) {
        const mi = galleryTag(m)?.index
        if (typeof mi === 'number' && mi + 1 > size) size = mi + 1
      }
      if (members.length > size) size = members.length

      if (size >= 2) {
        for (const m of members) {
          const mid = m.getId()
          if (mid) consumed.add(mid)
        }
        const cells: (MatrixEvent | null)[] = new Array(size).fill(null)
        for (const m of members) {
          const mi = galleryTag(m)?.index
          let slot = typeof mi === 'number' ? mi : -1
          if (slot < 0 || slot >= size || cells[slot] !== null) {
            slot = cells.findIndex((c) => c === null) // fallback: first free slot
          }
          if (slot >= 0) cells[slot] = m
        }
        out.push({ event: ev, kind: 'gallery', id: evId, cells, layout: tag.layout ?? 'grid' })
        continue
      }
    }

    out.push({ event: ev, kind: classify(ev), id: evId })
  }

  return out
}

// Depth a freshly-opened room back-fills to (sync alone delivers ~20).
const INITIAL_SCROLLBACK = 60

// Live timeline for a room: current events, live appends, and scrollback.
export function useTimeline(client: MatrixClient | null, room: Room | null) {
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [atStart, setAtStart] = useState(false)
  const roomRef = useRef<Room | null>(null)

  // Rebuild the item list from the room's current live timeline.
  const refresh = useCallback(() => {
    if (!room) {
      setItems([])
      return
    }
    setItems(toItems(room.getLiveTimeline().getEvents()))
  }, [room])

  useEffect(() => {
    roomRef.current = room
    refresh()
    setAtStart(false)
    if (!client || !room) return
    let cancelled = false

    // Deepen a shallow initial view once per room open, so a fresh room
    // shows real history without the user clicking for it.
    if (room.getLiveTimeline().getEvents().length < INITIAL_SCROLLBACK) {
      client
        .scrollback(room, INITIAL_SCROLLBACK)
        .then(() => {
          if (!cancelled) refresh()
        })
        .catch(() => {})
    }

    // Fire on any timeline change in THIS room (new messages, etc.).
    const onTimeline = (_ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId === roomRef.current?.roomId) refresh()
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      cancelled = true
      client.off(RoomEvent.Timeline, onTimeline)
    }
  }, [client, room, refresh])

  // Load a page of older events (scrollback). Resolves when done.
  const loadOlder = useCallback(async () => {
    if (!client || !room || loadingOlder || atStart) return
    setLoadingOlder(true)
    try {
      const before = room.getLiveTimeline().getEvents().length
      await client.scrollback(room, 30)
      const after = room.getLiveTimeline().getEvents().length
      refresh()
      // No new events came back -> we've reached the start of the room.
      if (after === before) setAtStart(true)
    } finally {
      setLoadingOlder(false)
    }
  }, [client, room, loadingOlder, atStart, refresh])

  return { items, loadOlder, loadingOlder, atStart }
}
