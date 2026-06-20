# matrix-client — Dev Log 01

**Project:** 41chan / custom Matrix client
**Location:** `/home/saber/matrix-client` (vesper, user `saber`)
**Stack:** Vite + React 19 + TypeScript + matrix-js-sdk 41.6.0
**Dev server:** `http://127.0.0.1:5173/` (bound to 127.0.0.1 to match MAS redirect URI)
**Editor:** VS Code Remote SSH into vesper

---

## Foundation (done before Phase 1)

OIDC-native login working end to end against MAS:
- `.well-known` delegation discovery → `getAuthMetadata()` → static public client
  `00000000000000000000DEVWEB` (registered in `/opt/synapse/mas/config.yaml` on the
  remote server; backup at `/root/mas-config.yaml.bak-2026-06-17-0300`).
- PKCE authorization-code flow → redirect to MAS → `completeAuthorizationCodeGrant`
  → access token → `whoami` → one-shot sync → room list.
- Gotchas resolved: delegation 404 (password grant gone under MSC3861), dynamic
  registration rejected by MAS policy (http/loopback) → static client instead,
  `web` vs `native` application_type, `$userId` filter bug (pass `userId` to
  `createClient`), React StrictMode double-exchange (module-level guard),
  127.0.0.1 vs localhost redirect mismatch, dev server must be running on return.

State at Phase 1 start: single `App.tsx`, one-shot sync, in-memory only — a
refresh logs the user out.

---

## Phase 1 — The spine (IN PROGRESS)

Goal: turn the one-shot login into a persistent, IndexedDB-backed,
continuously-syncing session that survives a page refresh.

Verified SDK surfaces (41.6.0):
- `IndexedDBStore` (top-level export) — opts `{ indexedDB, localStorage, dbName }`.
- `createClient` opts — `store`, `deviceId`, `refreshToken`, `tokenRefreshFunction`.
- `OidcTokenRefresher(issuer, clientId, redirectUri, deviceId, idTokenClaims)`
  with overridable `persistTokens` — for token-expiry refresh.

Steps:
- [x] Step 1 — session store module; save credentials on login (additive, no behavior change).
- [x] Step 2 — single `buildClient` path with IndexedDBStore.
- [x] Step 3 — resume on load (rebuild from stored session, skip MAS, continuous sync).
- [x] Step 4 — token refresh via OidcTokenRefresher.

### Step 1 — session persistence module
(status: in progress)

`src/client/session.ts` — `StoredSession` interface + `saveSession`/`loadSession`/
`clearSession` over one localStorage key (`matrix-client:session`). `App.tsx`
callback now calls `saveSession` right after `whoami`, capturing homeserverUrl,
access + refresh tokens, userId, deviceId, and the OIDC block (issuer, clientId,
redirectUri, idTokenClaims).

Verified: after login, `matrix-client:session` present in localStorage with all
fields including a refresh_token from MAS and the idTokenClaims needed by the
Step 4 refresher. No behavior change yet (this step is purely additive).

### Step 2 — single buildClient path with IndexedDBStore
(status: done)

`src/client/buildClient.ts` — `buildClient(params)` constructs an `IndexedDBStore`
(`dbName: matrix-client-sync`, `window.indexedDB` + `window.localStorage`), passes it
to `createClient`, then `await store.startup()` (required after createClient, before
startClient). Also `startAndWaitForSync(client)` (start + resolve on PREPARED). `App.tsx`
sync path now routes through these; the two remaining `sdk.createClient` calls are the
whoami probe and the auth-metadata discovery client (both correct to keep).

Verified: login + room list unchanged; IndexedDB `matrix-js-sdk:matrix-client-sync`
(7 object stores) present at origin http://127.0.0.1:5173. Sync state now persists to
disk (not yet consumed on reload — that is Step 3).

### Step 3 — resume on load
(status: done)

`App.tsx` bootstrap `useEffect` now branches three ways: (1) `?code` + `?state` ->
`completeLogin` (exchange code, persist, sync); (2) stored session present ->
`resumeSession` (rebuild from localStorage, no MAS visit); (3) neither -> login form.
Shared `startSyncedClient` builds the store-backed client and populates rooms. The
StrictMode guard was renamed `bootstrapStarted` and moved to cover BOTH async paths.
Stale-token handling: `resumeSession` catch -> `clearSession()` + "please log in again"
(placeholder until Step 4 adds real refresh).

Verified: fresh login -> refresh (F5) stays logged in via the resume path (no MAS
redirect), and noticeably faster than first login (resumes from saved sync token in
IndexedDB rather than full initial sync). `localStorage.clear()` + refresh -> back to
login form. Persistence milestone reached.

### Step 4 — token refresh via OidcTokenRefresher
(status: done)

`src/client/tokenRefresher.ts` — `PersistingOidcTokenRefresher` subclasses the SDK's
`OidcTokenRefresher` and overrides `persistTokens` to write refreshed tokens back into
the stored session (so the NEXT reload also resumes valid). `createTokenRefreshFunction()`
builds it from the OIDC params and returns a `TokenRefreshFunction`
(`refreshToken => doRefreshAccessToken`). `buildClient` threads `tokenRefreshFunction`
into `createClient`; both `completeLogin` and `resumeSession` construct and pass it.

SDK contract (41.6.0): `TokenRefreshFunction = (refreshToken) => Promise<AccessTokens>`,
`AccessTokens = { accessToken, refreshToken?, expiry? }`. SDK calls the function on a 401
from an expired access token; MAS issues fresh tokens; persistTokens saves them.

Resume catch tightened: now only clears the session when refresh ALSO fails (refresh
token expired/revoked) rather than on any stale access token.

Verification: regression check (fresh login + refresh still works) done immediately.
Actual silent-refresh fires only on real token expiry — confirmed by leaving the tab
open past token lifetime and seeing "Token refreshed and session updated" with no
logout. (Deferred to natural occurrence; not forced in a quick test.)

---

## Phase 1 COMPLETE

The spine: persistent, IndexedDB-backed, resuming, self-refreshing sessions. A reload
keeps the user logged in; an expired access token refreshes silently. Foundation ready
for Phase 2 (unified spaces>subspaces>rooms left nav).

Files added: `src/client/session.ts`, `src/client/buildClient.ts`,
`src/client/tokenRefresher.ts`. `App.tsx` restructured into a three-path bootstrap.

Next (Phase 2): install Compound (`-im/compound-web` + design-tokens +
fonts), then build the unified left-nav tree. Confirmed React 19.2.6 satisfies Compound's
peer range. Also pending: move from one-shot sync to a living client surfaced via context
+ live event listeners (currently the client is built and synced but not retained in app
state beyond the room-name snapshot).

---

## Phase 2 — Discord-shaped UI (IN PROGRESS)

Goal: unified, compact spaces>subspaces>rooms left nav, always-open member list,
inverted thread/channel layout, relocated typing indicators. First: Compound
foundation + living-client context, then the nav tree.

Dev-server note: Vite now runs in a persistent `tmux` session on vesper
(`tmux new-session -d -s vite '...npm run dev -- --host 127.0.0.1'`), so it
survives SSH/VS Code disconnects. Trade-off: VS Code no longer auto-forwards
5173 — forward it manually via the PORTS tab (one-time, persists per workspace).
Attach: `tmux attach -t vite`; detach: Ctrl+b then d.

### Step 2.1 — Compound foundation wired
(status: done)

Installed `@vector-im/compound-web@9.4.1`, `@vector-im/compound-design-tokens@10.2.2`,
`@fontsource/inter@5`, `@fontsource/inconsolata@5`. `main.tsx` imports (once, before
render): the all-in-one tokens CSS
(`@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css` —
pulls in light/dark/HC themes + prefers-color-scheme switching), Inter weights
400/500/600/700, and Inconsolata 400.

Verified: page renders clean, no import errors;
`--cpd-color-bg-canvas-default` resolves to `#101317` (dark-theme canvas) — tokens live.

### Step 2.2 — living client in React context
(status: in progress)

2.2a (done): `src/client/ClientContext.tsx` — `ClientProvider` owns the full client
lifecycle (status: starting -> awaiting_login -> syncing -> ready | error), holds the
MatrixClient in state, and exposes it via the `useClient()` hook. All auth logic
(completeLogin/resumeSession/login/logout) moved here from App.tsx. Not yet wired
(nothing imports it) — App.tsx refactor is 2.2b.

2.2b (done): `main.tsx` wraps `<App/>` in `<ClientProvider>`; `App.tsx` gutted to a
thin status-driven shell (render by ClientStatus: starting/awaiting_login/syncing/
ready/error), consuming `useClient()`. All auth logic removed from App. Added a logout
button (provider exposes `logout`). Login screen simplified — no homeserver field
(provider defaults to https://41chan.net); can re-add multi-homeserver later.

Verified: resume (reload -> room list), logout (-> login screen), and fresh login
(-> MAS -> room list) all work through the provider. Living client now in context;
App ~230 lines -> ~80. Foundation ready for the nav tree.

Step 2.2 COMPLETE.

**FOURIER EXTRACTION FLAG:** the auth primitives — `session.ts`, `tokenRefresher.ts`,
and the login/discovery/exchange logic — together form a complete "authenticate a
browser app against MAS + hold a Matrix-capable session + silent refresh" library,
with zero Technetium-specific logic. This is the client-side counterpart to the planned
**fourier-passport** ("unified MAS-backed identity"). Every future Fourier web frontend
(booru login, tooling) needs the same capability. DECISION: keep building it inside
Technetium for now (prove it in one consumer first), but keep these modules free of
client-specific deps so a later lift into a `fourier-passport-web` package is a move,
not a rewrite. `ClientContext.tsx` itself stays in the client (React glue); the
primitives beneath it are the reusable surface.

### Step 2.3 — unified nav tree (spaces > subspaces > rooms)
(status: next)
The "image-2 target": one compact left panel showing the full hierarchy. First
real Compound-based UI. Will read the space hierarchy from the live client
(m.space.child state) and subscribe to room-list events for live updates.
