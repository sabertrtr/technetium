# matrix-client — Starter Dependency Manifest & Scoping

> Planning document for the from-scratch Discord-shaped Matrix client.
> Built on the existing scaffold at `/home/saber/matrix-client` (vesper).
> Versions verified 2026-06-19. Follows the same "record deliberate choices"
> discipline as the Fourier `DEPENDENCIES.md`.

---

## 1. What you DON'T build (reused, not authored)

| Concern | Source | How it's reused |
|---|---|---|
| Protocol engine: sync, room state, timeline, pagination, sending, account data, push-rule eval | `matrix-js-sdk` | Used directly as the entire backend. Already installed. |
| E2EE cryptography (Olm/Megolm, double ratchet, key handling) | `@matrix-org/matrix-sdk-crypto-wasm` | **Auto-installed with js-sdk** (js-sdk depends on `^18.x`). Never pinned or touched directly. Activated via `client.initRustCrypto()`. |
| UI atoms: buttons, dialogs, tooltips, avatars, fields, menus | `@vector-im/compound-web` + `@vector-im/compound-design-tokens` | Element's own design system. Adopting it = Element-quality, ecosystem-familiar UI for free. |
| Rich-text composer (mentions, formatting, markdown) | `@matrix-org/matrix-wysiwyg` | Optional; defer until basic send works. Skips reinventing the composer. |
| HTML sanitization (messages carry untrusted HTML) | `dompurify` | **Mandatory** before rendering any message HTML. Security-critical. |
| Widgets (embeds) | `matrix-widget-api` | Optional / later. Only if you embed widgets. |

The "hard middle" you DO author (ordering, unread counts, reply/edit/redaction
rendering, your multi-image grouping, your Discord layout) is written by you —
but with element-web (AGPL-3.0) as a *reading reference*, not from first
principles. See §6.

---

## 2. Verified versions (2026-06-19)

| Package | Version | Notes |
|---|---|---|
| `matrix-js-sdk` | `41.6.0` (installed) | latest tag is `41.8.0-rc.0` (an RC); stay on stable 41.6.0 unless a fix is needed. |
| `@matrix-org/matrix-sdk-crypto-wasm` | `18.3.1` | Transitive via js-sdk (`^18.2.0`). Do not add to package.json manually. |
| `@vector-im/compound-web` | `9.4.1` | Peer-needs React `^18 || ^19`. |
| `@vector-im/compound-design-tokens` | `10.2.2` | Compound peer-needs `>=1.6.1 <11`; 10.2.2 satisfies. |
| `@matrix-org/matrix-wysiwyg` | `2.37.9` | Phase 4+. |
| `matrix-widget-api` | `1.17.0` | Optional / later. |
| `dompurify` | `3.4.11` | Add when timeline rendering begins (Phase 3). |

Compound also pulls font packages (`@fontsource/inter`, `@fontsource/inconsolata`)
as peers — install alongside Compound.

---

## 3. React version decision (RESOLVE BEFORE INSTALLING COMPOUND)

Compound 9.4.1 supports React 18 **or** 19. The Vite scaffold was created
recently, so it likely already uses React 19 (current latest is 19.2.x).
**Action:** confirm the scaffold's React version first (`grep '"react"'
package.json`). If 18 or 19, Compound is compatible as-is. Only if the scaffold
were on something older would this need attention. No change expected — just verify.

---

## 4. Dependency install plan (when we get there — not yet)

Grouped by phase so you never install ahead of need (matches your "no stray
deps" instinct). Each phase's install is one command, run on vesper in
`~/matrix-client`.

- **Phase 0 (now, already done):** `matrix-js-sdk` — present. Crypto-wasm rode in with it.
- **Phase 1 (UI foundation):** `@vector-im/compound-web @vector-im/compound-design-tokens @fontsource/inter @fontsource/inconsolata`
- **Phase 3 (timeline rendering):** `dompurify` (+ `@types/dompurify` if not bundled)
- **Phase 4 (rich composer, optional):** `@matrix-org/matrix-wysiwyg`
- **Later / maybe:** `matrix-widget-api`

---

## 5. Environment & project scoping

### 5.1 What already exists (done today)
- Vite + React + TypeScript scaffold at `/home/saber/matrix-client` (vesper, user `saber`).
- Dev server runs bound to `http://127.0.0.1:5173/` (the redirect URI MAS expects).
- Working OIDC login against MAS (static client `00000000000000000000DEVWEB`), token exchange, whoami, one-shot sync, room list.
- Edited via VS Code Remote SSH into vesper.

### 5.2 What the environment still needs
1. **Persisted session** — token + clientId in storage so a refresh resumes
   instead of bouncing to MAS. (IndexedDB via the SDK store, or a small wrapper.)
2. **SDK store wired to IndexedDB** — so sync state and (later) crypto keys
   persist across reloads. Without this, every refresh re-syncs from scratch and
   crypto can't accumulate keys.
3. **A real app structure** — the current single `App.tsx` becomes:
   - a client/session provider (one living, continuously-syncing client),
   - a routing scheme (which room/thread is open),
   - view components (left tree, timeline, composer, member list).
4. **Compound theming set up** — design tokens imported once at the root so all
   UI atoms inherit consistent styling.

### 5.3 Proposed file structure (target, not built yet)
```
src/
  client/        session bootstrap, persistence, sync lifecycle
  state/         which room/thread is open; lightweight, no heavy lib at first
  ui/
    nav/         the unified spaces>subspaces>rooms tree (your image-2 goal)
    timeline/    message rendering, incl. multi-image grouping
    composer/    text send, then staged multi-image send
    members/     always-open right panel
  lib/           helpers (sanitize wrapper, mxc->http, formatting)
  App.tsx        shell wiring provider + routing + layout
```

---

## 6. element-web as a reading reference (NOT a dependency)

For each piece of "middle" you author, the corresponding element-web source is
the known-good implementation to translate from. License: element-web is
AGPL-3.0 (same as your Fourier code), so deriving is fine with AGPL obligations.

| You're building | Read in element-web (approx. areas) |
|---|---|
| Room-list ordering / sectioning | room-list store + sorting algorithms |
| Unread / notification counting | notification state / RoomNotificationState logic |
| Reply / edit / redaction rendering | event tile + replies + "is redacted" handling |
| Spaces hierarchy resolution | spaces store (parent/child via `m.space.child`) |
| Verification / key backup flows | crypto / device-verification UX components |

(Exact paths drift; locate by feature name in the current element-web tree at build time.)

---

## 7. Build phases (sequence, with rough session counts)

These assume crypto is split out as its own phase. Estimates carry the wide
error bars discussed — boundary debugging dominates, not happy-path coding.

1. **Spine** — persistent client, IndexedDB store, continuous sync, session
   resume on refresh. *(1–2 sessions)*
2. **Unified left nav** — spaces>subspaces>rooms tree, compact, stable ordering.
   Your image-2 target. *(2–4)*
3. **Read-only timeline** — render messages (text/image/reply/redaction),
   sanitized HTML, pagination, scroll handling, **plus multi-image grouping**. *(3–6)*
4. **Composer** — send text, then staged one-at-a-time multi-image gallery send
   (generate group_id, stamp `net.41chan.gallery`, mark master, upload, send). *(2–4)*
5. **Encryption** — `initRustCrypto`, key persistence, device verification,
   key backup/recovery, graceful "unable to decrypt" handling. Widest error
   bars. *(3–6)*
6. **Layout polish** — always-open member list, thread/channel swap, typing
   indicator relocated out of timeline flow. *(several, per item)*

**Realistic to a daily-driver incl. encryption + galleries: ~15–30 focused
sessions, bet on the higher half.** Dropping/deferring encryption cuts the
single biggest chunk.

---

## 8. Immediate next step (when building resumes)

Phase 1 of the spine: convert the one-shot login into a persistent,
IndexedDB-backed, continuously-syncing session that survives a refresh — built
on the working OIDC flow already in `App.tsx`. Everything else stacks on that.

---

## STATUS UPDATE (2026-06-20)

**Phase 1 COMPLETE** — spine: OIDC login via MAS, persistent session, IndexedDB
sync store, silent token refresh. Committed to GitHub (`sabertrtr/technetium`,
root commit `352e50b`). Project renamed `matrix-client` -> `technetium`.

**Phase 2 IN PROGRESS** — Discord-shaped UI.
- 2.1 done: Compound installed + wired (tokens + fonts in `main.tsx`).
- 2.2 done: `ClientProvider` (React context) holds the live client; `useClient()`
  hook; `App.tsx` thinned to a status-driven shell.
- 2.3 next: unified spaces>subspaces>rooms nav tree.

**Dependencies now INSTALLED** (were planned in §4):
- `@vector-im/compound-web@^9.4.1`
- `@vector-im/compound-design-tokens@^10.2.2`
- `@fontsource/inter@^5.2.8`, `@fontsource/inconsolata@^5.2.8`
- (`matrix-js-sdk@41.6.0` already present; crypto-wasm rides along, not pinned)

`dompurify` / `@matrix-org/matrix-wysiwyg` still deferred to later phases.

**FOURIER EXTRACTION FLAG:** `session.ts` + `tokenRefresher.ts` + the login flow
form a reusable browser-side "auth against MAS + hold a Matrix session + silent
refresh" library — the client-side counterpart to planned **fourier-passport**.
Kept inside Technetium for now; modules deliberately free of client-specific deps
so a later lift is a move, not a rewrite.

**Dev server:** runs in a persistent `tmux` session (`vite`) on vesper; port 5173
forwarded manually via VS Code PORTS tab (tmux decouples it from VS Code's
auto-forward).
