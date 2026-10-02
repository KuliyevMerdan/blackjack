# ADR-0003 — The demo host: one origin, no disk, a fresh table each boot

- **Status:** accepted
- **Date:** 2026-10-02
- **Applies to:** `apps/server` (static serving), the `Dockerfile`, `render.yaml`, the verifier's
  "no such round" line, the README. **Qualifies**, for a host without a disk, the restart promise
  in [`docs/protocol.md`](../protocol.md) §8.

## Context

The live demo has to cost nothing to keep up and need no card: it is a portfolio piece, and a demo
that lapses when a trial ends is worse than none. Its two siblings already run on Render's free
tier (slots since 2026-09-26, crash since 2026-10-01), and that tier has two properties that matter
here:

1. **No persistent disk.** The container's filesystem is new at every boot.
2. **It sleeps.** After 15 minutes without a request the instance stops; the next visitor wakes a
   new one in about a minute.

This server keeps everything in SQLite — sessions, wallets, each session's committed next seed,
open rounds with their decisions, the settled history, the stored replies that make a retry safe.
§8 promises that "a restart resumes every open round exactly", and `pnpm load` proves it with five
`SIGKILL`s in half an hour (P0). On a diskless host that promise holds within a boot and not across
one. Something has to be said, and the alternatives cost more than they buy:

- **A paid instance with a disk** (Render Starter + disk, or Fly with a volume): the restart promise
  holds on the live link too, for ~$7 a month and a card on file, indefinitely. Nothing in the demo
  needs a wallet to outlive an idle quarter of an hour.
- **An external database** (a hosted Postgres or Turso free tier): a second service to keep alive,
  a network hop inside every request's transaction — the property S3's synchronous, single-file
  transaction was chosen for — and a second store implementation to keep honest.

## Decision

**On a host without a disk, every boot is a new table: fresh play-money wallets, freshly committed
seeds, an empty history.** Nothing claims to survive a boot, so nothing silently fails to.

- **One origin.** `apps/server` serves the built web app from `/` (`BJ_STATIC_DIR`) beside `/api/*`
  and `/fair/*`, so the page needs no CORS, no server address and no proxy — the same shape in the
  Docker image, in the E2E suite and on Render. Hashed assets are cached for a year; `index.html`
  never, so a returning browser runs the client that matches the server. A directory with no
  `index.html` refuses to boot. The API's routes are more specific than any file, so none can be
  shadowed (tested).
- **One image.** The `Dockerfile` builds the server and the production web bundle (no `__bj`
  handle) and ships a standalone `pnpm deploy` tree with `BJ_ENV=production` and
  `BJ_DB=/app/data/blackjack.db`. The boot contract still applies: no forced shoes, no in-memory
  wallet — the file is real, it simply lives on a disk that is gone at the next boot. A host with a
  disk mounts one at `/app/data` and §8 holds in full, unchanged.
- **The lab is on.** `BJ_FAULTS=on` in `render.yaml`: a visitor can break only their own session
  (§9, D11), and the demo's point is to watch the protocol recover.
- **Deploys follow CI.** `autoDeployTrigger: checksPass`: the demo is never a commit that
  `pnpm check` or the E2E suite rejected.

## Why nothing breaks across a boot

Each thing a browser keeps from before a sleep meets a new instance that has never heard of it, and
each already has an honest answer — none of them new code:

- **The session token.** Unknown to the new instance: `POST /api/session` opens a fresh session
  (tested in S3), and a game call made with it is `UNKNOWN_SESSION`, which `client-core` answers by
  opening a new one and the table says so in words ("Your session had expired, so a fresh table has
  been opened"). A tab left open across a sleep needs no reload: its next request wakes the
  instance, and the answer it gets is that one.
- **A verification link.** Round ids are ULIDs, unique across boots, so an old link can never open
  a *different* round of the same name and call it verified — the failure crash's chain ids had to
  be redesigned around. The new instance has no such round, and the page says that this demo keeps
  no disk.
- **The seeds this browser sent** (C3's step 2) stay in its own storage and are simply never asked
  for again.
- **Fairness.** ADR-0001's claim is per round and needs nothing across a boot: every seed is drawn
  from the CSPRNG, committed before the bet and revealed at the settle, within one boot. No seed is
  reused, because none is ever restored.

## Consequences

**Good**

- Costs nothing, needs no card, and the image runs unchanged on a host with a disk.
- The demo's fairness claim is exactly as strong as ADR-0001 makes it, within a boot.

**Costs, accepted**

- **A wallet, an open hand and the history last a boot** — in practice until 15 minutes after the
  last visitor leaves. A hand left open across a sleep is gone with its stake, as is the balance
  it was staked from. The README says so.
- **A round is verifiable while its boot lasts.** Its record — both seeds, the commit, the
  decisions — is what the verifier needs, and anyone who saved it can still check it offline with
  `@blackjack/fair` and `@blackjack/engine`; the server just cannot serve it any more.
- **The first visit after a quiet spell waits for a cold start** — about a minute. The README says
  so, so a reviewer does not take a slow first load for a broken page.
- **The restart promise is tested where it holds**: `pnpm load` and the server's integration suite
  run on a file that survives the kill. On the live link it is not exercised and not claimed.
