import { useEffect, useRef, useState } from 'react'
import { ThreadEvent, type Room, type MatrixEvent } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useTimeline, type TimelineItem } from '../client/useTimeline'
import { renderMessageBody } from '../client/messageBody'
import { parseMxc } from '../client/media'
import { AuthedImage } from './AuthedImage'

// Read-only timeline. Message bodies render sanitized rich HTML (via DOMPurify)
// when present, else plaintext. Encrypted events show a placeholder until the
// crypto phase.
export function Timeline({ room, onOpenThread }: { room: Room; onOpenThread?: (roomId: string, rootId: string) => void }) {
  const { client } = useClient()
  const { items, loadOlder, loadingOlder, atStart } = useTimeline(client, room)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest message in view when the item count changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          color: 'var(--cpd-color-text-primary)',
        }}
      >
        <div style={{ marginBottom: 8 }}>
          {atStart ? (
            <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', padding: '4px 0' }}>
              Beginning of the room.
            </div>
          ) : (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              style={{ fontSize: 12 }}
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          )}
        </div>

        {items.map((item) => (
          <Row key={item.id} item={item} onOpenThread={onOpenThread} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export function Row({ item, onOpenThread }: { item: TimelineItem; onOpenThread?: (roomId: string, rootId: string) => void }) {
  const { event, kind } = item
  const sender = event.getSender() ?? '(unknown)'
  const time = new Date(event.getTs()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  let body: React.ReactNode
  if (kind === 'message') {
    const content = event.getContent()
    const mxc = typeof content.url === 'string' ? content.url : ''
    if (content.msgtype === 'm.image' && parseMxc(mxc)) {
      // Image message: render the picture inline via the gateway as a thumbnail
      // (320 snaps to the gateway's allowed sizes). Click-to-open-full is a
      // later step (needs an authenticated full fetch + lightbox).
      body = (
        <AuthedImage
          mxc={mxc}
          width={320}
          alt={typeof content.body === 'string' ? content.body : undefined}
        />
      )
    } else {
    const rendered = renderMessageBody(event)
    body =
      rendered.html !== undefined ? (
        // Sanitized by DOMPurify in renderMessageBody — safe to inject.
        <span
          className="tc-message-html"
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      ) : (
        <span>{rendered.text}</span>
      )
    }
  } else if (kind === 'encrypted') {
    body = <span style={{ fontStyle: 'italic', opacity: 0.7 }}>🔒 Encrypted (decryption coming later)</span>
  } else if (kind === 'redacted') {
    body = <span style={{ fontStyle: 'italic', opacity: 0.6 }}>(message deleted)</span>
  } else {
    body = (
      <span style={{ fontStyle: 'italic', opacity: 0.5 }}>
        [{event.getType()}]
      </span>
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: 'var(--cpd-color-text-primary)',
          }}
        >
          {sender}
        </span>
        <span style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', flexShrink: 0 }}>
          {time}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
          paddingLeft: 16,
          marginTop: 1,
        }}
      >
        <span style={{ fontSize: 14, wordBreak: 'break-word' }}>{body}</span>
        {event.isThreadRoot && <ThreadChip event={event} onOpen={onOpenThread} />}
      </div>
    </div>
  )
}

// "N replies" chip under a thread-root message. Reads the live reply count from
// the event's Thread and re-renders on thread updates. Click-to-open wiring lands
// in Phase 2 (an onOpen prop threaded from App to open the thread panel).
function ThreadChip({ event, onOpen }: { event: MatrixEvent; onOpen?: (roomId: string, rootId: string) => void }) {
  const thread = event.getThread()
  const [count, setCount] = useState(thread?.length ?? 0)

  useEffect(() => {
    if (!thread) return
    const update = () => setCount(thread.length)
    update()
    thread.on(ThreadEvent.Update, update)
    thread.on(ThreadEvent.NewReply, update)
    return () => {
      thread.off(ThreadEvent.Update, update)
      thread.off(ThreadEvent.NewReply, update)
    }
  }, [thread])

  if (!thread || count < 1) return null
  return (
    <button
      type="button"
      onClick={() => {
        const rootId = event.getId()
        const roomId = event.getRoomId()
        if (rootId && roomId && onOpen) onOpen(roomId, rootId)
      }}
      style={{
        alignSelf: 'flex-start',
        fontSize: 12,
        padding: '2px 8px',
        borderRadius: 12,
        border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
        background: 'var(--cpd-color-bg-subtle-secondary)',
        color: 'var(--cpd-color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      💬 {count} {count === 1 ? 'reply' : 'replies'}
    </button>
  )
}
