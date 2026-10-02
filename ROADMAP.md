# Blackjack — Roadmap

Drafted **2026-10-02**. A **single-player blackjack table** — Node + TypeScript server, PixiJS + GSAP
client, one HTTP request per decision. Third portfolio project, standalone, sharing no code with
`../slots` or `../crash`. Target role: game client / frontend developer at an iGaming studio.

This file is the **task map**: blocks, their gates, and the order they land in. The *why* — the
committed shoe, the presentation that lags the truth, the dependency rules — lives in
**[`CLAUDE.md`](CLAUDE.md)**, which is the canon you keep current as code lands.

**Every block follows the house pattern:**

> **protocol change → engine (headless tests) → server → client-core → director → renderer/UI →
> tests green → tick off here + update `CLAUDE.md` (Rule 0) and delete the filled Gaps entries
> (Rule 1)**

**S0 landed 2026-10-02** — the workspace, strict TypeScript, the dependency graph and purity rules
enforced and proven against illegal fixtures, CI. The wire contract
([`docs/protocol.md`](docs/protocol.md)) and both ADRs are pinned, so S1 shows ◐: its remaining boxes
are implementation.

---

## Task map

| Block | Delivers | Gates on | Status |
| --- | --- | --- | --- |
| **S0** | Workspace, strict TS, boundary lint, purity tests, CI | — | ✅ (landed 2026-10-02) |
| **S1** | `protocol` · `money` · `cards` · `fair` — the contracts everything reads | S0 | ◐ |
| **S2** | `engine` — the round machine, pure and headless | S1 | ☐ |
| **S3** | `apps/server` — sessions, wallets, seeds, idempotency, persistence, `/fair` | S2 | ☐ |
| **S4** | `strategy` + `tools/sim` — basic strategy and the realised house edge | S2 | ☐ |
| **C0** | `client-core` — transport, the truth store, `actionId` + `seq`, retry, resync | S1, S3 | ☐ |
| **C1** | The table on screen — Pixi scene, card atlas, `director`, the deal and the dealer's play | C0 | ☐ |
| **C2** | Decisions — action bar, insurance, double, split to four hands, optimism and rollback, skip and turbo | C1 | ☐ |
| **C3** | History, the verification page, the strategy hint | C2, S3, S4 | ☐ |
| **P0** | Hardening — lost replies, two tabs, restarts, load, a network lab | C2, S3 | ☐ |
| **P1** | Packaging — deploy, README, Playwright E2E in CI | C3, P0, S4 | ☐ |

**Legend:** ☐ not started · ◐ in progress · ✅ landed (add the date, as `✅ (landed 2026-10-04)`).

**Build order:** `S0 → S1 → S2 → (S3 · S4 in parallel) → C0 → C1 → C2 → C3 → P0 → P1`.
S4 needs nothing after S2 and can fill any wait. C3's hint needs S4's table; its verifier needs
`/fair/rounds/:roundId` from S3.

---

# Part I — Core & server

## Block S0 — Workspace foundations

_1 day. Nothing else may land before it._

- [x] pnpm workspace + Turborepo, `packages/*`, `apps/*`, `tools/*`, catalog-pinned tool versions.
- [x] Strict TypeScript — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `dist`
      builds per unit. The base tsconfig carries no DOM lib and no Node types; flavours opt in. No
      project references — units resolve through `dist/` + `exports`, ordered by Turborepo.
- [x] `dependency-cruiser` encoding the graph in [`CLAUDE.md`](CLAUDE.md) § Dependency rules —
      including `engine` reachable from `apps/web` only under `src/verify/`, and the forbidden paths
      to `../slots` and `../crash` (by path and by `@slot/*` / `@crash/*` name).
      `tests/boundaries.test.ts` proves every rule fires against `config/fixtures/`.
- [x] `tests/purity.test.ts` — no clocks, no `Math.random`, no I/O or globals in `engine`, `cards`,
      `fair`, `money`, `strategy`, `director`, one fixture per package. `tests/type-safety.test.ts`
      proves the `any` / `!` / `as` bans alongside.
- [x] ESLint + Prettier + husky/lint-staged; CI running `pnpm check` on push.
- [x] Thirteen empty units — nine in `packages/`, two apps, two tools — whose `src/index.ts` names
      the block that fills each one.
- [x] A README stub: what this is, where the canon is, play money only.

**Done when:** `pnpm check` is green on an empty workspace, and a deliberately illegal import
(`renderer` → `protocol`, and `apps/web/src/table` → `engine`) fails CI.

## Block S1 — Contracts: protocol, money, cards, fair

_2 days. Write this before anything moves on screen. Everything is downstream of it._

- [x] **The wire contract is pinned** (2026-10-02) — every endpoint, request, reply and event, the
      four-class error taxonomy, `actionId` + `seq`, the shuffle, the rules and payouts, and the
      decision log, in [`docs/protocol.md`](docs/protocol.md).
- [x] **The two load-bearing decisions are ADRs** (2026-10-02) —
      [ADR-0001](docs/adr/ADR-0001-committed-shoe.md) (committed shoe, client seed, face-down never
      travels) and [ADR-0002](docs/adr/ADR-0002-presentation-lags-truth.md) (truth, script, stage).
- [ ] `packages/money`: branded `Minor`, integer arithmetic, `Intl.NumberFormat` display, and a
      `payout(stake, numerator, denominator)` that refuses an inexact result.
- [ ] `packages/cards`: card codes, the canonical six-deck shoe, `value(cards) → { total, soft,
      blackjack }`, ten-value equality for splits. Tested over every two- and three-card hand.
- [ ] `packages/fair`: `commit`, the HMAC byte stream, the unbiased Fisher–Yates, `shoe(serverSeed,
      clientSeed)`. **Isomorphic** — SHA-256 and HMAC in plain TypeScript, a suite that runs in
      happy-dom as well as Node.
- [ ] Golden test: 30 pinned seed pairs → the first 20 cards each, computed by an independent
      Python implementation. Plus a uniformity check: over 10⁶ shuffles, every card lands in every
      position at the expected rate within tolerance — the rejection step is proven, not assumed.
- [ ] `packages/protocol`: zod schemas + inferred types for all of §2, `GameConfig`, `Round`,
      `Hand`, every event, the error envelope. `tests/protocol-doc.test.ts` holds the document's
      tables and the schemas to the same list.

**Done when:** the golden test pins 30 shoes, `fair` produces the same shoe in both runtimes, and the
schemas parse a hand-written fixture of every request, reply, event and error.

## Block S2 — The round machine

_3 days. The part reviewers actually read._

- [ ] `packages/engine`: `step(state, command, shoe) → { state, events }`. Phases as an exhaustive
      discriminated union with a total `switch`. **The engine returns events; it never emits.**
- [ ] The deal in the pinned order (§3.3), insurance under an ace, the peek under an ace or a
      ten-value, blackjack settling in the deal (§4.3).
- [ ] Decisions: hit, stand, double, split by value to four hands, split aces one card each, no
      resplit aces, auto-stand on 21. `allowed` computed for every decision and **exact** — every
      action in it accepted, every action outside it refused.
- [ ] The dealer: turns the hole card, draws to 17, stands on soft 17, does not draw when every hand
      is bust.
- [ ] Settlement through `money.payout`, left to right, insurance separately; `totalStake` and
      `totalPayout` on the snapshot.
- [ ] `fold(previous, events) == state` asserted for every step — the events are a proof of the
      snapshot (protocol invariant 6), and the property is the engine's, so the client can rely on
      it.
- [ ] `replay(rules, shoe, stake, decisions)` — the verifier's entry point, and the same function the
      server's resume uses.
- [ ] Tests: every transition and refusal · `allowed` against a brute-force oracle at every decision
      of 10,000 random hands · the four-hand split with a double on each · dealer blackjack under an
      ace with insurance taken and declined · a player blackjack against a dealer ace · 100,000
      seeded hands of random legal play with money conserved after every step and every event
      parsed against the wire schema.

**Done when:** 100,000 seeded hands of random legal play end with every unit of money accounted for,
every snapshot equal to the fold of its events, and every `allowed` equal to the oracle's.

## Block S3 — The server

_2–3 days._

- [ ] `apps/server`: Fastify, `/api/session`, `/api/deal`, `/api/act`, `/api/round`,
      `/api/history`, `/fair/rounds/:roundId`, `/health`, `/ready`. Every body parsed with its
      schema; every reply too, in development.
- [ ] Sessions and wallets: a bearer token per player, a fresh demo wallet per new token.
- [ ] Seeds: the next round's server seed drawn from a CSPRNG at session open and at every
      settlement, persisted with the session; `COMMIT_MISMATCH` for any other commit.
- [ ] Idempotency and versions in the pinned order — session → `actionId` replay → `seq` → rules
      ([`docs/protocol.md`](docs/protocol.md) §7). Stored replies for the open round and the last
      settled one.
- [ ] Persistence behind one interface, two implementations — in memory (tests) and SQLite (WAL,
      `synchronous=FULL`). Round state, events, the reply and the wallet in **one transaction before
      the reply**. A restart resumes every open round exactly, its shoe regenerated from its seeds.
- [ ] Never a face-down card or an unrevealed seed in a reply, an error or a log line — asserted by a
      test that scans every reply and log record of 10,000 hands for the hole card's code and the
      seed's hex before their reveal.
- [ ] The dev surface (`BJ_DEV=on`): `forceShoe`, and a forced round marked as such end to end.

**Done when:** an integration test plays 1,000 hands over real HTTP with two clients sharing a
session (two tabs), random lost replies and two server restarts mid-hand, and ends with every wallet
equal to the sum of its rounds and no hand ever dealt a card twice.

## Block S4 — Basic strategy and the realised edge

_1–2 days. Can run in parallel with S3._

- [ ] `packages/strategy`: the basic-strategy table for the published rules — hard, soft and pair
      hands against every upcard, insurance never — and `recommend(hand, upcard, allowed)`, which
      falls back correctly when its first choice is not allowed (double → hit or stand).
- [ ] The table checked against the engine: for every cell where the published chart's rules differ
      from ours (split by value, four hands), per-action EV by simulation, and the chart's action
      shown to be the best within error.
- [ ] `tools/sim`: ≥10⁷ hands of basic strategy through `engine` with real shuffles; realised edge,
      its standard error, the distribution of outcomes per hand, and how often each rule fires
      (splits, doubles, insurance offers, dealer blackjacks).
- [ ] The published edge for these rules pinned from a named source, and the sim within 3σ of it
      ([`CLAUDE.md`](CLAUDE.md) § Gaps).

**Done when:** `pnpm sim -- --hands 10000000` reports a realised edge within 3σ of the published
figure, and a test pins a smaller run's result for a fixed seed.

---

# Part II — Client

## Block C0 — `client-core`

_2 days. **No DOM in this package.**_

- [ ] Transport: `fetch` with timeouts, every reply parsed by schema, errors mapped to the four
      classes.
- [ ] The truth store: snapshot, balance, commit, config — replaced wholesale by every reply, with a
      typed change stream out carrying `(previous, events, next)`.
- [ ] `actionId` per intent, reused across retries; `seq` from the snapshot the decision was made
      on; one action in flight at a time, so a double tap is one request.
- [ ] Retry: `SYSTEM` and network failures retried with backoff under the same `actionId`; a lost
      reply recovered by the retry, not by a guess. `CONFLICT` replaces the truth with the attached
      state and never retries.
- [ ] Seeds: a fresh client seed per round by default, a typed one kept until changed;
      `COMMIT_MISMATCH` draws a new seed before re-sending (protocol invariant 8). Every round's
      commit and client seed remembered locally for the verifier.
- [ ] Resume: session open returns the open round, rendered as it stands.
- [ ] Tests against a fake server: every error class · a reply lost after the server applied it ·
      two tabs on one hand · a server restart between commit and deal · `fold(previous, events) ==
      next` asserted in dev on every reply.

**Done when:** a headless test drives 1,000 hands through a fake server that drops one reply in ten,
duplicates one in twenty and restarts every hundred, and every hand ends with the client's truth
equal to the server's.

## Block C1 — The table on screen

_3 days._

- [ ] `apps/web` bootstrap: Vite, one Pixi v8 canvas, a DOM layer over it, `client-core` wired;
      connection states that are real UI (connecting / retrying / out of date).
- [ ] `packages/renderer`: the felt, the shoe, the dealer row and the player's hand positions, a
      generated card atlas (faces, back) — the art question from [`CLAUDE.md`](CLAUDE.md) § Gaps
      decided by boot time and sharpness at 3× DPR. **GSAP driven by the Pixi ticker**:
      `gsap.ticker` removed, `gsap.updateRoot` called from Pixi's — one clock.
- [ ] `packages/director`: `(previous, events, pace) → Beat[]` for the deal, the peek, the hole card's
      turn, the dealer's draws and settlement. Every beat has an animated path and a snap path in
      the renderer, and the director's tests prove each script ends in its snapshot's picture.
- [ ] The decision gate: the action bar's state is a function of the timeline's position, not of the
      truth alone ([ADR-0002](docs/adr/ADR-0002-presentation-lags-truth.md)).
- [ ] The beat-gated balance: the HUD shows the truth's balance minus the payouts not yet played.
- [ ] Skip: a tap or a key completes the timeline; a hidden tab returns to the end state.
- [ ] Pace written down ([`CLAUDE.md`](CLAUDE.md) § Gaps): card travel, flip, dealer pause, settle
      gap — and the median length of a round at normal pace, measured.

**Done when:** a round dealt, stood and settled holds 60 fps on a throttled mobile profile, memory is
flat across 500 rounds (no textures or tweens left behind), and skipping from every beat of a round
lands on the same picture as watching it to the end.

## Block C2 — Decisions

_3 days._

- [ ] The action bar: Hit, Stand, Double, Split, and Insurance / No insurance — exactly `allowed`,
      disabled until the gate opens, keyboard (`H S D P I N`) and screen-reader labels; the bet panel
      with chips against `betUnit`, `minBet`, `maxBet` and the balance.
- [ ] Split: the hand divides on screen, the active hand is unmistakable, up to four hands — and the
      portrait layout for four hands of six cards ([`CLAUDE.md`](CLAUDE.md) § Gaps).
- [ ] Double and split are **optimistic in chips only**: the chips move at the press, the cards wait
      for the server, and a refusal sends the chips back with the reason in words.
- [ ] Insurance under an ace, and the peek's result said plainly when the dealer does not have it.
- [ ] Turbo (a `timeScale`) and reduced motion (a pace with no travel), both from settings, both
      remembered.
- [ ] The result moment: every hand's outcome and payout, the round's total, gone before the next
      deal.

**Done when:** thirty hands on a 300 ms throttled link — with a split, a double and an insurance
offer among them — never show a card before its reply, never light a button the server refuses, and
never let a double tap become two actions.

## Block C3 — History, verification, hint

_2 days._

- [ ] Round history: the session's last 30 hands, each a row with the cards, the stakes and the
      payout, each linking to its verification page.
- [ ] **The verification page** (`#/verify/:roundId`): fetch the public record, and show each step of
      [`docs/protocol.md`](docs/protocol.md) §3.4 — the commit, this browser's own memory of the
      commit and client seed, the shuffle's first cards, and the hand replayed through `engine` card
      by card to the same payouts. Caught failing against a lying server: a wrong seed, a swapped
      card, a changed decision, a different client seed than the one sent.
- [ ] The strategy hint: an optional highlight on the action basic strategy recommends — the same
      table `tools/sim` measured, so the edge the README publishes is the edge the hint plays.
- [ ] The 18+/play-money notice, the rules worded from `GameConfig.rules`, and a short "how this
      works" panel linking the ADRs.

**Done when:** a stranger can lose a hand, open its verification link, and watch the browser rebuild
the shoe, replay their decisions and arrive at the same result — without trusting the server for any
of it.

---

# Part III — Hardening & packaging

## Block P0 — Hardening

_2 days._

- [ ] Fault injection (`BJ_FAULTS=on`): latency, replies dropped after the action applied,
      `UNAVAILABLE` storms — and a network lab in the client to drive them on the live demo.
- [ ] Two tabs on one session, both playing: every action lands once or is answered with
      `CONFLICT`, and both tabs end showing the same round.
- [ ] A server killed mid-hand (`SIGKILL`, not a clean stop) and restarted: every open round resumes,
      no wallet differs from the sum of its rounds.
- [ ] `tools/load`: 200 sessions playing basic strategy for 30 minutes against a running server with
      faults on — money audited, latency percentiles per endpoint recorded.
- [ ] A hidden tab mid-timeline, a reload mid-split, a slow link during the dealer's play — each
      ends on the truth, without replay.

**Done when:** a 200-session 30-minute soak with injected faults ends with zero money created or
destroyed, zero cards dealt twice, and zero clients showing a round the server does not have.

## Block P1 — Packaging

_1–2 days._

- [ ] Deploy server + web from one image, one origin. The host decided in an ADR
      ([`CLAUDE.md`](CLAUDE.md) § Gaps).
- [ ] Playwright E2E in CI on a forced shoe: a split into four hands with a double, the dealer
      busting, every payout asserted on screen and in the balance — then the round verified in the
      browser. Plus a stranger spec that touches nothing but the page, runnable against the live
      demo.
- [ ] README with a GIF above the fold, the two ADRs in a paragraph each, the edge table from S4,
      and a link anyone can follow to verify a hand.
- [ ] `docs/architecture.md` — the request path, the transaction, and the one diagram of truth,
      script and stage.
- [ ] The workspace README's row for this project: its status and the live demo link.

**Done when:** a stranger can open the live link, play a hand with a split, break the network from
the lab mid-hand, watch it recover with nothing lost, and verify the hand they just played — in
under two minutes.
