import { useClient } from './client/ClientContext'

// Thin shell: render purely by client lifecycle status. All auth/client logic
// lives in ClientProvider; App just reflects the current phase and (later)
// mounts the real UI when ready.
function App() {
  const { status, error, userId, login, logout, client } = useClient()

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

  // status === 'ready'
  const rooms = client?.getRooms() ?? []
  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Technetium</h1>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </div>
      <p>
        Logged in as <strong>{userId}</strong>
      </p>
      <h2>Rooms ({rooms.length})</h2>
      <ul>
        {rooms.map((r) => (
          <li key={r.roomId}>{r.name || r.roomId}</li>
        ))}
      </ul>
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
