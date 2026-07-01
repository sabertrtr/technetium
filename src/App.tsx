import { useRef, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from './client/ClientContext'
import { NavTree } from './ui/NavTree'
import { Timeline } from './ui/Timeline'
import { Composer } from './ui/Composer'
import { MemberList } from './ui/MemberList'
import { ThreadPanel } from './ui/ThreadPanel'
import { ThreadList } from './ui/ThreadList'
import { LightboxProvider } from './ui/Lightbox'

// Thin shell: render purely by client lifecycle status. All auth/client logic
// lives in ClientProvider; App reflects the current phase and, when ready,
// mounts the three-pane layout (nav tree | timeline+composer | member list).
function App() {
  const { status, error, userId, login, logout } = useClient()
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [openThread, setOpenThread] = useState<{ roomId: string; rootId: string } | null>(null)
  const [threadListOpen, setThreadListOpen] = useState(false)
  const [threadListWidth, setThreadListWidth] = useState(190)
  const [threadPanelWidth, setThreadPanelWidth] = useState(380)

  if (status === 'starting') return <Centered>Starting{'\u2026'}</Centered>

  if (status === 'awaiting_login') {
    return (
      <Centered>
        <h1>Technetium</h1>
        <button type="button" onClick={() => login()}>Log in with Matrix</button>
      </Centered>
    )
  }

  if (status === 'error') {
    return (
      <Centered>
        <h1>Technetium</h1>
        <p style={{ color: 'var(--cpd-color-text-critical-primary, #d22)' }}>
          {error ?? 'Something went wrong.'}
        </p>
        <button type="button" onClick={() => login()}>Try again</button>
      </Centered>
    )
  }

  if (status === 'syncing') return <Centered>Syncing{'\u2026'}</Centered>

  // status === 'ready' -- three-pane layout.
  return (
    <LightboxProvider>
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: '1px solid rgba(128,128,128,0.25)',
          overflowY: 'auto',
          padding: '8px 4px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 8px 8px',
          }}
        >
          <strong>{userId}</strong>
          <button type="button" onClick={logout} style={{ fontSize: 12 }}>Log out</button>
        </div>
        <NavTree selectedRoomId={selectedRoom?.roomId} onSelectRoom={setSelectedRoom} />
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selectedRoom ? (
          <>
            <header
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid rgba(128,128,128,0.25)',
                fontWeight: 600,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{selectedRoom.name || selectedRoom.roomId}</span>
              <button
                type="button"
                onClick={() => setThreadListOpen((o) => !o)}
                style={{ fontSize: 12, fontWeight: 400 }}
              >
                {threadListOpen ? 'Threads \u2715' : '\u2630 Threads'}
              </button>
            </header>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Timeline room={selectedRoom} onOpenThread={(roomId, rootId) => setOpenThread({ roomId, rootId })} />
            </div>
            <Composer room={selectedRoom} />
          </>
        ) : (
          <div style={{ padding: 24, opacity: 0.6 }}>Select a room from the left.</div>
        )}
      </main>

      {threadListOpen && (
          <ResizeHandle onDrag={(dx) => setThreadListWidth((w) => Math.max(140, Math.min(420, w - dx)))} />
        )}
        {threadListOpen && (
        <ThreadList
          onSelect={(roomId, rootId) => setOpenThread({ roomId, rootId })}
          activeRootId={openThread?.rootId}
            width={threadListWidth}
        />
      )}

      {openThread && (
          <ResizeHandle onDrag={(dx) => setThreadPanelWidth((w) => Math.max(280, Math.min(640, w - dx)))} />
        )}
        {openThread && (
        <ThreadPanel
          roomId={openThread.roomId}
          rootId={openThread.rootId}
          onClose={() => setOpenThread(null)}
            width={threadPanelWidth}
        />
      )}

      <MemberList room={selectedRoom} />
    </div>
    </LightboxProvider>
  )
}

function ResizeHandle({ onDrag }: { onDrag: (dx: number) => void }) {
  const startX = useRef(0)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    startX.current = e.clientX
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const dx = e.clientX - startX.current
    startX.current = e.clientX
    if (dx !== 0) onDrag(dx)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'transparent', alignSelf: 'stretch' }}
      title="Drag to resize"
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 360,
        margin: '4rem auto',
        fontFamily: 'sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        alignItems: 'flex-start',
      }}
    >
      {children}
    </div>
  )
}

export default App
