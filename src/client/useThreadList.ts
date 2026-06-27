import { useEffect, useState, useCallback } from 'react'
import { ThreadEvent, ClientEvent, type MatrixClient, type Thread } from 'matrix-js-sdk'

export interface ThreadListEntry {
  roomId: string
  roomName: string
  rootId: string
  thread: Thread
  lastTs: number
}

// Cross-room thread inbox. Aggregates room.getThreads() across every joined room
// (in-memory, from sync) and stays live via client-level ThreadEvent re-emission.
// No server polling: threads arrive through the normal sync stream; fetchRoomThreads
// just backfills the server-side list once per room on open.
export function useThreadList(client: MatrixClient | null): ThreadListEntry[] {
  const [entries, setEntries] = useState<ThreadListEntry[]>([])

  const rebuild = useCallback(() => {
    if (!client) {
      setEntries([])
      return
    }
    const out: ThreadListEntry[] = []
    for (const room of client.getRooms()) {
      if (room.getMyMembership() !== 'join') continue
      for (const thread of room.getThreads()) {
        const rootId = thread.rootEvent?.getId()
        if (!rootId) continue
        const last = thread.replyToEvent ?? thread.rootEvent ?? null
        out.push({
          roomId: room.roomId,
          roomName: room.name || room.roomId,
          rootId,
          thread,
          lastTs: last?.getTs() ?? 0,
        })
      }
    }
    out.sort((a, b) => b.lastTs - a.lastTs)
    setEntries(out)
  }, [client])

  useEffect(() => {
    if (!client) return
    // Backfill each joined room's server-side thread list once (idempotent).
    for (const room of client.getRooms()) {
      if (room.getMyMembership() === 'join') {
        void room.fetchRoomThreads().then(rebuild).catch(() => {})
      }
    }
    rebuild()
    const onChange = () => rebuild()
    client.on(ThreadEvent.New, onChange)
    client.on(ThreadEvent.Update, onChange)
    client.on(ThreadEvent.NewReply, onChange)
    client.on(ClientEvent.Room, onChange)
    return () => {
      client.off(ThreadEvent.New, onChange)
      client.off(ThreadEvent.Update, onChange)
      client.off(ThreadEvent.NewReply, onChange)
      client.off(ClientEvent.Room, onChange)
    }
  }, [client, rebuild])

  return entries
}
