import type { MatrixClient, Room } from 'matrix-js-sdk'

// A node in the navigation tree. Unlike the prior version, a node may represent
// a room the user has NOT joined (a visible-but-unjoined subspace or room
// surfaced by getRoomHierarchy), so `room` can be null and identity/name/join
// state are carried explicitly rather than read off a live Room handle.
export interface TreeNode {
  roomId: string
  name: string
  isSpace: boolean
  // Sync membership overlaid on the hierarchy skeleton: 'join' | 'invite' |
  // 'knock' | 'leave', or null when the user has no membership (visible only).
  membership: string | null
  // Raw join_rule from the hierarchy entry ('restricted' | 'knock' | 'public'
  // | ...). The SDK types this narrowly (Knock | Public) but Synapse returns
  // the real value at runtime, so we widen to string for the render to decide
  // joinable (green) vs knock (pill).
  joinRule: string | null
  // The live Room, present only when joined/synced; null for unjoined entries.
  room: Room | null
  children: TreeNode[]
}

export interface NavTree {
  spaces: TreeNode[]
  orphanRooms: TreeNode[]
}

// Minimal structural shape of a getRoomHierarchy() room entry -- only the
// fields we read. Structural (rather than importing IHierarchyRoom) so we
// don't couple to whether that type is re-exported from the package root; the
// SDK's IHierarchyRoom[] is assignable to this.
export interface HierarchyRoom {
  room_id: string
  name?: string
  room_type?: string
  join_rule?: string
  children_state?: { state_key?: string; content?: { order?: string } }[]
}

// Ordered child ids of a hierarchy entry, from its children_state relations.
function hierarchyChildIds(h: HierarchyRoom): { id: string; order: string }[] {
  return (h.children_state ?? [])
    .map((e) => ({ id: e.state_key ?? '', order: e.content?.order ?? '' }))
    .filter((c) => c.id)
}

// Sort by the m.space.child `order` string (lexicographic), then room name.
function sortChildren(children: TreeNode[]): TreeNode[] {
  return [...children].sort((a, b) => {
    const oa = (a as any)._order ?? ''
    const ob = (b as any)._order ?? ''
    if (oa !== ob) return oa < ob ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })
}

// Build the nav tree from one-or-more getRoomHierarchy() responses (structure +
// names, including unjoined rooms) with live membership overlaid from sync.
// `rooms` is the concatenation of every queried top-level space's
// hierarchy.rooms.
export function buildNavTree(client: MatrixClient, rooms: HierarchyRoom[]): NavTree {
  // De-dupe by room_id (a room may appear under more than one parent).
  const byId = new Map<string, HierarchyRoom>()
  for (const h of rooms) if (h.room_id && !byId.has(h.room_id)) byId.set(h.room_id, h)

  // Every id referenced as some entry's child -> finds roots + orphans.
  const childIds = new Set<string>()
  for (const h of byId.values())
    for (const c of hierarchyChildIds(h)) childIds.add(c.id)

  const makeNode = (h: HierarchyRoom): TreeNode => {
    const room = client.getRoom(h.room_id) ?? null
    return {
      roomId: h.room_id,
      name: h.name || room?.name || h.room_id,
      isSpace: h.room_type === 'm.space',
      membership: room?.getMyMembership() ?? null,
      joinRule: h.join_rule ?? null,
      room,
      children: [],
    }
  }

  // `seen` guards against cycles (a space transitively containing itself).
  const buildNode = (h: HierarchyRoom, seen: Set<string>): TreeNode => {
    const node = makeNode(h)
    if (node.isSpace && !seen.has(h.room_id)) {
      const nextSeen = new Set(seen).add(h.room_id)
      const kids: TreeNode[] = []
      for (const { id, order } of hierarchyChildIds(h)) {
        const childH = byId.get(id)
        if (!childH) continue // child not returned by hierarchy (not visible)
        const childNode = buildNode(childH, nextSeen)
        ;(childNode as any)._order = order
        kids.push(childNode)
      }
      node.children = sortChildren(kids)
    }
    return node
  }

  // Roots: hierarchy entries that are spaces and aren't anyone's child.
  const spaces = [...byId.values()]
    .filter((h) => h.room_type === 'm.space' && !childIds.has(h.room_id))
    .map((h) => buildNode(h, new Set()))

  // Orphans: joined non-space rooms absent from every hierarchy (DMs,
  // directly-joined rooms). Surfaced from sync, not the hierarchy.
  const orphanRooms: TreeNode[] = client
    .getRooms()
    .filter((r) => !r.isSpaceRoom() && !byId.has(r.roomId))
    .map((r) => ({
      roomId: r.roomId,
      name: r.name || r.roomId,
      isSpace: false,
      membership: r.getMyMembership() ?? null,
      joinRule: null,
      room: r,
      children: [],
    }))

  // Top-level spaces from sync that the hierarchy did not surface. An INVITE is
  // actionable before you can see a space's contents, and a just-joined root may
  // not have its hierarchy fetched yet -- without this, a user invited to the
  // root space (membership 'invite', never in the joined-only hierarchy) sees an
  // empty tree. Skip ids already in the tree, or known to be a hierarchy child.
  const present = new Set<string>(byId.keys())
  const collect = (ns: TreeNode[]) =>
    ns.forEach((n) => {
      present.add(n.roomId)
      collect(n.children)
    })
  collect(spaces)
  for (const o of orphanRooms) present.add(o.roomId)

  const syncSpaces: TreeNode[] = client
    .getRooms()
    .filter(
      (r) =>
        r.isSpaceRoom() &&
        (r.getMyMembership() === 'invite' || r.getMyMembership() === 'join') &&
        !present.has(r.roomId) &&
        !childIds.has(r.roomId),
    )
    .map((r) => ({
      roomId: r.roomId,
      name: r.name || r.roomId,
      isSpace: true,
      membership: r.getMyMembership() ?? null,
      joinRule: null,
      room: r,
      children: [],
    }))

  return {
    spaces: sortChildren([...spaces, ...syncSpaces]),
    orphanRooms: orphanRooms.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  }
}
