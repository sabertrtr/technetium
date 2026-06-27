import { useEffect, useState } from 'react'
import { ThreadEvent } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { toItems } from '../client/useTimeline'
import { Row } from './Timeline'
import { Composer } from './Composer'

// Thread panel: a thread's root + replies, resolved by (roomId, rootId) so it
// stays open and correct even when the user navigates to other rooms. Renders via
// the shared Row, so images/markdown match the main timeline. Posting into the
// thread (its own Composer) lands in step 3.
export function ThreadPanel({
  roomId,
  rootId,
  onClose,
}: {
  roomId: string
  rootId: string
  onClose: () => void
}) {
  const { client } = useClient()
  const [, forceRefresh] = useState(0)

  const room = client?.getRoom(roomId) ?? null
  const thread = room?.getThread(rootId) ?? null

  // Re-render on any change to this thread (new replies, edits).
  useEffect(() => {
    if (!thread) return
    const refresh = () => forceRefresh((n) => n + 1)
    thread.on(ThreadEvent.Update, refresh)
    thread.on(ThreadEvent.NewReply, refresh)
    return () => {
      thread.off(ThreadEvent.Update, refresh)
      thread.off(ThreadEvent.NewReply, refresh)
    }
  }, [thread])

  // Root + replies, de-duped (the thread timeline usually already includes root).
  const rootEv = thread?.rootEvent ?? room?.findEventById(rootId) ?? null
  const tl = thread?.timeline ?? []
  const events =
    rootEv && !tl.some((e) => e.getId() === rootEv.getId()) ? [rootEv, ...tl] : tl
  const items = toItems(events)

  return (
    <aside
      style={{
        width: 380,
        flexShrink: 0,
        borderLeft: '1px solid rgba(128,128,128,0.25)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 13 }}>
          Thread{room ? ` \u00b7 ${room.name || roomId}` : ''}
        </strong>
        <button type="button" onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 0, color: 'var(--cpd-color-text-primary)' }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.6 }}>
            {thread ? 'No messages in this thread.' : 'Loading thread\u2026'}
          </div>
        ) : (
          items.map((item) => <Row key={item.id} item={item} />)
        )}
      </div>

      {room && <Composer room={room} threadId={rootId} />}
    </aside>
  )
}
