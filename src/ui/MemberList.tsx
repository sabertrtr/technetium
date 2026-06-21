import { useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useMembers } from '../client/useMembers'
import { honorificFor, maxPower, type MergedMember } from '../client/members'

type Mode = 'room' | 'all' | 'all-highlight'

// Color per honorific tier. Dimmed variant signals "authority elsewhere".
const HONOR_COLOR: Record<string, string> = {
  '~': 'var(--cpd-color-text-success-primary, #2dbd7e)', // owner
  '@': 'var(--cpd-color-text-info-primary, #4b8bf5)', // op/mod
  '+': 'var(--cpd-color-text-warning-primary, #d4a72c)', // voice
}

export function MemberList({ room }: { room: Room | null }) {
  const { client } = useClient()
  const members = useMembers(client)
  const [mode, setMode] = useState<Mode>('room')

  const inRoom = (m: MergedMember) =>
    room ? room.roomId in m.powerByRoom : false

  let shown: MergedMember[]
  if (mode === 'room') {
    shown = room ? members.filter(inRoom) : []
  } else {
    shown = members
  }

  shown = [...shown].sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  )

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderLeft: '1px solid rgba(128,128,128,0.25)',
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--cpd-color-text-primary)',
      }}
    >
      <div style={{ display: 'flex', gap: 2, padding: 6 }}>
        <ModeBtn active={mode === 'room'} onClick={() => setMode('room')}>Room</ModeBtn>
        <ModeBtn active={mode === 'all'} onClick={() => setMode('all')}>All</ModeBtn>
        <ModeBtn active={mode === 'all-highlight'} onClick={() => setMode('all-highlight')}>All ·</ModeBtn>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 4px' }}>
        <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', padding: '2px 8px' }}>
          {shown.length} {shown.length === 1 ? 'member' : 'members'}
        </div>
        {shown.map((m) => (
          <MemberRow key={m.id} member={m} room={room} mode={mode} />
        ))}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  room,
  mode,
}: {
  member: MergedMember
  room: Room | null
  mode: Mode
}) {
  // Honorific IDENTITY = highest power anywhere in the space.
  const identityHonor = honorificFor(maxPower(member))

  // Visual STRENGTH depends on the viewing context:
  //  - room mode: full if they hold power IN this room, dimmed if elsewhere.
  //  - all-highlight: emphasize members also in the current room.
  //  - all: everyone full-strength (whole-space context).
  const plHere = room ? (member.powerByRoom[room.roomId] ?? 0) : 0
  const presentHere = room ? room.roomId in member.powerByRoom : false

  let dimmed = false
  if (mode === 'room') {
    // Authority "here" = their honorific tier is actually backed by power here.
    dimmed = honorificFor(plHere) !== identityHonor
  } else if (mode === 'all-highlight') {
    dimmed = !presentHere
  }

  // Honorific color responds to dim state: vivid tier color when the authority
  // is "here", muted grey when "elsewhere" — so the badge recedes consistently
  // with the dimmed name (a saturated glyph survives parent opacity too well to
  // read as dimmed on its own).
  const honorColor = !identityHonor
    ? undefined
    : dimmed
    ? 'var(--cpd-color-text-secondary)'
    : HONOR_COLOR[identityHonor]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 8px',
        borderRadius: 6,
        color: dimmed
          ? 'var(--cpd-color-text-secondary)'
          : 'var(--cpd-color-text-primary)',
        opacity: dimmed ? 0.6 : 1,
      }}
      title={member.id}
    >
      <span
        style={{
          width: 12,
          textAlign: 'center',
          fontWeight: 700,
          color: honorColor,
        }}
      >
        {identityHonor ?? ''}
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
        }}
      >
        {member.displayName}
      </span>
    </div>
  )
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 11,
        padding: '4px 0',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        background: active
          ? 'var(--cpd-color-bg-action-primary-rest)'
          : 'var(--cpd-color-bg-subtle-secondary)',
        color: active
          ? 'var(--cpd-color-text-on-solid-primary, #fff)'
          : 'var(--cpd-color-text-secondary)',
      }}
    >
      {children}
    </button>
  )
}
