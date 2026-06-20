import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import * as sdk from 'matrix-js-sdk'
import type { MatrixClient } from 'matrix-js-sdk'
import { saveSession, loadSession, clearSession } from './session'
import { buildClient, startAndWaitForSync } from './buildClient'
import { createTokenRefreshFunction } from './tokenRefresher'

// MAS redirect target + statically-registered public client id (see mas/config.yaml
// on the remote server). REDIRECT_URI must match the browser's origin and the
// redirect_uri registered for this client in MAS.
const REDIRECT_URI = window.location.origin + '/'
const CLIENT_ID = '00000000000000000000DEVWEB'
const DEFAULT_HOMESERVER = 'https://41chan.net'

// Lifecycle of the client, so the UI can render the right thing per phase.
export type ClientStatus =
  | 'starting' // bootstrap in progress (deciding which path)
  | 'awaiting_login' // no session — show the login UI
  | 'syncing' // client built, initial sync running
  | 'ready' // synced and usable
  | 'error'

interface ClientContextValue {
  client: MatrixClient | null
  status: ClientStatus
  error: string | null
  userId: string | null
  login: (homeserver?: string) => Promise<void>
  logout: () => void
}

const ClientContext = createContext<ClientContextValue | null>(null)

// Hook every component uses to reach the live client + lifecycle state.
export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext)
  if (!ctx) throw new Error('useClient must be used within <ClientProvider>')
  return ctx
}

// Module-level guard: React StrictMode double-invokes effects in dev, and both
// the OIDC code exchange (single-use code) and resume (avoid two clients) must
// run at most once. Survives a StrictMode remount where component state would not.
let bootstrapStarted = false

export function ClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null)
  const [status, setStatus] = useState<ClientStatus>('starting')
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Bootstrap on mount: finish an in-progress login, resume a stored session,
  // or fall through to awaiting_login.
  useEffect(() => {
    if (bootstrapStarted) return
    bootstrapStarted = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (code && state) {
      void completeLogin(code, state)
    } else if (loadSession()) {
      void resumeSession()
    } else {
      setStatus('awaiting_login')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shared: build the persistent-store client, sync, and publish it to context.
  const startSyncedClient = async (params: {
    homeserverUrl: string
    accessToken: string
    userId: string
    deviceId?: string
    refreshToken?: string
    tokenRefreshFunction?: sdk.TokenRefreshFunction
  }) => {
    setStatus('syncing')
    const c = await buildClient(params)
    setClient(c)
    await startAndWaitForSync(c)
    setStatus('ready')
  }

  // Path 1: exchange the MAS authorization code, persist the session, sync.
  const completeLogin = async (code: string, state: string) => {
    try {
      const result = await sdk.completeAuthorizationCodeGrant(code, state)
      const accessToken = result.tokenResponse.access_token
      const homeserverUrl = result.homeserverUrl

      // Clear ?code&state so a refresh doesn't re-run the (now spent) exchange.
      window.history.replaceState({}, '', REDIRECT_URI)

      const whoamiClient = sdk.createClient({ baseUrl: homeserverUrl, accessToken })
      const whoami = await whoamiClient.whoami()
      const myUserId = whoami.user_id
      const myDeviceId = whoami.device_id ?? ''

      const oidc = {
        issuer: result.oidcClientSettings.issuer,
        clientId: result.oidcClientSettings.clientId,
        redirectUri: REDIRECT_URI,
        idTokenClaims: result.idTokenClaims,
      }
      saveSession({
        homeserverUrl,
        accessToken,
        refreshToken: result.tokenResponse.refresh_token,
        userId: myUserId,
        deviceId: myDeviceId,
        oidc,
      })

      setUserId(myUserId)
      await startSyncedClient({
        homeserverUrl,
        accessToken,
        userId: myUserId,
        deviceId: myDeviceId || undefined,
        refreshToken: result.tokenResponse.refresh_token,
        tokenRefreshFunction: createTokenRefreshFunction({
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          redirectUri: oidc.redirectUri,
          deviceId: myDeviceId,
          idTokenClaims: oidc.idTokenClaims,
        }),
      })
    } catch (err: any) {
      console.error('Login failed:', err)
      setError(err.message ?? String(err))
      setStatus('error')
    }
  }

  // Path 2: rebuild the client from the stored session — no MAS visit.
  const resumeSession = async () => {
    const s = loadSession()
    if (!s) {
      setStatus('awaiting_login')
      return
    }
    try {
      setUserId(s.userId)
      await startSyncedClient({
        homeserverUrl: s.homeserverUrl,
        accessToken: s.accessToken,
        userId: s.userId,
        deviceId: s.deviceId || undefined,
        refreshToken: s.refreshToken,
        tokenRefreshFunction: createTokenRefreshFunction({
          issuer: s.oidc.issuer,
          clientId: s.oidc.clientId,
          redirectUri: s.oidc.redirectUri,
          deviceId: s.deviceId,
          idTokenClaims: s.oidc.idTokenClaims,
        }),
      })
    } catch (err: any) {
      console.error('Resume failed:', err)
      // Refresh also failed (refresh token dead) -> session is truly gone.
      clearSession()
      setUserId(null)
      setStatus('awaiting_login')
    }
  }

  // Begin a fresh login: discover homeserver, build the MAS auth URL, redirect.
  const login = async (homeserver: string = DEFAULT_HOMESERVER) => {
    try {
      const discovery = await sdk.AutoDiscovery.findClientConfig(homeserver)
      const hsResult = discovery['m.homeserver']
      if (hsResult.state !== 'SUCCESS') {
        throw new Error(`Discovery failed: ${hsResult.state} ${hsResult.error ?? ''}`)
      }
      const baseUrl = hsResult.base_url
      if (!baseUrl) throw new Error('Discovery returned no base URL')

      const tmpClient = sdk.createClient({ baseUrl })
      const authMetadata = await tmpClient.getAuthMetadata()

      const nonce = crypto.randomUUID().replace(/-/g, '')
      const authUrl = await sdk.generateOidcAuthorizationUrl({
        metadata: authMetadata,
        redirectUri: REDIRECT_URI,
        clientId: CLIENT_ID,
        homeserverUrl: baseUrl,
        nonce,
      })
      window.location.href = authUrl
    } catch (err: any) {
      console.error('Login start failed:', err)
      setError(err.message ?? String(err))
      setStatus('error')
    }
  }

  // Stop syncing, drop the session, return to the login screen.
  const logout = () => {
    client?.stopClient()
    clearSession()
    setClient(null)
    setUserId(null)
    setStatus('awaiting_login')
  }

  const value: ClientContextValue = {
    client,
    status,
    error,
    userId,
    login,
    logout,
  }

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
}
