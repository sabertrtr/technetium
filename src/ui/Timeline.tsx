import { useEffect, useRef } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useTimeline, type TimelineItem } from '../client/useTimeline'
import { renderMessageBody } from '../client/messageBody'

// Read-only timeline. Message bodies render sanitized rich HTML (via DOMPurify)
// when present, else plaintext. Encrypted events show a placeholder until the
// crypto phase.
export function Timeline({ room }: { room: Room }) {
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
          <Row key={item.id} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function Row({ item }: { item: TimelineItem }) {
  const { event, kind } = item
  const sender = event.getSender() ?? '(unknown)'
  const time = new Date(event.getTs()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  let body: React.ReactNode
  if (kind === 'message') {
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
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', alignItems: 'baseline' }}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--cpd-color-text-secondary)',
          flexShrink: 0,
          width: 48,
        }}
      >
        {time}
      </span>
      <span
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: 'var(--cpd-color-text-primary)',
          flexShrink: 0,
        }}
      >
        {sender}
      </span>
      <span style={{ fontSize: 14, wordBreak: 'break-word' }}>{body}</span>
    </div>
  )
}
