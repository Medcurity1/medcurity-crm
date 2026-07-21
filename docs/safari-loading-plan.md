# Safari / Stale-Tab Loading Reliability — Diagnosis + Plan

Logged 2026-07-20 (Nathan). Supersedes and absorbs the 2026-07-17 DOCKET item "Deploy-proof stale tabs" (no longer deferred). Investigation session: 2026-07-20, full boot-path + live-header audit.

**✅ IMPLEMENTED — SHIPPED TO STAGING (commit deeaae3) AND PROMOTED TO PROD (merge 750527e) 2026-07-20.** Live on crm.medcurity.com; awaiting Nathan's real-world Safari field test. All six layers below, plus the UpdateBanner (layer 2's healthy-tab variant). Implementation deltas from the plan as written: (a) the global error/rejection handlers in main.tsx deliberately do NOT match Safari's generic `"Load failed"` — it fires for ANY offline fetch and a page reload there would toss in-progress work; Safari's dynamic-import failures say "Importing a module script failed", which was already matched. `"load failed"`/`"networkerror"` ARE matched where a render actually crashed (route ErrorBoundary — pre-existing — and the new RootErrorBoundary). (b) The lock cap is a custom `timeoutNavigatorLock` passed as `auth.lock` (10s AbortController on `navigator.locks.request`, proceed lock-less on timeout) rather than auth-js's `lockAcquireTimeout` option. (c) Healthy-but-stale tabs get a dismissible "Pulse was updated — Refresh" banner (bfcache restore / >15min-hidden → visible checks against /version.json), never a forced reload.

## Symptoms

- CRM intermittently fails to load in Safari (Nathan's machine; Chrome fine). Not a hard block — unreliable.
- 2026-07-17: a plain refresh did NOT fix it — stale files survived reloads until website data was manually cleared.
- 2026-07-20: even clearing website data no longer reliably fixes it.

## Diagnosis (verified against code + live headers 2026-07-20)

Service worker: **ruled out** (none exists). Four real mechanisms, first two primary:

### 1. Stale page + deleted files (blank white page)

Every deploy replaces the app's uniquely-named files and **deletes the old ones** (verified: superseded `index-*.js` hashes 404 on both staging and prod; entry + `App-*` hashes change every build). We deploy several times a day. The HTML is served `no-cache/must-revalidate` and Chrome honors it; Safari's tab-restore/back-forward cache can resurrect an old HTML document without revalidating → it requests files that no longer exist → blank page.

Our existing recovery net has three gaps that bite Safari specifically:
- The stale-chunk auto-reload listener lives **inside the entry chunk** (`src/main.tsx:24-59`). If the stale HTML points at a dead *entry* hash, the listener never registers — no recovery at all.
- Its regex (`main.tsx:26-29`) matches Chrome's error strings but **misses Safari's** (`"Load failed"`, `"NetworkError"`). (`ErrorBoundary.tsx:20-31` does match them, but it only wraps routed content.)
- The boot chain `initCrossTabSession().then(... import("./App") ... render)` (`main.tsx:67-74`) has **no `.catch`**, and there is **no root-level ErrorBoundary** around App/AuthProvider — a boot-time failure renders nothing.
- Azure quirk (doc- and live-confirmed 2026-07-07): route header rules do NOT apply to navigationFallback-rewritten responses, so **deep links** (`/contacts`, `/home`, …) get default `max-age=30` HTML instead of no-cache. Fix path: put `Cache-Control` in `globalHeaders` (those DO apply to fallback); the `/assets/*` route rule keeps immutable caching for real files.

### 2. Session-lock hang (infinite "Loading..." spinner)

Auth uses supabase-js's default Web Locks (`navigatorLock`) to coordinate the session across tabs (`src/lib/supabase.ts:5-15` sets no `lock`/`lockAcquireTimeout`; installed `auth-js@2.101.1` `GoTrueClient.js:135-136`). With no timeout configured, `_acquireLock` waits **indefinitely** and the lock-steal recovery never engages (`locks.js:115,195`). Safari freezes background tabs aggressively (we've already worked around this elsewhere — `AppLayout.tsx:73` `useFrozenAnimationGuard`), so a frozen Safari tab can hold the lock forever → every other tab hangs at `ProtectedRoute`'s "Loading..." (`ProtectedRoute.tsx:8-14`) because `getSession()` never resolves.

**This explains "clearing website data stopped fixing it":** clearing storage doesn't release a Web Lock held by another open/frozen tab, doesn't evict an already-restored bfcache page, and the stale-page problem simply recurs after the next of several daily deploys. (The cross-tab session model changed 2026-06-16 to sessionStorage + BroadcastChannel + Web Locks — which is when the failure profile changed.)

### 3. Privacy-mode storage crash (blank page, consistent per setting)

Boot-time storage reads are unguarded: `initTheme()` → `useTheme.ts:21` `localStorage.getItem` runs before first paint with no try/catch; `crossTabSession.ts:186` `sessionStorage.getItem` likewise (its rejection also has no `.catch`). Under Safari "Block All Cookies"/Lockdown these throw `SecurityError` → entry module dies → blank.

### 4. Old-Safari build target (note only)

`build.target` unset → Vite 6 default ≈ Safari 16+; no legacy fallback. Safari ≤15 gets a permanently blank page. Team runs current Safari; only relevant if another user ever reports "never loads."

## Fix plan (layered — any one failure self-heals; ~half day, frontend + config only, no DB)

1. **Recovery net in the HTML itself** (inline script in `index.html`, immune to stale-chunk death): entry-script `onerror` + a boot watchdog (`window.__appBooted` flag) → one cache-busted reload (sessionStorage-guarded) → if still failing, a static friendly "Reload" screen instead of white.
2. **Fresh-check, not blind reload** (Nathan's 7/17 requirement — a plain reload provably didn't cut it): emit a build stamp (git sha) into the bundle + a tiny `version.json` fetched with `cache: "no-store"`. Recovery paths and a `pageshow`(bfcache-restore)/visibility check compare stamps and reload with a cache-buster only on mismatch — verifying we actually got fresh files.
3. **Teach the existing net Safari's language + close the catch gaps:** broaden `main.tsx` regex (`load failed`, `networkerror`, `error loading dynamically imported module`); add `.catch` on the boot chain rendering a reload screen; add a root-level ErrorBoundary.
4. **Session lock can never hang forever:** set a lock-acquire timeout (~5s; via auth `lockAcquireTimeout`/custom lock wrapper — engages auth-js's lock-steal recovery; worst case is a redundant token refresh, safe) + an escape hatch on the "Loading..." screen (>10s → "taking too long" + reload button running the fresh-check).
5. **Deep-link HTML no-cache:** move `Cache-Control: no-cache` into `globalHeaders` in `staticwebapp.config.json`, keep `/assets/*` immutable route override; verify with curl on `/`, a deep link, and an asset post-deploy.
6. **Guard boot-time storage** (`useTheme.ts`, `crossTabSession.ts:186`) with try/catch defaults so privacy modes degrade gracefully instead of blanking.

## Verification

- curl header checks (/, deep link, asset) on staging + prod after each config change.
- Simulate: request a dead chunk hash (expect inline recovery); DevTools-block a lazy chunk (expect boundary reload w/ fresh-check); block storage (expect graceful default theme + login).
- Web-lock hang: simulate by holding the auth lock name in a second tab; expect 5s timeout + normal boot.
- Field test: Nathan's Safari after ship — the one environment we can't drive remotely. Expect: worst case ever visible = one automatic refresh, or a friendly reload button; never a white page, never an endless spinner.
