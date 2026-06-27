import * as sdk from 'matrix-js-sdk'
import type { MatrixClient, TokenRefreshFunction } from 'matrix-js-sdk'
import { Thread, FeatureSupport } from 'matrix-js-sdk'

export interface BuildClientParams {
  homeserverUrl: string
  accessToken: string
  userId: string
  deviceId?: string
  refreshToken?: string
  // When provided, the SDK calls this on token expiry to silently refresh.
  tokenRefreshFunction?: TokenRefreshFunction
}

// Centralized client construction. Both fresh-login and resume go through here,
// so the persistent-store wiring lives in exactly one place.
//
// Uses IndexedDBStore so sync state survives reloads: the store keeps data
// in-memory but periodically flushes to IndexedDB, and startup() reloads it on
// next launch — so a refresh resumes from the saved sync token instead of doing
// a full initial sync. (This is also where crypto key storage will hang later.)
export async function buildClient(params: BuildClientParams): Promise<MatrixClient> {
  const store = new sdk.IndexedDBStore({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    dbName: 'matrix-client-sync',
  })

  const client = sdk.createClient({
    baseUrl: params.homeserverUrl,
    accessToken: params.accessToken,
    userId: params.userId,
    deviceId: params.deviceId,
    refreshToken: params.refreshToken,
    tokenRefreshFunction: params.tokenRefreshFunction,
    store,
  })

  // Must be called after createClient and before startClient: loads any
  // previously-persisted sync state from IndexedDB into the store.
  // Synapse supports stable threads server-side; opt into the efficient
  // server-side thread list/pagination endpoints.
  Thread.setServerSideSupport(FeatureSupport.Stable)
  Thread.setServerSideListSupport(FeatureSupport.Stable)
  Thread.setServerSideFwdPaginationSupport(FeatureSupport.Stable)

  await store.startup()

  return client
}

// Drive a client to its first PREPARED sync and resolve. Caller decides what to
// do with the rooms afterward. Rejects on sync ERROR.
export function startAndWaitForSync(client: MatrixClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once(sdk.ClientEvent.Sync, (s: string) => {
      if (s === 'PREPARED') resolve()
      else if (s === 'ERROR') reject(new Error('Sync failed'))
    })
    // threadSupport is a startClient option (read from clientOpts), NOT a
    // createClient option — pass it here so the SDK routes m.thread
    // replies into Thread timelines instead of the main timeline.
    client.startClient({ initialSyncLimit: 1, threadSupport: true })
  })
}
