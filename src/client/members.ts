import type { MatrixClient, Room } from 'matrix-js-sdk'
import { buildNavTree, type NavTree, type TreeNode } from './spaces'

// IRC-style honorific tiers, mapped to Matrix power levels.
// ~ owner (100), @ op/mod (50), + voice (25, placeholder), default = none.
export type Honorific = '~' | '@' | '+' | null

export function honorificFor(powerLevel: number): Honorific {
  if (powerLevel >= 100) return '~'
  if (powerLevel >= 50) return '@'
  if (powerLevel >= 25) return '+'
  return null
}

// A member, normalized across all sources. Identity is the canonical key (the
// Matrix user id for now). powerByRoom carries the member's PL in each
// SPACE-STRUCTURED room they're in (DMs/orphans are excluded from power — see
// below — so a DM's default PL 100 doesn't masquerade as community standing).
// `sources` records which providers vouch for this person, so a future Discord
// source can merge into the same record.
export interface MergedMember {
  id: string // canonical identity (mxid for now)
  displayName: string
  avatarMxc?: string
  sources: string[] // e.g. ['matrix'] now; ['matrix','discord'] later
  powerByRoom: Record<string, number> // roomId -> power level (space rooms only)
}

export interface MemberSource {
  id: string
  label: string
  getMembers(): MergedMember[]
  subscribe(onChange: () => void): () => void
}

// Highest power level this member holds anywhere in the space — drives the
// honorific IDENTITY. Visual strength is decided by comparing against their PL
// in the specific room being viewed.
export function maxPower(m: MergedMember): number {
  let max = 0
  for (const pl of Object.values(m.powerByRoom)) if (pl > max) max = pl
  return max
}

// Split the nav tree into space-structured rooms (channels — these confer
// authority) and orphan rooms (DMs / direct-joins — members appear but their PLs
// do NOT count, since being "admin" of your own DM isn't community standing).
function partitionRooms(tree: NavTree): { spaceRooms: Room[]; orphanRooms: Room[] } {
  const spaceRooms: Room[] = []
  const walk = (node: TreeNode) => {
    if (!node.isSpace) spaceRooms.push(node.room)
    node.children.forEach(walk)
  }
  tree.spaces.forEach(walk)
  const orphanRooms = tree.orphanRooms.map((n) => n.room)
  return { spaceRooms, orphanRooms }
}

export function createMatrixSpaceSource(client: MatrixClient): MemberSource {
  const build = (): MergedMember[] => {
    const tree = buildNavTree(client)
    const { spaceRooms, orphanRooms } = partitionRooms(tree)
    const byId = new Map<string, MergedMember>()

    const ensure = (rm: { userId: string; name: string; getMxcAvatarUrl: () => string | null | undefined }) => {
      let m = byId.get(rm.userId)
      if (!m) {
        m = {
          id: rm.userId,
          displayName: rm.name || rm.userId,
          avatarMxc: rm.getMxcAvatarUrl() ?? undefined,
          sources: ['matrix'],
          powerByRoom: {},
        }
        byId.set(rm.userId, m)
      }
      return m
    }

    // Space rooms: record membership AND power level (these confer honorifics).
    for (const room of spaceRooms) {
      for (const rm of room.getJoinedMembers()) {
        const m = ensure(rm)
        m.powerByRoom[room.roomId] = rm.powerLevel
      }
    }

    // Orphan rooms (DMs/direct-joins): record membership ONLY — no power, so
    // these never contribute to honorifics. The person still appears in 'all'.
    for (const room of orphanRooms) {
      for (const rm of room.getJoinedMembers()) {
        ensure(rm) // presence only; powerByRoom untouched for this room
      }
    }

    return [...byId.values()]
  }

  return {
    id: 'matrix',
    label: 'Matrix',
    getMembers: build,
    subscribe: (onChange) => {
      client.on('RoomMember.membership' as any, onChange)
      client.on('RoomMember.powerLevel' as any, onChange)
      client.on('RoomState.events' as any, onChange)
      return () => {
        client.off('RoomMember.membership' as any, onChange)
        client.off('RoomMember.powerLevel' as any, onChange)
        client.off('RoomState.events' as any, onChange)
      }
    },
  }
}
