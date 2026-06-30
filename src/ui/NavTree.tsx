import { useEffect, useRef, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { type TreeNode } from '../client/spaces'
import { useNavTree } from '../client/useNavTree'

// Membership/join classification for a node's visual + click behavior.
type Mode = 'joined' | 'joinable' | 'knock'
function nodeMode(node: TreeNode): Mode {
  if (node.membership === 'join') return 'joined'
  if (node.membership === 'invite') return 'joinable' // accepting = a join
  const jr = node.joinRule
  if (jr === 'knock' || jr === 'knock_restricted') return 'knock'
  // restricted / public / anything else visible-but-unjoined: a direct join.
  return 'joinable'
}

export function NavTree({
  selectedRoomId,
  onSelectRoom,
}: {
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
}) {
  const { client } = useClient()
  const { tree, loading } = useNavTree(client)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (roomId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(roomId) ? next.delete(roomId) : next.add(roomId)
      return next
    })

  if (!tree) {
    return (
      <nav style={{ padding: '8px', fontSize: 13, color: 'var(--cpd-color-text-secondary)' }}>
        {loading ? 'Loading rooms...' : null}
      </nav>
    )
  }

  return (
    <nav
      style={{
        fontSize: 13,
        lineHeight: 1.3,
        color: 'var(--cpd-color-text-primary)',
        userSelect: 'none',
      }}
    >
      <style>{`
        @keyframes navJoinRipple {
          0%   { background: var(--cpd-color-bg-action-primary-rest); }
          100% { background: transparent; }
        }
        .nav-join-ripple { animation: navJoinRipple 900ms ease-out 1; }
      `}</style>
      {tree.spaces.map((node) => (
        <TreeRow
          key={node.roomId}
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
              key={node.roomId}
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
  const { client } = useClient()
  const label = node.name || node.roomId
  const isCollapsed = collapsed.has(node.roomId)
  const isSelected = !node.isSpace && node.roomId === selectedRoomId
  const indent = 6 + depth * 12
  const mode = nodeMode(node)
  const [busy, setBusy] = useState(false)
  const [knocked, setKnocked] = useState(false)
  const [actionError, setActionError] = useState(false)

  // Fire a one-shot ripple when this row transitions INTO joined.
  const prevMode = useRef(mode)
  const [ripple, setRipple] = useState(false)
  useEffect(() => {
    if (prevMode.current !== 'joined' && mode === 'joined') {
      setRipple(true)
      const t = setTimeout(() => setRipple(false), 900)
      prevMode.current = mode
      return () => clearTimeout(t)
    }
    prevMode.current = mode
  }, [mode])

  const onClick = async () => {
    if (node.isSpace && mode === 'joined') {
      onToggle(node.roomId)
      return
    }
    if (mode === 'joined') {
      if (node.room) onSelectRoom?.(node.room)
      return
    }
    if (!client || busy) return
    if (mode === 'knock') {
      setBusy(true)
      setActionError(false)
      try {
        await client.knockRoom(node.roomId)
        setKnocked(true)
      } catch {
        setActionError(true)
      } finally {
        setBusy(false)
      }
      return
    }
    // joinable: join, then open the room once it materializes.
    setBusy(true)
    setActionError(false)
    try {
      await client.joinRoom(node.roomId)
      const room = client.getRoom(node.roomId)
      if (room && !node.isSpace) onSelectRoom?.(room)
    } catch {
      setActionError(true)
    } finally {
      setBusy(false)
    }
  }

  // Color/weight per mode. Joinable = bright green; knock = darker green
  // (de-emphasized, no pill); joined = normal text.
  const color = actionError
    ? 'var(--cpd-color-text-critical-primary)'
    : mode === 'joinable'
      ? '#3bd16f'
      : mode === 'knock'
        ? '#2b9450'
        : node.isSpace
          ? 'var(--cpd-color-text-secondary)'
          : 'var(--cpd-color-text-primary)'

  return (
    <>
      <div
        onClick={onClick}
        title={knocked ? `${label} (request sent)` : label}
        className={ripple ? 'nav-join-ripple' : undefined}
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
          opacity: busy ? 0.6 : 1,
          fontWeight: mode === 'joinable' ? 700 : node.isSpace ? 600 : 400,
          color,
          background: isSelected
            ? 'var(--cpd-color-bg-action-primary-rest)'
            : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!isSelected)
            e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent'
        }}
      >
        <span style={{ width: 12, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>
          {node.isSpace ? (isCollapsed ? '\u25B8' : '\u25BE') : ''}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {knocked && (
          <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.8 }}>requested</span>
        )}
      </div>
      {node.isSpace && !isCollapsed &&
        node.children.map((child) => (
          <TreeRow
            key={child.roomId}
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
