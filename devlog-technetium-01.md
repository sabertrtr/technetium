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

**fourier-signature note (2026-06-20):** fourier-signature is the renamed fourier-passport — the identity-assertion layer of the Fourier suite, distinct from fourier-auth (the runtime broker / media gate). Spectral signature (identifies a signal) + cryptographic signature (asserts identity). Technetium's browser-side auth primitives are an identity-assertion concern, so fourier-signature is their natural extraction home.

**FOURIER EXTRACTION FLAG:** the auth primitives — `session.ts`, `tokenRefresher.ts`,
and the login/discovery/exchange logic — together form a complete "authenticate a
browser app against MAS + hold a Matrix-capable session + silent refresh" library,
with zero Technetium-specific logic. This is the client-side counterpart to the planned
**fourier-signature** ("unified MAS-backed identity"). Every future Fourier web frontend
(booru login, tooling) needs the same capability. DECISION: keep building it inside
Technetium for now (prove it in one consumer first), but keep these modules free of
client-specific deps so a later lift into a `fourier-signature-web` package is a move,
not a rewrite. `ClientContext.tsx` itself stays in the client (React glue); the
primitives beneath it are the reusable surface.

### Step 2.3 — unified nav tree (spaces > subspaces > rooms)
(status: in progress)
The "image-2 target": one compact left panel showing the full hierarchy.

2.3a (done): `src/client/spaces.ts` — `buildNavTree(client)` returns
`{ spaces, orphanRooms }`. Reads joined rooms + `m.space.child` state; identifies
top-level spaces (not parented by another space), recurses into subspaces/rooms,
sorts by the `order` field (stable manual ordering — fixes Element auto-shuffle),
guards cycles, skips removed/unsynced children. Verified against live hierarchy:
41chan -> 5 subspaces (chrestai/degenerative/generative/get help/technetai),
CUTE AND FUNNY top-level, DMs as orphanRooms. TEMP `window.mxClient` added to App.tsx
for console verification (remove after 2.3b).

2.3b (done): `src/ui/NavTree.tsx` — recursive `TreeRow` renders the full hierarchy
with depth indentation; spaces marked bold with a marker, rooms clickable via an
`onSelectRoom` callback; orphans under a "Direct & other" heading. `App.tsx` ready
view restructured into a two-pane layout (260px nav sidebar | main area), with a
`selectedRoom` state and a timeline placeholder on the right. TEMP `window.mxClient`
debug line removed. Verified: full nesting renders (rooms under subspaces under
41chan), room click selects + shows name on the right. (Noted in passing: a `/sync`
401 fired mid-session and was silently recovered by the token refresher — confirms
refresh works on an active session, not just at startup.)

2.3c (done): `NavTree.tsx` rewritten — collapsible (per-session `Set` of collapsed
space ids, default expanded, marker flips ▾/▸), compact (24px rows, fontSize 13),
and styled with Compound tokens (text-primary/secondary, bg-subtle-secondary hover,
bg-action-primary-rest selection). `App.tsx` passes `selectedRoomId` for highlight.
Verified on live data: full 41chan hierarchy + CUTE AND FUNNY + DIRECT & OTHER render
compact and themed; collapse/expand works; room selection highlights. (Polish notes
for later: selection color a bit loud; could use a subtler selected-state token.)

2.3d (done): `src/client/useNavTree.ts` — hook that builds the tree and rebuilds it
on `ClientEvent.Room`, `ClientEvent.DeleteRoom`, `RoomEvent.Name`,
`RoomEvent.MyMembership`, and `RoomStateEvent.Events` (covers m.space.child). Rebuilds
are debounced 200ms so event bursts coalesce; listeners + timer cleaned up on unmount.
`NavTree.tsx` swapped from one-shot `useMemo(buildNavTree)` to `useNavTree(client)`.
Verified passive: tree renders + collapse/select unchanged, no console errors. Active
(update-from-another-client) deferred to natural occurrence.

**Step 2.3 COMPLETE** — unified spaces>subspaces>rooms nav tree: live, collapsible,
compact, themed. The "image-2 target" is real. New files: `src/client/spaces.ts`,
`src/client/useNavTree.ts`, `src/ui/NavTree.tsx`.

### Step 2.4 — read-only timeline
(status: in progress)

2.4a (done): `src/client/useTimeline.ts` — `useTimeline(client, room)` returns
`{ items, loadOlder, loadingOlder, atStart }`. Reads `room.getLiveTimeline().getEvents()`,
classifies each (message/encrypted/redacted/other), subscribes to `RoomEvent.Timeline`
for live appends, and `loadOlder()` calls `client.scrollback(room, 30)` (detects
start-of-room when no new events return). Returns raw MatrixEvents + kind; renderer owns
presentation.

2.4b (done): `src/ui/Timeline.tsx` — renders rows (time / sender / body) by kind:
message = PLAINTEXT body only (no HTML yet), encrypted = "🔒" placeholder (crypto is a
later phase), redacted = "(message deleted)", other = "[type]". Scrollback button +
auto-scroll-to-newest. `App.tsx` main pane mounts `<Timeline room={selectedRoom}>` with
a room-name header, replacing the placeholder. Verified: clicking rooms shows messages;
encrypted rooms show the lock placeholder (no breakage); scrollback loads older.
Confirmed NO HTML rendering (no formatted_body/innerHTML) — that is 2.4c with dompurify.

2.4c (done): installed `dompurify.4.11`. `src/client/messageBody.ts` —
`renderMessageBody(event)` sanitizes `formatted_body` (org.matrix.custom.html) via
DOMPurify with a STRICT allowlist (formatting/link/code/list/table tags only; no
script/iframe/style/on*; DOMPurify drops javascript: URIs), falling back to plaintext
when no formatted_body. `Timeline.tsx` renders sanitized HTML via
dangerouslySetInnerHTML (safe — already sanitized) for message kind. Verified: bold/
italics/links render in unencrypted rooms; plain messages unaffected. TEMP window.mxClient
debug removed from App.tsx.

**Step 2.4 COMPLETE** — read-only timeline: live events, scrollback, classified
rendering (message/encrypted/redacted/other), sanitized rich text. New files:
`src/client/useTimeline.ts`, `src/client/messageBody.ts`, `src/ui/Timeline.tsx`.

2.4d (deferred/optional): polish — sender grouping, avatars, day separators.

### Step 2.5 — composer (sending messages)
(status: done)

`src/ui/Composer.tsx` — plain-text composer pinned below the timeline. `client.sendTextMessage(roomId, body)` on Enter (Shift+Enter = newline); optimistic clear with restore-on-failure so a failed send doesn't lose text; Send button disabled when empty/sending; auto-refocus after send. Sent messages appear via the existing live `RoomEvent.Timeline` subscription — no manual insertion. `App.tsx` room view now: header / Timeline / Composer.

Verified: type + Enter sends and the message appears in the timeline; Shift+Enter newlines; Send button works and greys when empty. Plain text only for now (markdown/HTML send is a later enhancement via sendHtmlMessage).

**Technetium is now a usable client** — login, navigate spaces>rooms, read formatted history, and send messages. The core chat loop is closed.

### Step 2.6 — formatted (markdown) sending
(status: done)

Installed `marked@18`. `src/client/messageFormat.ts` — `formatMessage(input)` runs
`parseInline` (no block <p> wrap, breaks:true), sanitizes the output with the SAME
strict DOMPurify allowlist as the receive side (marked passes raw HTML through by
default, so sanitizing before send is required), and decides plain-vs-HTML by comparing
the sanitized HTML against an HTML-escaped version of the input — so escaping alone
(a < b) does NOT falsely trigger formatted send. Composer sends `sendHtmlMessage` when
formatting is present, else `sendTextMessage`. Verified: bold/italic/code/links render
after sending; plain stays plain. Read/write formatting is now symmetric.

Remaining candidates:
- room header polish (topic, member count),
- read receipts / unread markers,
- image upload + the planned client-side md5 dedup (ties into the booru pipeline),
- encryption phase (for encrypted-room support).

---

## FUTURE IDEAS (captured 2026-06-21, not scheduled)

### Technetium UX — extreme customizability
- Settings menu shows a LIVE MOCKUP UI that updates as the user changes options
  (see your choices reflected immediately).
- Granular sliders: distance between messages, avatar size, timestamp format +
  position, etc.
- Space/room names user-customizable via right-click -> "Customize name" (local
  override of the display name; does not change the room's actual name for others).

### fourier-resonance (new Fourier component concept)
A "value / combination-of-values" organizer. Two layers:

1. Explicit rules + general "vibes" as a preference store:
   - Explicit: "always default to private", "dark mode whenever possible",
     "accept only strictly-required cookies then purge ASAP", "randomize
     username/password whenever possible".
   - Vibes: fuzzy preferences applied where no explicit rule exists.
   - Open: password-manager integration (1Password? Bitwarden/Vaultwarden already
     in the stack via fourier-envelope) for the randomize-credentials behavior.

2. Right-click "Copy Color / Copy Size / Copy Vibe" (+ Paste variants):
   - Resonance copies the INTRINSIC values of an element, decomposed into
     predefined/user-defined categories logged in a "data matrix".
   - Context-aware options: right-click text -> Color/Size/Kerning/Font/...;
     right-click a background image -> image-relevant options. The browser knows
     the element type, so the option set maps to the element.
   - Map presets to other elements directly or via translation between systems.

3. "Configuration force field" — portable preferences the user carries to new
   sites:
   - On visiting a new site, (auto or on request) scan/research the site's full
     settings tree (with or without AI assistance).
   - Map the user's presets as closely as possible onto that site's actual
     settings.
   - Show the user visually: which settings were DIRECTLY mapped, which were
     MISSED, which were filled via "vibes" (pre-set prompts).

Note: this is a large, ambitious, mostly-separate product idea from Technetium —
captured here so it isn't lost; belongs in its own design space when revisited.

### Step 2.7 — member list (composable, context-aware honorifics)
(status: done)

A pluggable member-source system, not a single aggregator — so a future Discord
source (mapping Discord users to Matrix identities, if the user allows) drops in
as a provider, not a rewrite.

Files:
- `src/client/members.ts` — `Honorific` (~ PL100 owner, @ PL50 op/mod, + PL25
  voice placeholder), `MergedMember` {id, displayName, avatarMxc, sources[],
  powerByRoom{}}, `MemberSource` interface, `maxPower()`, `createMatrixSpaceSource`.
  KEY RULE: space-structured rooms confer power+presence; orphan rooms (DMs/
  direct-joins) record presence ONLY — DMs default both members to PL100, which
  was inflating everyone to ~. Honorifics now reflect real channel authority.
- `src/client/useMembers.ts` — merges sources by identity (combines sources[] +
  powerByRoom{}), debounced 250ms refresh, source-array-ready for future providers.
- `src/ui/MemberList.tsx` — 220px right panel, third column. Three modes:
  Room / All / All· (all-with-current-room-highlighted). Alphabetical sort (PLs
  carried for future honorific-sort + pull-~@+-to-top).

NOVEL FEATURE — context-aware honorifics:
  honorific IDENTITY = member's highest power across the space (what badge).
  honorific VISUAL STRENGTH = power in the CURRENTLY-VIEWED room.
  Full vivid tier color when authority is "here"; dimmed grey (name + badge
  together) when "elsewhere" — "I'm important, just not in this room."
  In All· mode, members present in the current room are emphasized, rest dimmed.
  No true server-wide list (would need privileged admin access — declined as
  wrong for a client). "All" = everyone the client personally knows about,
  space-scoped (mirrors nav-tree population).

Technetium now has the full three-column Discord shape: nav tree | timeline +
composer | member list.

---

## KNOWN BUG (open, deferred to next session) — honorific dim in ROOM mode

Symptom: in **Room** mode, a member's honorific (~/@/+) still renders at FULL
strength even in rooms where that authority does NOT apply. The name/row dims
correctly; the honorific badge does not recede as intended.

Expected: honorific IDENTITY (the badge shown) = highest power across the space;
honorific VISUAL STRENGTH should follow power in the CURRENTLY-VIEWED room — full
vivid tier color when authority is "here", muted/dimmed when "elsewhere".

Where to look:
- `src/ui/MemberList.tsx`, `MemberRow`. The `dimmed` calc for `mode === 'room'`
  is `honorificFor(plHere) !== identityHonor`. Note: in Room mode, the list is
  ALREADY filtered to members present in the room (powerByRoom has this room),
  so `plHere` is their actual PL here. Suspect: the dim/color logic isn't firing
  for the honorific specifically, OR the All·-mode fix (honorColor -> secondary
  when dimmed) isn't taking effect in Room mode, OR `dimmed` is computing false
  when it should be true (e.g. a user who is + in room A and ALSO default in
  room B should dim in B — verify honorificFor(plHere) actually differs from
  identityHonor in that case).
- Likely a logic bug in the Room-mode branch, not the rendering: re-check that
  `plHere` and `identityHonor` produce the intended mismatch, and that the
  honorColor ternary (dimmed ? secondary : tier) is reached.

Repro: view a room where a known +/@ user is present but NOT powered; their badge
shows full color instead of dimmed.

---

## Session 2026-06-26 — member-list dim fix, "Nearby", image posting

### Step 2.7-fix — honorific dim decouple (resolves KNOWN BUG above)

Root cause: `MemberRow` drove BOTH the name and the honorific badge off one
`dimmed` flag. A prior fix coupled the badge color to that flag, so the badge
receded but dragged the whole name grey with it — a member present in the viewed
room yet holding rank ELSEWHERE went fully grey instead of just the badge.

Fix — two independent signals in `MemberRow`:
- `presentHere = !!room && room.roomId in member.powerByRoom` -> NAME (white in
  the viewed room, grey when not).
- `authorityHere = identityHonor && honorificFor(plHere) === identityHonor` ->
  BADGE (tier color when rank is backed HERE, grey when elsewhere).
- Gated by `honorsRoom = mode === 'room' || mode === 'all-highlight'`; 'all'
  overrides room context (everyone full strength).
Verified across all three modes. KNOWN BUG closed.

### Step 2.8 — "Nearby" view + default

"All ·" (all-highlight) relabeled **Nearby**; made the default
(`useState<Mode>('all-highlight')`). On first load with no room selected it shows
the full roster greyed — reads as "connected, here's everyone" instead of the
ambiguous empty pane Room mode gave (empty == indistinguishable from
not-connected/loading).

### Step 2.9 — image posting (render + send)

Render:
- `src/client/media.ts` — sole owner of the media gateway. `parseMxc()`,
  `mediaUrl(mxc, width?)`, `fetchMediaObjectUrl(client, mxc, width?)`. Origin from
  `VITE_MEDIA_BASE` (default https://mxc.41chan.net); fetches with
  `client.getAccessToken()` as Bearer, returns an object URL.
- `src/ui/AuthedImage.tsx` — renders an mxc via the helper; placeholder while
  loading, [image unavailable] on error, revokes the object URL on unmount.
- `src/ui/Timeline.tsx` — `m.image` branch in `Row` renders <AuthedImage
  width={320}> instead of filename-as-text.

Send:
- `src/ui/Composer.tsx` — image attach button + drag-drop; `readImageSize()` for
  info.w/h; `client.uploadContent()` -> `client.sendImageMessage()`. Synapse mints
  a fresh mxc per upload; client-side dedup still deferred (bmb findPostByMd5
  guards dup booru posts).

Auth: media is fetched through fourier-auth in **bearer mode** at mxc.41chan.net
(fourier-auth DEVLOG §9), NOT the client's raw Synapse token — keeping fourier-auth
the single authorization gateway. Verified end-to-end: post from Technetium ->
renders inline -> lands in the booru via bmb.

### Step 2.10 -- thread view (enable, pills, panel, threaded composer)

**Enablement gotcha (cost a debugging loop):** `threadSupport: true` is a
**`startClient`** option, not `createClient`. `supportsThreads()` reads
`this.clientOpts.threadSupport`, and `clientOpts` is populated by `startClient` --
so the flag on `createClient` is silently ignored and every `m.thread` reply stays
flat in the main timeline. Fix: pass it to `startClient({ initialSyncLimit: 1,
threadSupport: true })`. Also `Thread.setServerSideSupport/List/FwdPagination =
FeatureSupport.Stable` before `store.startup()`. After fixing, the prior sync was
poisoned (cached flat) -- had to `indexedDB.deleteDatabase('matrix-client-sync')` +
hard reload for a fresh threaded sync (token survives in localStorage).

- **Pills:** `ThreadChip` on `event.isThreadRoot` rows shows a live reply-count pill
  (`thread.length` + `ThreadEvent.Update/NewReply` subscription); click -> open panel.
- **Panel (`ThreadPanel.tsx`):** resolves its OWN `(roomId, rootId)` via
  `client.getRoom(roomId).getThread(rootId)`, so it **persists across room switches**
  (auto-close on room-switch deliberately removed; manual Close kept). Renders
  root + `thread.timeline` (deduped) through the shared `Row`. Own threaded Composer.
- **Composer:** optional `threadId` routes `sendTextMessage/sendHtmlMessage/
  sendImageMessage(roomId, threadId, ...)` into the thread -- text, markdown, image.
- **Layout:** `aside | main | ThreadList | ThreadPanel | MemberList`; fixed columns
  take width from `main`, member list unaffected.

### Step 2.11 -- cross-room thread list

**Decision -- client-side aggregation, no server service.** A thread list is
**per-user / membership-scoped**, so there's no single shareable list to cache; a
background aggregator would have to re-implement the homeserver's ACLs per user and
hold long-lived per-user tokens. And `room.getThreads()` is a cheap in-memory read
off sync data (not a poll), live via `ThreadEvent`. So aggregation belongs in the
client. (A server-side admin firehose of all threads regardless of membership would
be a separate, deliberate admin-API thing -- not this.)

- **`useThreadList.ts`:** iterates joined rooms -> `room.getThreads()` ->
  `{roomId, roomName, rootId, thread, lastTs}` sorted by last activity; live via
  **client-level** `ThreadEvent.New/Update/NewReply` re-emission + `ClientEvent.Room`;
  `fetchRoomThreads()` per room to backfill the server-side list on open.
- **`ThreadList.tsx`:** ~190px strip left of the panel. Tiles: room / author /
  `(untitled)` title placeholder (future) / start time / text preview or an m.image
  thumbnail (`AuthedImage` w180/h90) / reply count / last-activity time. Per-tile
  expandable **stats** toggle (footer-right, `stopPropagation` so it doesn't open the
  thread): expands to posters / posts / media plus a per-user posts+media breakdown,
  walking root+replies. Caveat: counts reflect **loaded** events -- long unpaginated
  threads undercount until scrolled.
- **JSX-text gotcha:** `\u...` escapes are invalid in raw JSX text (valid only in
  string literals) -- oxc parse error. Use literal glyph characters in JSX children.

### Step 2.12 -- restacked message rows
`Row` (shared by main timeline AND thread panel): inline `[time][sender][body]` ->
**stacked** -- sender (bold) + time (small) on a header line, body indented 16px
below, reply pill under the body. Same-sender grouping not done yet.

### Step 2.13 -- full-width layout
`#root` dropped its fixed centered column -> `width:100%` left-aligned, so the
five-column shell uses the whole viewport.

**Committed:** `7f3105a` (layout), `55e37db` (threads + list + rows). New files:
`ThreadPanel.tsx`, `useThreadList.ts`, `ThreadList.tsx`.

---

## Session 2026-06-27 -- multi-image batches, gallery grid, resizable panels

### Step 2.14 -- multi-image posting + captions
`Composer` reworked: attaching (button or drop) now builds a **pending tray**
instead of firing immediately; `multiple` file select + multi-drop; each thumbnail
removable. On send, images upload + post sequentially, each its own `m.image` (Matrix
has no album event, so bmb/Element are unaffected). Typed text rides as a **caption
on the first image** via **MSC2530** (`filename` = real name, `body` = caption,
`formatted_body` for markdown) -- built as content + `sendMessage` (the
`sendImageMessage` helper can't set caption fields). Mid-batch failure stops and keeps
the unsent images + caption in the tray.

### Step 2.15 -- gallery grouping + grid render
Every batched image carries a dormant **`net.41chan.gallery`** hint
`{id, index, count, layout}`. `toItems` coalesces same-`id` images into one **gallery
item pre-sized to `count`**, each placed by `index`; null slots are placeholders
(pending/failed/interleaved). A run of <2, or interleaved/partial batches, fall back
to normal image rows (no reordering). `GalleryBody` renders three sender-chosen
layouts:
- **grid** -- fixed ~118px square cells, arranged by count: 2/3 in a row, 4 as 2x2,
  **5 as a double-height cell on the left + a 2x2 on the right** (3-col x 2-row
  template, cell-0 spans both rows; `width: max-content` so fixed columns aren't
  clipped).
- **stack** -- constant total height (300px), N full-width rows divide it.
- **strip** -- constant total width+height (360x280), N columns divide it.
`GalleryCell` fills its track (geometry lives in `GalleryBody`); static **pending-
glyph** background (inline SVG, swappable for a served PNG) with the thumbnail layered
over it; `AuthedImage` gained **`fill`** (object-fit cover) + **`transparentLoading`**
(renders nothing while loading so the glyph shows through until paint). Caption from
index-0 below the grid. Sender picks layout in the composer (picker shows for >=2
images); `toItems` reads it off the flag and stamps it on the item -- **viewer
override deferred** (renderer already takes layout as plain input, so a local toggle
layers on cleanly).

### Step 2.16 -- drag-resizable thread list + panel
`ResizeHandle` (5px `col-resize` bar, pointer-capture drag) on each panel's **left
edge**; widths lifted into `App` state, clamped (list 140-420, panel 280-640). Left-
edge drag = inverse of pointer dx (drag left -> wider); `main` (flex:1) absorbs it so
the member list stays fixed. **In-memory** (resets on reload) -- localStorage
persistence deferred.

### Notes
- **Anchored-edit lesson:** multi-line edits keyed off `cat -n` output kept missing on
  whitespace; bare unique single-line substrings (+ a `count==1` guard) are the
  reliable anchor for files not written in-session.

**Committed:** `267488e` (panel resize), `37ed078` (multi-image + caption + gallery
grid). No new files -- all edits to existing.

### Future ideas (raised 2026-06-27) -- thread-list evolution
Sized for whoever picks these up; none built. (#1/#3 lean on Matrix **account data**.)

1. **Star/pin threads to the top.** Smallest. Splits on where the star lives:
   *local* (a `Set` in `localStorage`, sort starred-first in `useThreadList`) is
   trivial; *portable* (stars follow the user to any client) stores a
   `net.41chan.starred_threads` **account-data** event -- same effort tier, syncs
   per-user across devices for free. **Lean portable.** Key must be the
   `(roomId, rootId)` pair, not just `rootId`.
2. **Repopulate active threads across logins** -- looks like a feature, is really a
   **protocol limitation**, and is the **highest-value** of the three. Root cause: the
   list is built from `room.getThreads()`, which only sees threads whose events are in
   the synced window -- so after a fresh login / cache clear, rooms not yet scrolled
   show **nothing**. Fix isn't "remembering"; it's **eager hydration on login**: walk
   joined rooms calling `room.fetchRoomThreads()` (the server-side `/threads` endpoint
   we already enabled) so the list reflects what the server knows. Cost = N requests
   across joined rooms on login -> wants **throttle/backoff + a loading state**.
3. **Containerize threads into user-arranged spaces** (sort / filter / group / custom
   buckets) -- the **big** one. Sort/filter on data already on hand (room, author,
   activity, starred, media-count) is incremental + buildable. User-defined buckets
   with custom drag/arrange means persisting a layout model (account data again) + an
   org UI = a project, not a step. **Scope down:** ship sort + filter on existing
   fields first; custom buckets are the moonshot.

---

## 2026-06-28 (session 2) -- invite UI, nav-tree investigation, hierarchy finding

Client-side work this session:

### Invite accept UI (built, committed `9c6cb49`)
`NavTree.tsx`: rooms/spaces with `getMyMembership() === 'invite'` render **bright
green + bold** (`#3bd16f`) with a click **"join"** affordance (`marginLeft:auto`).
Click -> `client.joinRoom(roomId)`; on success the tree auto-rebuilds via the
EXISTING `RoomEvent.MyMembership` listener in `useNavTree` (already subscribed -- no
hook change needed) and the row becomes a normal joined room. Failure -> red "retry".
`stopPropagation` so join doesn't also fire row-select.
- Covers BOTH cases: channel invites render in-tree; space invites render at top
  level (an invited space passes the `!childIds.has()` top-level filter in
  `buildNavTree`, so it already flows through as a top node).
- **Join-only for now.** Decline deferred (decline == `client.leave()` == reject;
  add later as a companion).

### Dev-only client exposure (committed `9c6cb49`)
`ClientContext.tsx` after `buildClient`: `if (import.meta.env.DEV) window.mxClient = c`.
Vite strips DEV-false branches from prod, so it never ships. Gives console access to
the live authenticated client for interactive debugging (room state, hierarchy,
membership).

### KEY FINDING -- getRoomHierarchy returns the full skeleton to space members
`client.getRoomHierarchy(spaceId, 50, 3)` returns the full space skeleton -- every
subspace AND channel, with names + join rules -- to a member of the space, even for
rooms that member hasn't joined. So the server exposes space structure to space
members regardless of per-room membership. This VALIDATES building the nav tree from
hierarchy structure, not just synced rooms.

### Nav-tree requirement + deferred design (NOT built -- next session opener)
Current `buildNavTree` sources children from `m.space.child` but only renders a child
if it's in `client.getRooms()` (sync) -- so a clean space-member-no-channels session
shows the space EMPTY (channels correctly hidden, BUT subspaces also hidden).
Requirement: **subspaces always visible; channels hidden unless joined (or invited).**
The fix is a HYBRID tree (deferred, designed):
- **Structure** from `getRoomHierarchy(spaceId)` (includes unjoined subspaces +
  channels with names). Async + paginated -> `useNavTree` must gain loading/error +
  caching (fetch on space-load, refresh on `m.space.child` change; membership overlay
  stays live from sync). Real refactor of the nav-tree DATA layer, not a filter.
- **Membership** overlaid from sync (`getMyMembership()`) for styling + the show/hide
  rule.
- **Render rule:** `room_type === 'm.space'` -> always show; room -> show only if
  joined/invited, else hide.

### Dev-environment lesson (cost real time -- recurred 4x this session)
Element and Technetium share dev origin `127.0.0.1:5173`, so they share browser
storage (same-origin policy: storage is per origin, not per app). A prior Element
session left `im.vector.*`/`io.element.*` account data + `m.direct` in that origin's
IndexedDB; Technetium then rendered THOSE rooms + DMs while the live token was a
different user. Ground truth: the homeserver showed the test user in ZERO rooms --
proving the tree was 100% stale local state, not a server leak. **Firefox private
windows do NOT fix this** -- all private windows share ONE private session/storage
pool (private browsing = "forget on close", NOT "isolate concurrent identities"). The
right tool is **Multi-Account Containers** (per-identity isolated storage) or a
separate browser. Test alts there, never the admin browser at the same origin.

---

## Session 2026-06-29 -- nav-tree hybrid (built)

Resolves the "next session opener" from 2026-06-28: the deferred hybrid nav-tree got
built. Structure now from the server hierarchy, membership from sync.

- **`buildNavTree(client, rooms: HierarchyRoom[])`** (`client/spaces.ts`) -- builds
  from `getRoomHierarchy` entries (which INCLUDE unjoined-but-visible rooms).
  `TreeNode` no longer assumes a live `Room`: carries `roomId`/`name`/`membership`/
  `joinRule` explicitly with `room: Room | null` (null when unjoined). Structure from
  `children_state`; membership via `client.getRoom()`.
- **`useNavTree` is async** -- returns `{ tree, loading }`. Roots discovered from sync
  (joined space rooms not parented by another joined space -- no hardcoded root id,
  supports a future 2nd top space). Per-root `getRoomHierarchy` paginated to
  completion via `next_batch`. CHEAP cache-overlay rebuild (re-reads membership/names
  off the cached skeleton -- instant, drives join feedback) vs EXPENSIVE refetch (re-
  pulls hierarchies); a membership change does both. `RoomStateEvent.Events` triggers
  refetch ONLY for `m.space.child`. Sequence counter discards superseded fetches.
  Keep-previous: never blanks mid-fetch.
- **Three-state render** (`ui/NavTree.tsx`), by `membership` + `joinRule`:
  - joined -> normal text (open room / toggle space).
  - joinable (invite, or unjoined restricted/public) -> solid green; click `joinRoom`
    then open.
  - knock (unjoined knock) -> green pill, dark text; click `knockRoom`, row shows
    'requested'. *(Superseded 2026-06-30 -- see nav-tree fixes.)*
  - Ripple-on-join: one-shot green CSS sweep when a row transitions into joined.
- Orphan rooms (DMs/direct-joins, absent from every hierarchy) -> 'Direct & other'
  group at the bottom.

**members.ts decoupled from the nav tree:** `client/members.ts` no longer calls
`buildNavTree`; it enumerates JOINED rooms directly (`getRooms()` filtered to `join`)
with its own space-vs-orphan partition. **Load-bearing decouple, do NOT re-couple:**
the tree now intentionally holds unjoined nodes with `room: null` (no membership/PL to
feed the honorific model); member-list correctness depends on iterating only real
joined rooms.

**Tooling -- typecheck command:** reliable typecheck is
**`npx --no-install tsc --noEmit -p tsconfig.app.json`** (or `tsc -b`). Bare
`tsc --noEmit` silently checks NOTHING on this project-references layout: root
`tsconfig.json` is a solution file (`files: []` + `references`), zero input files,
always "passes." `-p tsconfig.app.json` is the project that actually `include`s
`src/`. (Bare `npx tsc` also pulls a bogus package -- always `--no-install`.)

Deferred: `buildNavTree` walks every joined non-hierarchy room into 'Direct & other'
unconditionally -- fine now, needs grouping/lazy render at DM scale.

---

## Session 2026-06-30 -- nav-tree fixes (post-open)

Real usage surfaced two nav-tree regressions.

### Invited/joined top-level spaces overlaid from sync (`b610e80`)
The hybrid tree fetched `getRoomHierarchy` only for JOINED roots, so a user invited to
the ROOT space (membership `invite`) got an empty tree -- a regression from the old
all-rooms iteration. Fix: `buildNavTree` overlays top-level spaces with membership
`invite` OR `join` from sync that the hierarchy didn't surface (independent of the
fetch). Also covers the post-accept window before the refetch lands (no flicker-to-
empty).

### Knock rooms de-emphasized (`b43ae4e`)
Supersedes the 06-29 render: knock was a green pill with dark text -- too loud. Now
plain **darker-green text** (`#2b9450`), normal weight, transparent bg, normal hover.
Joinable stays bright green (`#3bd16f`); shade alone separates join (bright) from
knock (dark), no fill.

---

## Session 2026-06-30 -- media viewer (lightbox): enlarge, save, in-gallery nav

Full-screen image viewer, built on the inline image rendering (Step 2.9) and the
gallery grid (Step 2.15). Commit `8e38f6e`; deployed to `tc.41chan.net`.

### Media viewer -- click-to-enlarge + save
- `src/ui/Lightbox.tsx` (new) -- `LightboxProvider` + `useLightbox()`, mounted ONCE at
  App root (`src/App.tsx`) so any descendant opens it with no prop-drilling. Matters
  because `Row` is shared by the timeline AND the thread panel (`ThreadPanel` imports
  `Row`) -- one provider covers both.
- Full-res: reuses `fetchMediaObjectUrl(client, mxc)` (media.ts) with NO width param
  (the inline path passes width=320/360 for thumbnails; the viewer omits it). Same
  authed bearer/gateway path -- no new fetch machinery.
- Object-URL lifecycle owned by the provider: fetch on open/navigate, revoke the prior
  blob on change + close. The blob is RETAINED so Save reuses it -- no second round-
  trip.
- Save = synthetic `<a download=filename>` at the already-fetched object URL.
  Filename: `content.filename` (MSC2530 caption case) -> `body` -> mxc mediaId, with an
  extension from `info.mimetype` when the name lacks one (`imageMeta()` in
  Timeline.tsx).
- Dismiss: backdrop / Close button / Escape; image + toolbar clicks stopPropagation.
  `AuthedImage` already exposed `onClick` (+ pointer cursor) -- wired at the single-
  image `m.image` branch in `Row` and in `GalleryCell`.

### In-gallery prev/next
Scoped to WITHIN the clicked gallery (cross-timeline nav deferred).
- Viewer holds an ordered SET + index: `open(items: LightboxItem[], startIndex)`. A
  single image is a one-element set, no arrows (`hasNav = items.length > 1`).
- `GalleryBody` (owns `cells`) builds the set: `present` = non-null valid-mxc cells in
  order + a `presentIndexByCell` map; each cell's `onOpen` opens the whole batch at
  that cell's position -- clicking the 3rd opens ON the 3rd, and prev/next walk only
  REAL images (pending/failed slots skipped, not shown as blanks).
- `GalleryCell` decoupled from the lightbox (takes `onOpen?`, no `useLightbox()`) --
  the component that owns the data owns the open call.
- Controls: prev/next buttons + an `n / N` counter (only when >1), ArrowLeft/ArrowRight
  keys, clamp at the ends (buttons disable + dim, no wrap).

**Files:** new `src/ui/Lightbox.tsx`; edits `src/App.tsx` (provider mount),
`src/ui/Timeline.tsx` (Row onClick, `GalleryCell`/`GalleryBody` nav, `imageMeta()`).
`tsc -b` clean.

**Deferred:** cross-timeline nav; save directly from an inline thumbnail (save
currently lives inside the viewer).
