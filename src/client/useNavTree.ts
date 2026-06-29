import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClientEvent,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk'
import { buildNavTree, type HierarchyRoom, type NavTree } from './spaces'

export interface NavTreeState {
  tree: NavTree | null
  loading: boolean
}

// Top-level spaces the user is joined to: joined space rooms not referenced as
// a child of any other joined space. Read from sync (not the hierarchy) to
// avoid a chicken-and-egg on what to query.
function discoverRootSpaces(client: MatrixClient): string[] {
  const joinedSpaces = client
    .getRooms()
    .filter((r) => r.isSpaceRoom() && r.getMyMembership() === 'join')
  const childIds = new Set<string>()
  for (const s of joinedSpaces)
    for (const e of s.currentState.getStateEvents('m.space.child'))
      if (Object.keys(e.getContent()).length > 0) {
        const k = e.getStateKey()
        if (k) childIds.add(k)
      }
  return joinedSpaces.map((s) => s.roomId).filter((id) => !childIds.has(id))
}

// Fetch one space's full hierarchy, following next_batch to completion.
async function fetchSpaceHierarchy(
  client: MatrixClient,
  spaceId: string,
  isCancelled: () => boolean,
): Promise<HierarchyRoom[]> {
  const out: HierarchyRoom[] = []
  let from: string | undefined = undefined
  let guard = 0
  do {
    const res = await client.getRoomHierarchy(spaceId, 50, undefined, false, from)
    out.push(...(res.rooms as HierarchyRoom[]))
    from = res.next_batch
    guard += 1
  } while (from && !isCancelled() && guard < 20)
  return out
}

// Hybrid nav tree: structure + names from getRoomHierarchy (includes unjoined
// rooms), live membership overlaid from sync. Returns a loading flag; never
// blanks the tree mid-fetch (keep-previous).
export function useNavTree(client: MatrixClient | null): NavTreeState {
  const [tree, setTree] = useState<NavTree | null>(null)
  const [loading, setLoading] = useState<boolean>(!!client)
  const cacheRef = useRef<HierarchyRoom[]>([])
  const fetchSeq = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cheap: re-overlay membership/names on the cached skeleton (no network).
  const rebuildFromCache = useCallback(() => {
    if (!client) return
    setTree(buildNavTree(client, cacheRef.current))
  }, [client])

  // Expensive: re-discover roots and re-fetch every hierarchy, then rebuild.
  const refetch = useCallback(async () => {
    if (!client) return
    const seq = ++fetchSeq.current
    setLoading(true)
    try {
      const roots = discoverRootSpaces(client)
      const all: HierarchyRoom[] = []
      for (const rootId of roots) {
        const rooms = await fetchSpaceHierarchy(
          client,
          rootId,
          () => seq !== fetchSeq.current,
        )
        if (seq !== fetchSeq.current) return // superseded
        all.push(...rooms)
      }
      if (seq !== fetchSeq.current) return
      cacheRef.current = all
      setTree(buildNavTree(client, all))
    } catch (err) {
      console.error('useNavTree: hierarchy fetch failed', err)
      // leave the previous tree in place
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    if (!client) {
      setTree(null)
      setLoading(false)
      cacheRef.current = []
      return
    }

    void refetch() // initial load

    const scheduleRefetch = () => {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => {
        debounce.current = null
        void refetch()
      }, 300)
    }

    // Membership change: instant overlay from cache (snappy join feedback) plus
    // a debounced refetch in case a newly-joined space revealed children.
    const onMembership = () => {
      rebuildFromCache()
      scheduleRefetch()
    }
    // Only m.space.child state changes alter structure -> refetch. Other state
    // events must NOT trigger a network refetch.
    const onState = (event: MatrixEvent) => {
      if (event.getType() === 'm.space.child') scheduleRefetch()
    }

    client.on(RoomEvent.MyMembership, onMembership)
    client.on(RoomEvent.Name, rebuildFromCache)
    client.on(ClientEvent.Room, scheduleRefetch)
    client.on(ClientEvent.DeleteRoom, scheduleRefetch)
    client.on(RoomStateEvent.Events, onState)

    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      fetchSeq.current++ // cancel any in-flight fetch
      client.off(RoomEvent.MyMembership, onMembership)
      client.off(RoomEvent.Name, rebuildFromCache)
      client.off(ClientEvent.Room, scheduleRefetch)
      client.off(ClientEvent.DeleteRoom, scheduleRefetch)
      client.off(RoomStateEvent.Events, onState)
    }
  }, [client, refetch, rebuildFromCache])

  return { tree, loading }
}
