import { useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from './client/ClientContext'
import { NavTree } from './ui/NavTree'

// Thin shell: render purely by client lifecycle status. All auth/client logic
// lives in ClientProvider; App reflects the current phase and, when ready,
// mounts the two-pane layout (nav tree + main area).
function App() {
  const { status, error, userId, login, logout } = useClient()
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

  if (status === 'starting') {
    return <Centered>Starting…</Centered>
  }

  if (status === 'awaiting_login') {
    return (
      <Centered>
        <h1>Technetium</h1>
        <button type="button" onClick={() => login()}>
          Log in with Matrix
        </button>
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
        <button type="button" onClick={() => login()}>
          Try again
        </button>
      </Centered>
    )
  }

  if (status === 'syncing') {
    return <Centered>Syncing…</Centered>
  }

  // status === 'ready' — two-pane layout: nav tree | main area.
  return (
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
          <button type="button" onClick={logout} style={{ fontSize: 12 }}>
            Log out
          </button>
        </div>
        <NavTree selectedRoomId={selectedRoom?.roomId} onSelectRoom={setSelectedRoom} />
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {selectedRoom ? (
          <>
            <h2>{selectedRoom.name || selectedRoom.roomId}</h2>
            <p style={{ opacity: 0.6 }}>
              Timeline goes here (a later phase). Room id: {selectedRoom.roomId}
            </p>
          </>
        ) : (
          <p style={{ opacity: 0.6 }}>Select a room from the left.</p>
        )}
      </main>
    </div>
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
