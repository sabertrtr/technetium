import {
  useState,
  useRef,
  type KeyboardEvent,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { formatMessage } from '../client/messageFormat'

// Read an image file's pixel dimensions by loading it into an off-DOM <img>.
// Used to populate m.image `info.w/h` so other clients can size the thumbnail
// before downloading. Best-effort: callers treat a rejection as "no dimensions".
function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dims = { w: img.naturalWidth, h: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dims)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not read image dimensions'))
    }
    img.src = url
  })
}

// Message composer pinned to the bottom of a room view. Enter sends, Shift+Enter
// inserts a newline. Markdown becomes sanitized HTML (sendHtmlMessage) when it
// produces formatting, else plain text. Images attach via the button or by drop:
// they upload to Synapse (which mints the mxc) and send as m.image; bmb picks the
// event up and creates the Danbooru post. Sent messages appear in the timeline
// via the live RoomEvent.Timeline subscription.
export function Composer({ room, threadId }: { room: Room; threadId?: string }) {
  const { client } = useClient()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const send = async () => {
    const input = text.trim()
    if (!input || !client || sending) return
    setSending(true)
    setText('') // optimistic clear; restore on failure
    try {
      const { plain, html } = formatMessage(input)
      if (html !== undefined) {
        if (threadId) await client.sendHtmlMessage(room.roomId, threadId, plain, html)
        else await client.sendHtmlMessage(room.roomId, plain, html)
      } else {
        if (threadId) await client.sendTextMessage(room.roomId, threadId, plain)
        else await client.sendTextMessage(room.roomId, plain)
      }
    } catch (err) {
      console.error('Send failed:', err)
      setText(input) // put the text back so it isn't lost
    } finally {
      setSending(false)
      taRef.current?.focus()
    }
  }

  // Upload an image and post it as m.image. Synapse mints a fresh mxc per upload
  // by design; client-side dedup (against an existing mxc / MD5) is a separate
  // planned feature, so for now every send mints a new mxc — bmb's findPostByMd5
  // still guards against duplicate Danbooru posts.
  const sendImage = async (file: File) => {
    if (!client || sending) return
    if (!file.type.startsWith('image/')) {
      console.error('Not an image:', file.type)
      return
    }
    setSending(true)
    try {
      const dims = await readImageSize(file).catch(() => null)
      const { content_uri } = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
      })
      const info = { mimetype: file.type, size: file.size, ...(dims ?? {}) }
      if (threadId) {
        await client.sendImageMessage(room.roomId, threadId, content_uri, info, file.name)
      } else {
        await client.sendImageMessage(room.roomId, content_uri, info, file.name)
      }
    } catch (err) {
      console.error('Image send failed:', err)
    } finally {
      setSending(false)
      taRef.current?.focus()
    }
  }

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void sendImage(file)
    e.target.value = '' // let the same file be picked again
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith('image/'),
    )
    if (file) void sendImage(file)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragging) setDragging(true)
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      style={{
        borderTop: '1px solid rgba(128,128,128,0.25)',
        padding: '10px 16px',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        outline: dragging
          ? '2px dashed var(--cpd-color-text-action-accent, #1d8a64)'
          : 'none',
        outlineOffset: -2,
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={onFilePicked}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={sending}
        title="Attach image"
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
          cursor: sending ? 'default' : 'pointer',
          background: 'var(--cpd-color-bg-subtle-secondary)',
          color: 'var(--cpd-color-text-primary)',
          fontSize: 16,
          opacity: sending ? 0.5 : 1,
        }}
      >
        🖼
      </button>
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
