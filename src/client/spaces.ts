import type { MatrixClient, Room } from 'matrix-js-sdk'

// A node in the navigation tree. A space contains children (subspaces + rooms);
// a plain room is a leaf. We keep the Room handle so the UI can read name,
// avatar, unread state, etc. directly off it.
export interface TreeNode {
  room: Room
  isSpace: boolean
  children: TreeNode[]
}

// The full tree: top-level spaces (with their nested children) plus any rooms
// that aren't claimed by any space ("orphans" — DMs, rooms you joined directly).
export interface NavTree {
  spaces: TreeNode[]
  orphanRooms: TreeNode[]
}

// Read a space's ordered children from its m.space.child state events.
// state_key = child room id; content.order is Matrix's manual ordering string.
function getChildIds(space: Room): { id: string; order: string }[] {
  const events = space.currentState.getStateEvents('m.space.child')
  return events
    // A child event with empty content ({}) is a *removed* child — skip it.
    .filter((e) => Object.keys(e.getContent()).length > 0)
    .map((e) => ({
      id: e.getStateKey() ?? '',
      order: (e.getContent().order as string) ?? '',
    }))
    .filter((c) => c.id)
}

// Sort by the m.space.child `order` string (lexicographic, Matrix spec), then
// fall back to room name so ordering is stable and not auto-shuffled.
function sortChildren(children: TreeNode[]): TreeNode[] {
  return [...children].sort((a, b) => {
    const oa = (a as any)._order ?? ''
    const ob = (b as any)._order ?? ''
    if (oa !== ob) return oa < ob ? -1 : 1
    return (a.room.name || '').localeCompare(b.room.name || '')
  })
}

// Build the nav tree from the client's current joined rooms + space state.
export function buildNavTree(client: MatrixClient): NavTree {
  const rooms = client.getRooms()
  const byId = new Map<string, Room>(rooms.map((r) => [r.roomId, r]))

  // Which rooms are referenced as a child of some space — so we can find the
  // top-level spaces (spaces that nobody else parents) and the orphan rooms.
  const childIds = new Set<string>()
  for (const r of rooms) {
    if (r.isSpaceRoom()) {
      for (const c of getChildIds(r)) childIds.add(c.id)
    }
  }

  // Recursively build a node for a room, descending into space children.
  // `seen` guards against cycles (a space that transitively contains itself).
  const buildNode = (room: Room, seen: Set<string>): TreeNode => {
    const isSpace = room.isSpaceRoom()
    const node: TreeNode = { room, isSpace, children: [] }
    if (isSpace && !seen.has(room.roomId)) {
      const nextSeen = new Set(seen).add(room.roomId)
      const kids: TreeNode[] = []
      for (const { id, order } of getChildIds(room)) {
        const childRoom = byId.get(id)
        if (!childRoom) continue // child not joined / not synced — skip
        const childNode = buildNode(childRoom, nextSeen)
        ;(childNode as any)._order = order
        kids.push(childNode)
      }
      node.children = sortChildren(kids)
    }
    return node
  }

  // Top-level spaces: space rooms not referenced as anyone's child.
  const spaces = rooms
    .filter((r) => r.isSpaceRoom() && !childIds.has(r.roomId))
    .map((r) => buildNode(r, new Set()))

  // Orphan rooms: non-space rooms not claimed by any space.
  const orphanRooms = rooms
    .filter((r) => !r.isSpaceRoom() && !childIds.has(r.roomId))
    .map((r) => ({ room: r, isSpace: false, children: [] }))

  return {
    spaces: sortChildren(spaces),
    orphanRooms: orphanRooms.sort((a, b) =>
      (a.room.name || '').localeCompare(b.room.name || ''),
    ),
  }
}
