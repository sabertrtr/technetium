import { useState } from 'react'
import type { Thread } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useThreadList, type ThreadListEntry } from '../client/useThreadList'
import { AuthedImage } from './AuthedImage'
import { parseMxc } from '../client/media'

// Cross-room thread inbox strip. Sits left of the thread panel at ~half its width.
// Each tile shows room, author, start time, first-post preview/thumbnail, reply
// count, most-recent time — and an expandable stats breakdown.
export function ThreadList({
  onSelect,
  activeRootId,
  width = 190,
}: {
  onSelect: (roomId: string, rootId: string) => void
  activeRootId?: string
  width?: number
}) {
  const { client } = useClient()
  const entries = useThreadList(client)

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        borderLeft: '1px solid rgba(128,128,128,0.25)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          fontWeight: 600,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        Threads
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No threads yet.</div>
        ) : (
          entries.map((e) => (
            <ThreadTile
              key={e.roomId + e.rootId}
              entry={e}
              active={e.rootId === activeRootId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function ThreadTile({
  entry,
  active,
  onSelect,
}: {
  entry: ThreadListEntry
  active: boolean
  onSelect: (roomId: string, rootId: string) => void
}) {
  const { thread, roomName, roomId, rootId, lastTs } = entry
  const [expanded, setExpanded] = useState(false)
  const root = thread.rootEvent
  const author = root?.getSender() ?? '(unknown)'
  const content = root?.getContent()
  const bodyRaw = typeof content?.body === 'string' ? content.body : ''
  const preview = bodyRaw.replace(/\s+/g, ' ').trim() || '(no preview)'
  const mxc = typeof content?.url === 'string' ? content.url : ''
  const isImage = content?.msgtype === 'm.image' && !!parseMxc(mxc)

  const fmt = (ts: number) =>
    ts
      ? new Date(ts).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : ''
  const startTime = fmt(root?.getTs() ?? 0)
  const lastTime = fmt(lastTs)

  const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

  return (
    <div
      style={{
        borderBottom: '1px solid rgba(128,128,128,0.15)',
        background: active ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
      }}
    >
      <div
        onClick={() => onSelect(roomId, rootId)}
        style={{ padding: '8px 10px', cursor: 'pointer', color: 'var(--cpd-color-text-primary)' }}
      >
        <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', ...ell }}>{roomName}</div>
        <div style={{ fontSize: 12, fontWeight: 600, ...ell }}>{author}</div>
        {/* Placeholder for a future thread title (not yet a feature). */}
        <div
          style={{
            fontSize: 11,
            fontStyle: 'italic',
            opacity: 0.45,
            color: 'var(--cpd-color-text-secondary)',
            ...ell,
          }}
        >
          (untitled)
        </div>
        <div style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', ...ell }}>{startTime}</div>
        {isImage ? (
          <AuthedImage mxc={mxc} width={180} maxHeight={90} alt={preview} />
        ) : (
          <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', ...ell }}>{preview}</div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 6,
            marginTop: 2,
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', ...ell }}>
            💬 {thread.length} · {lastTime}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            style={{
              flexShrink: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--cpd-color-text-secondary)',
              fontSize: 10,
              padding: 0,
              cursor: 'pointer',
            }}
          >
            {expanded ? '▾' : '▸'} stats
          </button>
        </div>
      </div>
      {expanded && <ThreadStats thread={thread} />}
    </div>
  )
}

// Aggregate breakdown of a thread: walk root + replies, count posts and
// media-bearing posts overall and per sender.
function ThreadStats({ thread }: { thread: Thread }) {
  const tl = thread.timeline
  const rootEv = thread.rootEvent
  const events =
    rootEv && !tl.some((e) => e.getId() === rootEv.getId()) ? [rootEv, ...tl] : tl

  const MEDIA = new Set(['m.image', 'm.file', 'm.video', 'm.audio'])
  const perUser = new Map<string, { posts: number; media: number }>()
  let total = 0
  let mediaTotal = 0
  for (const ev of events) {
    if (ev.getType() !== 'm.room.message') continue
    const sender = ev.getSender()
    if (!sender) continue
    const msgtype = ev.getContent()?.msgtype
    const isMedia = typeof msgtype === 'string' && MEDIA.has(msgtype)
    total++
    if (isMedia) mediaTotal++
    const u = perUser.get(sender) ?? { posts: 0, media: 0 }
    u.posts++
    if (isMedia) u.media++
    perUser.set(sender, u)
  }
  const users = [...perUser.entries()]
    .map(([id, v]) => ({ id, posts: v.posts, media: v.media }))
    .sort((a, b) => b.posts - a.posts)

  return (
    <div
      style={{
        padding: '6px 10px 10px',
        fontSize: 11,
        color: 'var(--cpd-color-text-secondary)',
        background: 'rgba(128,128,128,0.06)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {perUser.size} {perUser.size === 1 ? 'poster' : 'posters'} · {total}{' '}
        {total === 1 ? 'post' : 'posts'} · {mediaTotal} media
      </div>
      {users.map((u) => (
        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.id}
          </span>
          <span style={{ flexShrink: 0 }}>
            {u.posts} · 📎{u.media}
          </span>
        </div>
      ))}
    </div>
  )
}
