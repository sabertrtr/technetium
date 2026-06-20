import { useEffect, useRef, useState } from 'react'
import {
  ClientEvent,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
} from 'matrix-js-sdk'
import { buildNavTree, type NavTree } from './spaces'

// Builds the nav tree and keeps it live: rebuilds when rooms appear/disappear,
// are renamed, change membership, or when space child-state changes. Rebuilds
// are debounced so bursts of events (e.g. during sync) coalesce into one.
export function useNavTree(client: MatrixClient | null): NavTree | null {
  const [tree, setTree] = useState<NavTree | null>(() =>
    client ? buildNavTree(client) : null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!client) {
      setTree(null)
      return
    }

    // Build immediately for this client, then keep it current via events.
    setTree(buildNavTree(client))

    const scheduleRebuild = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        setTree(buildNavTree(client))
      }, 200)
    }

    // Room list churn + per-room name/membership changes.
    client.on(ClientEvent.Room, scheduleRebuild)
    client.on(ClientEvent.DeleteRoom, scheduleRebuild)
    client.on(RoomEvent.Name, scheduleRebuild)
    client.on(RoomEvent.MyMembership, scheduleRebuild)
    // State events — covers m.space.child (the hierarchy itself changing).
    client.on(RoomStateEvent.Events, scheduleRebuild)

    return () => {
      if (timer.current) clearTimeout(timer.current)
      client.off(ClientEvent.Room, scheduleRebuild)
      client.off(ClientEvent.DeleteRoom, scheduleRebuild)
      client.off(RoomEvent.Name, scheduleRebuild)
      client.off(RoomEvent.MyMembership, scheduleRebuild)
      client.off(RoomStateEvent.Events, scheduleRebuild)
    }
  }, [client])

  return tree
}
