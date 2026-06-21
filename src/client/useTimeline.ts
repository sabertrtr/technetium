import { useEffect, useRef, useState, useCallback } from 'react'
import {
  RoomEvent,
  type MatrixClient,
  type Room,
  type MatrixEvent,
} from 'matrix-js-sdk'

// Classification the renderer switches on, so it never re-parses event shape.
export type TimelineItemKind = 'message' | 'encrypted' | 'redacted' | 'other'

export interface TimelineItem {
  event: MatrixEvent
  kind: TimelineItemKind
  id: string
}

function classify(ev: MatrixEvent): TimelineItemKind {
  if (ev.isRedacted()) return 'redacted'
  // Encrypted but not yet decrypted (crypto is a later phase) -> placeholder.
  if (ev.getType() === 'm.room.encrypted' || ev.isEncrypted()) return 'encrypted'
  if (ev.getType() === 'm.room.message') return 'message'
  return 'other'
}

function toItems(events: MatrixEvent[]): TimelineItem[] {
  return events
    .map((ev) => ({ event: ev, kind: classify(ev), id: ev.getId() ?? '' }))
    .filter((it) => it.id)
}

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

    // Fire on any timeline change in THIS room (new messages, etc.).
    const onTimeline = (_ev: MatrixEvent, evRoom: Room | undefined) => {
      if (evRoom?.roomId === roomRef.current?.roomId) refresh()
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
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
