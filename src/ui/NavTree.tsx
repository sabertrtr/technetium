import { useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { type TreeNode } from '../client/spaces'
import { useNavTree } from '../client/useNavTree'

// Unified spaces > subspaces > rooms tree: compact, collapsible, theme-aware.
// Spaces toggle their children open/closed; rooms are selectable. Density and
// colors use Compound design tokens so it matches the rest of the app. The tree
// is kept live by useNavTree (rebuilds on room/space changes).
export function NavTree({
  selectedRoomId,
  onSelectRoom,
}: {
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
}) {
  const { client } = useClient()
  const tree = useNavTree(client)
  // Spaces default to expanded; this holds the room-ids that are collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (roomId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(roomId) ? next.delete(roomId) : next.add(roomId)
      return next
    })

  if (!tree) return null

  return (
    <nav
      style={{
        fontSize: 13,
        lineHeight: 1.3,
        color: 'var(--cpd-color-text-primary)',
        userSelect: 'none',
      }}
    >
      {tree.spaces.map((node) => (
        <TreeRow
          key={node.room.roomId}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          selectedRoomId={selectedRoomId}
          onSelectRoom={onSelectRoom}
        />
      ))}
      {tree.orphanRooms.length > 0 && (
        <>
          <div
            style={{
              margin: '10px 0 2px',
              padding: '0 8px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: 'var(--cpd-color-text-secondary)',
            }}
          >
            Direct &amp; other
          </div>
          {tree.orphanRooms.map((node) => (
            <TreeRow
              key={node.room.roomId}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              selectedRoomId={selectedRoomId}
              onSelectRoom={onSelectRoom}
            />
          ))}
        </>
      )}
    </nav>
  )
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  selectedRoomId,
  onSelectRoom,
}: {
  node: TreeNode
  depth: number
  collapsed: Set<string>
  onToggle: (roomId: string) => void
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
}) {
  const label = node.room.name || node.room.roomId
  const isCollapsed = collapsed.has(node.room.roomId)
  const isSelected = !node.isSpace && node.room.roomId === selectedRoomId
  const indent = 6 + depth * 12
  const { client } = useClient()
  const isInvite = node.room.getMyMembership() === 'invite'
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(false)
  const onJoin = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!client || joining) return
    setJoining(true)
    setJoinError(false)
    try { await client.joinRoom(node.room.roomId) }
    catch { setJoinError(true); setJoining(false) }
  }

  const onClick = () => {
    if (node.isSpace) onToggle(node.room.roomId)
    else onSelectRoom?.(node.room)
  }

  return (
    <>
      <div
        onClick={onClick}
        title={label}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: indent,
          paddingRight: 6,
          height: 24,
          cursor: 'pointer',
          borderRadius: 6,
          margin: '1px 4px',
          fontWeight: isInvite ? 700 : node.isSpace ? 600 : 400,
          color: isInvite
              ? '#3bd16f'
              : node.isSpace
            ? 'var(--cpd-color-text-secondary)'
            : 'var(--cpd-color-text-primary)',
          background: isSelected ? 'var(--cpd-color-bg-action-primary-rest)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent'
        }}
      >
        <span style={{ width: 12, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>
          {node.isSpace ? (isCollapsed ? '▸' : '▾') : ''}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.isSpace ? label : `# ${label}`}
        </span>
        {isInvite && (
          <span onClick={onJoin}
            title={joinError ? 'Join failed - click to retry' : 'Accept invite'}
            style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, fontWeight: 700,
              color: joinError ? '#e2554e' : '#3bd16f',
              cursor: joining ? 'default' : 'pointer', opacity: joining ? 0.6 : 1 }}>
            {joining ? 'joining...' : joinError ? 'retry' : 'join'}
          </span>
        )}
      </div>
      {node.isSpace &&
        !isCollapsed &&
        node.children.map((child) => (
          <TreeRow
            key={child.room.roomId}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            selectedRoomId={selectedRoomId}
            onSelectRoom={onSelectRoom}
          />
        ))}
    </>
  )
}
