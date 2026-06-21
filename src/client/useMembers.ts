import { useEffect, useRef, useState, useMemo } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import {
  createMatrixSpaceSource,
  type MemberSource,
  type MergedMember,
} from './members'

// Merge members from all sources by canonical identity. When two sources
// describe the same person, their `sources` and `powerByRoom` combine into one
// record — the seam the future Discord source slots into.
function mergeSources(sources: MemberSource[]): MergedMember[] {
  const byId = new Map<string, MergedMember>()
  for (const src of sources) {
    for (const m of src.getMembers()) {
      const existing = byId.get(m.id)
      if (!existing) {
        byId.set(m.id, { ...m, sources: [...m.sources] })
      } else {
        existing.sources = [...new Set([...existing.sources, ...m.sources])]
        existing.powerByRoom = { ...existing.powerByRoom, ...m.powerByRoom }
        if (!existing.avatarMxc && m.avatarMxc) existing.avatarMxc = m.avatarMxc
      }
    }
  }
  return [...byId.values()]
}

// Live merged member list. For now the only source is the Matrix space source,
// but the hook takes a source array so others register without code changes here.
export function useMembers(client: MatrixClient | null) {
  // Build the default (Matrix) source for this client. Memoized so it isn't
  // recreated each render. Future: accept extra sources as an argument.
  const sources = useMemo<MemberSource[]>(
    () => (client ? [createMatrixSpaceSource(client)] : []),
    [client],
  )

  const [members, setMembers] = useState<MergedMember[]>(() => mergeSources(sources))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setMembers(mergeSources(sources))

    const refresh = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        setMembers(mergeSources(sources))
      }, 250)
    }

    const unsubs = sources.map((s) => s.subscribe(refresh))
    return () => {
      if (timer.current) clearTimeout(timer.current)
      unsubs.forEach((u) => u())
    }
  }, [sources])

  return members
}
