import { useEffect, useRef, useState } from 'react'
import { ThreadEvent, type Room, type MatrixEvent } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useTimeline, type TimelineItem, type GalleryLayout } from '../client/useTimeline'
import { renderMessageBody } from '../client/messageBody'
import { parseMxc } from '../client/media'
import { AuthedImage } from './AuthedImage'
import { useLightbox, type LightboxItem } from './Lightbox'

// Read-only timeline. Message bodies render sanitized rich HTML (via DOMPurify)
// when present, else plaintext. Encrypted events show a placeholder until the
// crypto phase.
export function Timeline({ room, onOpenThread, threadListOpen, onToggleThreadList }: { room: Room; onOpenThread?: (roomId: string, rootId: string) => void; threadListOpen?: boolean; onToggleThreadList?: () => void }) {
  const { client } = useClient()
  const { items, loadOlder, loadingOlder, atStart } = useTimeline(client, room)
  useEffect(() => {
    followRef.current = true
  }, [room])
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Non-null while a load-older is in flight: the scrollHeight captured
  // just before the prepend, used to restore the viewport afterward.
  const prependHeightRef = useRef<number | null>(null)
  // Follow mode: while true, every content/layout change re-pins the view
  // to the bottom (initial load, back-fill landing, images painting, new
  // messages). Starts true on room open; disengages when the user scrolls
  // up; re-engages when they return near the bottom. This makes late
  // layout shifts (async images) harmless instead of each needing a fix.
  const followRef = useRef(true)

  // Scroll behavior on item-count change:
  //  - after a load-older PREPEND: keep the viewport pinned to the same
  //    message (offset scrollTop by the height the prepend added).
  //  - otherwise (initial load / new message APPEND): follow the bottom,
  //    but only if the user was already near it -- don't yank someone
  //    who is reading history.
  useEffect(() => {
    const el = scrollRef.current
    if (el && prependHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
      return
    }
    if (!followRef.current) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  // Track user intent: scrolling away from the bottom disengages follow mode;
  // returning near it re-engages. Prepend restores land away from the bottom,
  // so they naturally leave follow off (correct: the user is reading history).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // While following, re-pin on ANY content growth (async image paints shift
  // layout well after the items effect has run).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (followRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
    })
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [items.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span>{room.name || room.roomId}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!atStart && (
            <button
              type="button"
              onClick={() => {
                prependHeightRef.current = scrollRef.current?.scrollHeight ?? null
                void loadOlder()
              }}
              disabled={loadingOlder}
              style={{ fontSize: 12, fontWeight: 400 }}
            >
              {loadingOlder ? 'Loading...' : 'Load older'}
            </button>
          )}
          {onToggleThreadList && (
            <button
              type="button"
              onClick={onToggleThreadList}
              style={{ fontSize: 12, fontWeight: 400 }}
            >
              {threadListOpen ? 'Threads X' : 'Threads'}
            </button>
          )}
        </div>
      </header>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          color: 'var(--cpd-color-text-primary)',
        }}
      >
        {atStart && (
          <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', padding: '4px 0', marginBottom: 8 }}>
            Beginning of the room.
          </div>
        )}

        {items.map((item) => (
          <Row key={item.id} item={item} onOpenThread={onOpenThread} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export function Row({ item, onOpenThread }: { item: TimelineItem; onOpenThread?: (roomId: string, rootId: string) => void }) {
  const { event, kind, cells, layout } = item
  const { open } = useLightbox()
  const sender = event.getSender() ?? '(unknown)'
  const time = new Date(event.getTs()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  let body: React.ReactNode
  if (kind === 'gallery' && cells) {
    body = <GalleryBody cells={cells} layout={layout ?? 'grid'} />
  } else if (kind === 'message') {
    const content = event.getContent()
    const mxc = typeof content.url === 'string' ? content.url : ''
    if (content.msgtype === 'm.image' && parseMxc(mxc)) {
      // Image message: render the picture inline via the gateway as a thumbnail
      // (320 snaps to the gateway's allowed sizes). Click opens the full-res
      // image in the lightbox via an authed full fetch.
      body = (
        <AuthedImage
          mxc={mxc}
          width={320}
          alt={typeof content.body === 'string' ? content.body : undefined}
          onClick={() => open([{ mxc, ...imageMeta(event) }], 0)}
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
        <div style={{ fontSize: 14, wordBreak: 'break-word', minWidth: 0 }}>{body}</div>
        {event.isThreadRoot && <ThreadChip event={event} onOpen={onOpenThread} />}
      </div>
    </div>
  )
}

// One grid cell: a static "pending upload" graphic as the background, with the
// thumbnail layered over it (transparentLoading, so the graphic shows through
// until the real image paints). A null / loading / failed slot shows the graphic.
// Pull a friendly filename + mimetype off an m.image content for the lightbox
// (download name + extension hinting). filename wins (MSC2530 caption case),
// else body; the mediaId is the downstream fallback.
function imageMeta(ev: MatrixEvent): { name?: string; mimetype?: string } {
  const c = ev.getContent()
  const name =
    typeof c.filename === 'string' ? c.filename : typeof c.body === 'string' ? c.body : undefined
  const info = c.info as { mimetype?: unknown } | undefined
  const mimetype = info && typeof info.mimetype === 'string' ? info.mimetype : undefined
  return { name, mimetype }
}

function GalleryCell({ ev, onOpen }: { ev: MatrixEvent | null; onOpen?: () => void }) {
  const c = ev?.getContent()
  const mxc = c && typeof c.url === 'string' ? c.url : ''
  const showImg = !!ev && !!parseMxc(mxc)
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--cpd-color-bg-subtle-secondary)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--cpd-color-text-secondary)',
          opacity: 0.4,
        }}
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
      {showImg && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <AuthedImage
            mxc={mxc}
            width={360}
            alt={typeof c?.body === 'string' ? c.body : undefined}
            fill
            transparentLoading
            onClick={onOpen}
          />
        </div>
      )}
    </div>
  )
}

// Coalesced image batch (net.41chan.gallery). Three sender-chosen layouts:
//  - grid:  fixed-size square cells arranged by count (2/3 in a row, 4 as 2x2,
//           5 as a double-height cell on the left + a 2x2 on the right).
//  - stack: constant total height; N full-width rows split it (fewer = taller).
//  - strip: constant total width+height; N columns split it (fewer = wider).
// Cells fill their grid track; all geometry lives here. Caption (index-0) below.
const GALLERY_CELL = 118 // px square; 3 cols + 2 gaps = 360, matching stack/strip width
const GALLERY_GAP = 3

function GalleryBody({ cells, layout }: { cells: (MatrixEvent | null)[]; layout: GalleryLayout }) {
  const n = cells.length
  const { open } = useLightbox()
  // Present (non-null, valid) images in cell order, plus a map from cell index
  // to its position in that list, so clicking a cell opens the lightbox at the
  // right spot and prev/next steps through the batch's real images only.
  const present: LightboxItem[] = []
  const presentIndexByCell = new Map<number, number>()
  cells.forEach((ev, idx) => {
    if (!ev) return
    const cc = ev.getContent()
    const cmxc = typeof cc.url === 'string' ? cc.url : ''
    if (!parseMxc(cmxc)) return
    presentIndexByCell.set(idx, present.length)
    present.push({ mxc: cmxc, ...imageMeta(ev) })
  })
  const first = cells[0]
  const fc = first?.getContent()
  const caption = first && typeof fc?.filename === 'string' ? renderMessageBody(first) : null

  let gridStyle: React.CSSProperties
  let cellPlacement: (idx: number) => React.CSSProperties = () => ({})

  if (layout === 'stack') {
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gridTemplateRows: `repeat(${n}, 1fr)`,
      gap: GALLERY_GAP,
      width: 360,
      height: 300,
    }
  } else if (layout === 'strip') {
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${n}, 1fr)`,
      gridTemplateRows: '1fr',
      gap: GALLERY_GAP,
      width: 360,
      height: 280,
    }
  } else if (n === 5) {
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(3, ${GALLERY_CELL}px)`,
      gridTemplateRows: `repeat(2, ${GALLERY_CELL}px)`,
      gap: GALLERY_GAP,
      width: 'max-content',
    }
    cellPlacement = (idx) => (idx === 0 ? { gridColumn: '1', gridRow: '1 / span 2' } : {})
  } else {
    const cols = n <= 3 ? n : 2
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, ${GALLERY_CELL}px)`,
      gridAutoRows: `${GALLERY_CELL}px`,
      gap: GALLERY_GAP,
      width: 'max-content',
    }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...gridStyle, borderRadius: 8, overflow: 'hidden' }}>
        {cells.map((ev, idx) => (
          <div
            key={ev?.getId() ?? `empty-${idx}`}
            style={{ position: 'relative', minWidth: 0, ...cellPlacement(idx) }}
          >
            <GalleryCell
              ev={ev}
              onOpen={
                presentIndexByCell.has(idx)
                  ? () => open(present, presentIndexByCell.get(idx)!)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
      {caption && (
        <div style={{ fontSize: 14, wordBreak: 'break-word', marginTop: 4 }}>
          {caption.html !== undefined ? (
            <span className="tc-message-html" dangerouslySetInnerHTML={{ __html: caption.html }} />
          ) : (
            <span>{caption.text}</span>
          )}
        </div>
      )}
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
