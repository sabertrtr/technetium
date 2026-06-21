import { useState, useRef, type KeyboardEvent } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { formatMessage } from '../client/messageFormat'

// Message composer pinned to the bottom of a room view. Enter sends, Shift+Enter
// inserts a newline. Markdown is converted to sanitized HTML and sent via
// sendHtmlMessage when it actually produces formatting; otherwise plain text.
// Sent messages appear in the timeline via the live RoomEvent.Timeline subscription.
export function Composer({ room }: { room: Room }) {
  const { client } = useClient()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const send = async () => {
    const input = text.trim()
    if (!input || !client || sending) return
    setSending(true)
    setText('') // optimistic clear; restore on failure
    try {
      const { plain, html } = formatMessage(input)
      if (html !== undefined) {
        await client.sendHtmlMessage(room.roomId, plain, html)
      } else {
        await client.sendTextMessage(room.roomId, plain)
      }
    } catch (err) {
      console.error('Send failed:', err)
      setText(input) // put the text back so it isn't lost
    } finally {
      setSending(false)
      taRef.current?.focus()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid rgba(128,128,128,0.25)',
        padding: '10px 16px',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
      }}
    >
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Message ${room.name || 'this room'}`}
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          minHeight: 38,
          maxHeight: 160,
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
          background: 'var(--cpd-color-bg-canvas-default)',
          color: 'var(--cpd-color-text-primary)',
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: 1.4,
        }}
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={sending || !text.trim()}
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          cursor: text.trim() ? 'pointer' : 'default',
          background: 'var(--cpd-color-bg-action-primary-rest)',
          color: 'var(--cpd-color-text-on-solid-primary, #fff)',
          fontWeight: 600,
          fontSize: 14,
          opacity: text.trim() && !sending ? 1 : 0.5,
        }}
      >
        Send
      </button>
    </div>
  )
}
