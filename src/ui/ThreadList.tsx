import { useState } from 'react'
import { useClient } from '../client/ClientContext'
import {
  useThreadList,
  threadListDefaults,
  type ThreadListItem,
  type ThreadScope,
  type ThreadSort,
} from '../client/useThreadList'
import { AuthedImage } from './AuthedImage'
import { parseMxc } from '../client/media'

// Thread inbox strip. Scoped to the current room by default (user-changeable
// default eventually via account-data prefs); toggleable to all joined rooms.
// Tiles carry an inline stat cluster (posts / media / posters) whose hover (or
// tap, on touch) reveals the per-user breakdown.
export function ThreadList({
  onSelect,
  activeRootId,
  roomId,
  width = 190,
}: {
  onSelect: (roomId: string, rootId: string) => void
  activeRootId?: string
  roomId?: string
  width?: number
}) {
  const { client } = useClient()
  const defaults = threadListDefaults()
  const [scope, setScope] = useState<ThreadScope>(roomId ? defaults.scope : 'all')
  const [sort, setSort] = useState<ThreadSort>(defaults.sort)
  const entries = useThreadList(client, { roomId, scope, sort })

  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    border: '1px solid rgba(128,128,128,0.35)',
    background: active ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
    color: 'var(--cpd-color-text-primary)',
    cursor: 'pointer',
  })

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
          padding: '10px 12px 6px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Threads</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingBottom: 6 }}>
          {roomId && (
            <button type="button" style={chip(scope === 'room')} onClick={() => setScope('room')}>
              This room
            </button>
          )}
          <button type="button" style={chip(scope === 'all')} onClick={() => setScope('all')}>
            All rooms
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ThreadSort)}
            style={{
              fontSize: 11,
              background: 'transparent',
              color: 'var(--cpd-color-text-primary)',
              border: '1px solid rgba(128,128,128,0.35)',
              borderRadius: 10,
              padding: '2px 4px',
            }}
          >
            <option value="latest-activity">Latest</option>
            <option value="created">Created</option>
            <option value="reply-count">Replies</option>
          </select>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No threads yet.</div>
        ) : (
          entries.map((e) => (
            <ThreadTile
              key={e.roomId + e.rootId}
              item={e}
              active={e.rootId === activeRootId}
              showRoom={scope === 'all'}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function ThreadTile({
  item,
  active,
  showRoom,
  onSelect,
}: {
  item: ThreadListItem
  active: boolean
  showRoom: boolean
  onSelect: (roomId: string, rootId: string) => void
}) {
  const { thread, roomName, roomId, rootId, lastTs, createdTs, author } = item
  const root = thread.rootEvent
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
        {showRoom && (
          <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', ...ell }}>{roomName}</div>
        )}
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
        <div style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', ...ell }}>{fmt(createdTs)}</div>
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
          <StatCluster item={item} />
          <span style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', flexShrink: 0 }}>
            {fmt(lastTs)}
          </span>
        </div>
      </div>
    </div>
  )
}

// Inline stat cluster: posts / media posts / unique posters. Hovering (or, on
// touch, tapping) shows the per-user breakdown: "@user: 15(p) 10(m)".
function StatCluster({ item }: { item: ThreadListItem }) {
  const [show, setShow] = useState(false)
  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => {
        // Tap-toggle for touch; stop the tile's open-thread click.
        e.stopPropagation()
        setShow((v) => !v)
      }}
      style={{ position: 'relative', display: 'inline-flex', gap: 8, minWidth: 0 }}
    >
      <span style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', whiteSpace: 'nowrap' }}>
        {'\u{1F4AC}'} {item.postCount} {'\u00B7'} {'\u{1F4CE}'} {item.mediaCount} {'\u00B7'} {'\u{1F464}'} {item.posterCount}
      </span>
      {show && item.perUser.length > 0 && (
        <span
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            zIndex: 20,
            background: 'var(--cpd-color-bg-canvas-default)',
            border: '1px solid rgba(128,128,128,0.35)',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 11,
            color: 'var(--cpd-color-text-secondary)',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          {item.perUser.map((u) => (
            <span key={u.userId} style={{ display: 'block' }}>
              {u.userId}: {'\u{1F4AC}'}{u.posts} {'\u{1F4CE}'}{u.media}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
