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
enforced and proven against illegal fixtures, CI. **S1 landed 2026-10-02** — `money`, `cards`, `fair`
and `protocol`: an unbiased shuffle pinned at 30 seed pairs by an independent Python implementation,
the same shoe in Node and a DOM, and a schema for everything on the wire.

---

## Task map

| Block | Delivers | Gates on | Status |
| --- | --- | --- | --- |
| **S0** | Workspace, strict TS, boundary lint, purity tests, CI | — | ✅ (landed 2026-10-02) |
| **S1** | `protocol` · `money` · `cards` · `fair` — the contracts everything reads | S0 | ✅ (landed 2026-10-02) |
| **S2** | `engine` — the round machine, pure and headless | S1 | ✅ (landed 2026-10-02) |
| **S3** | `apps/server` — sessions, wallets, seeds, idempotency, persistence, `/fair` | S2 | ✅ (landed 2026-10-02) |
| **S4** | `strategy` + `tools/sim` — basic strategy and the realised house edge | S2 | ✅ (landed 2026-10-02) |
| **C0** | `client-core` — transport, the truth store, `actionId` + `seq`, retry, resync | S1, S3 | ✅ (landed 2026-10-02) |
| **C1** | The table on screen — Pixi scene, card atlas, `director`, the deal and the dealer's play | C0 | ✅ (landed 2026-10-02) |
| **C2** | Decisions — action bar, insurance, double, split to four hands, optimism and rollback, skip and turbo | C1 | ✅ (landed 2026-10-02) |
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
- [x] `packages/money`: branded `Minor`, integer arithmetic, `Intl.NumberFormat` display, and a
      `payout(stake, numerator, denominator)` that refuses an inexact result — with `ratio` under
      it and `half` for insurance, all three throwing `InexactAmountError` rather than rounding.
- [x] `packages/cards`: card codes, the canonical six-deck shoe, `value(cards)`, ten-value equality
      for splits. Tested against a brute-force oracle over every two-card hand and every three-card
      hand of ranks. **Diverged:** `value` returns `natural`, not `blackjack` — an ace and a
      ten-value as two cards is a blackjack only on a hand not born of a split, which `cards`
      cannot know and the engine does.
- [x] `packages/fair`: `commit`, the HMAC byte stream, the unbiased Fisher–Yates, `shoe(serverSeed,
      clientSeed)`. **Isomorphic** — SHA-256 and HMAC in plain TypeScript, a suite that runs in
      happy-dom as well as Node. 85 µs a shoe.
- [x] Golden test: 30 pinned seed pairs → the first 20 cards each, and one whole shoe, computed by
      [`packages/fair/golden/shuffle.py`](packages/fair/golden/shuffle.py) and rerun by
      `tests/golden-fresh.test.ts` so the fixture cannot be edited by hand. **Diverged:** the
      uniformity check is not 10⁶ full shoes (≈90 s at 85 µs) but χ² over 240,000 shuffles of four
      items — every one of 24 orders — and over 20,000 full shoes for one tagged card's position,
      plus `below` tested word by word at the rejection boundary for `n` = 3, 5 and 312. Three
      mutations — no rejection, the loop one index short, an event row deleted from the document —
      each turn a suite red.
- [x] `packages/protocol`: zod schemas + inferred types for all of §2, `GameConfig`, `Round`,
      `Hand`, every event, the error envelope. `tests/protocol-doc.test.ts` holds the document's
      endpoint, event and error tables and the schemas to the same lists. The `round` schema checks
      the invariants a snapshot can break on its own — face-down never travels, settled means
      settled, `allowed` belongs to its phase — and `holeDealt` refuses a `card` by name.

**Done when:** the golden test pins 30 shoes, `fair` produces the same shoe in both runtimes, and the
schemas parse a hand-written fixture of every request, reply, event and error.

## Block S2 — The round machine

_3 days. The part reviewers actually read._

- [x] `packages/engine`: `step(state, command, shoe) → { state, events }`. Phases as an exhaustive
      discriminated union with a total `switch`. **The engine returns events; it never emits.**
      Refusals (`ROUND_OPEN`, `NO_OPEN_ROUND`, `INSUFFICIENT_FUNDS`, `ACTION_NOT_ALLOWED`) are
      values, not throws; a throw is a bug — an inexact stake at the deal, a shoe that ran out.
      `view(state)` is the one door to the wire: the hole card and the server seed stay behind it.
- [x] The deal in the pinned order (§3.3), insurance under an ace, the peek under an ace or a
      ten-value, blackjack settling in the deal (§4.3).
- [x] Decisions: hit, stand, double, split by value to four hands, split aces one card each, no
      resplit aces, auto-stand on 21. `allowed` computed for every decision and **exact** — every
      action in it accepted, every action outside it refused.
- [x] The dealer: turns the hole card, draws to 17, stands on soft 17, does not draw when every hand
      is bust.
- [x] Settlement through `money.payout`, left to right, insurance separately; `totalStake` and
      `totalPayout` on the snapshot. **Diverged:** insurance settles at the peek, not with the
      hands — that is when a table takes or pays it, and the presentation can show it there.
- [x] `fold(previous, events) == state` asserted for every step — the events are a proof of the
      snapshot (protocol invariant 6), and the property is the engine's, so the client can rely on
      it. **Diverged:** `fold` lives in `protocol`, not `engine` — `client-core` may not import the
      engine and must run the same fold on every reply. It proves the *table* (`tableOf`): not
      `seq`, `allowed` or the round's identity, which no event carries. `handStood` gained `auto`,
      without which `STOOD` and `DONE` could not be told apart from the events alone.
- [x] `replay(rules, shoe, stake, decisions)` — the verifier's entry point, and the same function the
      server's resume uses. **Diverged:** it also takes the round's `seeds` (the snapshot carries
      `roundId`, `commit`, `clientSeed`) and holds each decision to the `seq` it names. The balance
      is optional: only affordability depends on it, and a recorded decision was affordable, so the
      verifier replays with `maxExposure` — every hand split and doubled, plus insurance.
- [x] Tests: every transition and refusal · `allowed` against a brute-force oracle at every decision
      of 10,000 random hands · the four-hand split with a double on each · dealer blackjack under an
      ace with insurance taken and declined · a player blackjack against a dealer ace · 100,000
      seeded hands of random legal play with money conserved after every step and every event
      parsed against the wire schema. The oracle is a second reading of §4.2 over the wire snapshot,
      run under random rule sets (max hands, DAS, H17, hit/resplit aces, auto-stand, insurance) and
      random balances, with `act` tried on all six actions at every decision. 100,000 hands take
      ≈3 s; the run asserts it reached every action, every outcome and four hands. Three mutations
      — a double not debited, a split that ignores the balance, an auto-stand reported as a stand —
      each turn a suite red.

**Done when:** 100,000 seeded hands of random legal play end with every unit of money accounted for,
every snapshot equal to the fold of its events, and every `allowed` equal to the oracle's.

## Block S3 — The server

_2–3 days._

- [x] `apps/server`: Fastify, `/api/session`, `/api/deal`, `/api/act`, `/api/round`,
      `/api/history`, `/fair/rounds/:roundId`, `/health`, `/ready`. Every body parsed with its
      schema; every reply too, in development. The work is in `Table`, which knows no HTTP;
      `http.ts` is a line per route. Fastify's own refusals and anything thrown come back in §6's
      shape — a throw as `INTERNAL`, its message kept off the wire.
- [x] Sessions and wallets: a bearer token per player, a fresh demo wallet per new token.
- [x] Seeds: the next round's server seed drawn from a CSPRNG at session open and at every
      settlement, persisted with the session; `COMMIT_MISMATCH` for any other commit.
- [x] Idempotency and versions in the pinned order — session → `actionId` replay → `seq` → rules
      ([`docs/protocol.md`](docs/protocol.md) §7). Stored replies for the open round and the last
      settled one. **Diverged:** only accepted requests are stored — a refusal changed nothing, and
      its retry is answered afresh. A decision naming another round than the open one is
      `STALE_SEQ`; with none open, `NO_OPEN_ROUND` carries the round that last settled.
- [x] Persistence behind one interface, two implementations — in memory (tests) and SQLite (WAL,
      `synchronous=FULL`). Round state, events, the reply and the wallet in **one transaction before
      the reply**. A restart resumes every open round exactly, its shoe regenerated from its seeds.
      **Diverged:** a round is stored as its *inputs* — rules, seeds, stake, opening balance,
      decisions — and every request rebuilds its state through `engine.replay`. Resume is not a
      separate path, and the wallet is checked against the replayed balance on every load. Each
      request is synchronous from first read to commit, so two tabs are serialised by the event
      loop with no lock. One contract suite runs against both stores.
- [x] Never a face-down card or an unrevealed seed in a reply, an error or a log line — asserted by a
      test that scans every reply and log record of 10,000 hands for the hole card's code and the
      seed's hex before their reveal. The card check is structural: every card code in the raw body
      must sit in a `cards` list or an event's `card`, so a leak through any new field is caught.
      ≈25,000 replies, resyncs and conflicts among them, in ≈5 s.
- [x] The dev surface (`BJ_DEV=on`): `forceShoe`, and a forced round marked as such end to end. A
      production server refuses to boot with it (and with an in-memory database), naming every
      violation at once.

Found on the way: ULIDs minted in the same millisecond sorted at random, which shuffled history
pages — the ids are now monotonic within a millisecond, as the ULID spec's monotonic mode is. And
history is not pruned to 100 rounds: `/fair` links must outlive the page that shows them, so the
limit is per page, with `before` to page back.

**Done when:** an integration test plays 1,000 hands over real HTTP with two clients sharing a
session (two tabs), random lost replies and two server restarts mid-hand, and ends with every wallet
equal to the sum of its rounds and no hand ever dealt a card twice. ✅ ≈2.5 s against SQLite; each
lost reply's retry is byte-identical to the reply lost, and every round is verified through `/fair`
from its seeds. Three mutations — the seed in a log line, the hole card in a reply, idempotency off
— each turn a suite red.

## Block S4 — Basic strategy and the realised edge

_1–2 days. Can run in parallel with S3._

- [x] `packages/strategy`: the basic-strategy table for the published rules — hard, soft and pair
      hands against every upcard, insurance never — and `recommend(hand, upcard, allowed)`, which
      falls back correctly when its first choice is not allowed (double → hit or stand).
- [x] The table checked against the engine: for every cell where the published chart's rules differ
      from ours (split by value, four hands), per-action EV by simulation, and the chart's action
      shown to be the best within error. **All 110 pair cells**, not only the ones that differ —
      every pair, plus a king with a ten — each open action on the same 20,000 shoes (common random
      numbers), the chart's action best within 3σ of the paired difference in every one. A king
      and a ten: standing beats splitting by 0.18–0.56 units against every up card.
      ([`docs/sim/chart.txt`](docs/sim/chart.txt))
- [x] `tools/sim`: ≥10⁷ hands of basic strategy through `engine` with real shuffles; realised edge,
      its standard error, the distribution of outcomes per hand, and how often each rule fires
      (splits, doubles, insurance offers, dealer blackjacks). Worker threads, ≈53,000 rounds/s on
      12; tallies are sums, so a run split across threads gives the same answer (tested).
- [x] The published edge for these rules pinned from a named source, and the sim within 3σ of it
      ([`CLAUDE.md`](CLAUDE.md) § Gaps). **0.40622 %**, Wizard of Odds' house edge calculator,
      "basic strategy with continuous shuffler" (a fresh shoe every round, as here). Three runs of
      10⁷: +2.53σ, +0.48σ, +0.42σ; pooled 0.448 % ± 0.021 %, +1.98σ — logged as an open gap, not
      rounded away. ([`docs/sim/`](docs/sim/README.md))

**Done when:** `pnpm sim -- --hands 10000000` reports a realised edge within 3σ of the published
figure, and a test pins a smaller run's result for a fixed seed. ✅ 2,000 rounds of the seed
`"pinned"` are held to the unit, outcome by outcome.

---

# Part II — Client

## Block C0 — `client-core`

_2 days. **No DOM in this package.**_

- [x] Transport: `fetch` with timeouts, every reply parsed by schema, errors mapped to the four
      classes. **Diverged:** `fetch`, `sleep`, randomness, UUIDs and storage are *handed in* — the
      package compiles with no DOM lib and no Node types, so it cannot name them, and the browser,
      the load tool and the tests each pass their own. A reply that misses its timeout is a lost
      reply; a 5xx that is not our error shape (a proxy's page) is retried like `SYSTEM`.
- [x] The truth store: snapshot, balance, commit, config — replaced wholesale by every reply, with a
      typed change stream out carrying `(previous, events, next)`. Resume, resync and conflicts
      carry no events: they are rendered as they stand.
- [x] `actionId` per intent, reused across retries; `seq` from the snapshot the decision was made
      on; one action in flight at a time, so a double tap is one request — the second is `busy`,
      not queued. A decision outside `allowed` is not sent at all (`unavailable`).
- [x] Retry: `SYSTEM` and network failures retried with backoff under the same `actionId`; a lost
      reply recovered by the retry, not by a guess. `CONFLICT` replaces the truth with the attached
      state and never retries. Equal-jitter backoff, 250 ms doubling to 4 s, six attempts; then
      `failed` with the truth unchanged. `SESSION` opens a new session and says so (`sessionLost`).
- [x] Seeds: a fresh client seed per round by default, a typed one kept until changed;
      `COMMIT_MISMATCH` draws a new seed before re-sending (protocol invariant 8). Every round's
      commit and client seed remembered locally for the verifier. A typed seed is not re-sent on its
      own: the deal comes back `commitMoved`, and the player's next press is the confirmation.
- [x] Resume: session open returns the open round, rendered as it stands.
- [x] Tests against a fake server: every error class · a reply lost after the server applied it ·
      two tabs on one hand · a server restart between commit and deal · `fold(previous, events) ==
      next` asserted in dev on every reply. The fake server is the protocol's routes and order of
      checks over the **real engine and shuffle** — a new boundary rule lets `client-core`'s test
      code, and only it, reach them. Four mutations — no in-flight guard, no retry after a lost
      reply, a conflict's round ignored, no fold assertion — each turn a suite red.

**Done when:** a headless test drives 1,000 hands through a fake server that drops one reply in ten,
duplicates one in twenty and restarts every hundred, and every hand ends with the client's truth
equal to the server's. ✅ seeded, ≈1 s.

## Block C1 — The table on screen

_3 days._

- [x] `apps/web` bootstrap: Vite, one Pixi v8 canvas, a DOM layer over it, `client-core` wired;
      connection states that are real UI (connecting / retrying / out of date). `client-core` gained
      a status stream for it — `connecting`, `online`, `retrying`, `offline`, and `outdated` for a
      reply this client cannot parse (a newer server; a reload fixes it). `pnpm dev` runs both.
- [x] `packages/renderer`: the felt, the shoe, the dealer row and the player's hand positions, a
      generated card atlas (faces, back) — the art question from [`CLAUDE.md`](CLAUDE.md) § Gaps
      decided by boot time and sharpness at 3× DPR. **GSAP driven by the Pixi ticker**:
      `gsap.ticker` removed, `gsap.updateRoot` called from Pixi's — one clock. **Decided:**
      `Graphics` + `Text` drawn once at the device's ratio into one 13 × 5 texture (3,744 × 2,010 at
      3×, under the 4,096 limit), ≈100 ms at boot, sliced into frames that share one source — one
      draw call for every card, no shipped art, no licence. The renderer declares its own picture
      and cue types; the director's fit them, and `apps/web` is where the compiler holds the two
      together.
- [x] `packages/director`: `(previous, events, pace) → Beat[]` for the deal, the peek, the hole card's
      turn, the dealer's draws and settlement. Every beat has an animated path and a snap path in
      the renderer, and the director's tests prove each script ends in its snapshot's picture. Each
      cue carries the `Picture` after it, so the renderer animates between pictures and never
      interprets a message. Splits, doubles and insurance are scripted already; C2 gives them their
      choreography.
- [x] The decision gate: the action bar's state is a function of the timeline's position, not of the
      truth alone ([ADR-0002](docs/adr/ADR-0002-presentation-lags-truth.md)). Every reply ends on
      a decision or a settlement, so the gate is the script's last beat: buttons are disabled, not
      hidden, until it has played — and a press before then sends nothing (tested).
- [x] The beat-gated balance: the HUD shows the truth's balance minus the payouts not yet played.
      Each cue carries its HUD figure; a stake leaves at once, a win arrives with its settle beat.
- [x] Skip: a tap or a key completes the timeline; a hidden tab returns to the end state. Tap on the
      felt, `Escape` or Space; `visibilitychange` skips; a new reply skips whatever was still
      catching up.
- [x] Pace written down ([`CLAUDE.md`](CLAUDE.md) § Gaps): card travel, flip, dealer pause, settle
      gap — and the median length of a round at normal pace, measured. `director/src/pace.ts`:
      travel 300 ms + 90 ms between cards, flip 260, peek 600, the dealer's pause 450 before each
      card of their own, settle 380 a hand. **A round's animation: median 3.97 s, p90 4.97 s** over
      5,000 rounds (stand on 17+, hit below) — thinking time not counted. `?turbo` plays at 0.4×.

**Done when:** a round dealt, stood and settled holds 60 fps on a throttled mobile profile, memory is
flat across 500 rounds (no textures or tweens left behind), and skipping from every beat of a round
lands on the same picture as watching it to the end. **Met 2026-10-02** (`pnpm --filter @blackjack/web perf`,
Chromium on the machine's GPU, 375×812 at 3× DPR, CPU throttled 4×, two runs): ≈6,650 animation
frames, none over 25 ms and none over twice the idle interval; a frame's work 1.8 ms at p99 and
5.5 ms at worst against a 16.7 ms budget, no long tasks; heap 7.0 → 7.2 MB from round 50 to 500
with one sprite per card on the table and no tweens; 50 random skips in the browser equal to a
fresh render; the atlas ≈105 ms, Deal usable 0.4–0.55 s after navigation. **Measured, not
assumed:** the first run used Playwright's default headless shell and reported 30 fps — its WebGL is
SwiftShader on the CPU, and idle frames ran at 34 ms with our code costing under 3 ms of them; a
CPU profile put ~67 s in native GL and 0.1 s in the hottest JS function. A real phone is P0's.

## Block C2 — Decisions

_3 days._

- [x] The action bar: Hit, Stand, Double, Split, and Insurance / No insurance — exactly `allowed`,
      disabled until the gate opens, keyboard (`H S D P I N`) and screen-reader labels; the bet panel
      with chips against `betUnit`, `minBet`, `maxBet` and the balance. Each button carries its key
      (`aria-keyshortcuts`, printed beside the label); a live region says the decision in words —
      "Hand 2 of 3: 8, 3 — 11. Dealer shows a 6. Hit, stand or double?" — and the result in full.
      Chips are 1, 5, 25 and 100 units up to `maxBet`; a chip lights only if it keeps the stake within
      the maximum and the balance, Deal only for a stake the server takes (`apps/web/src/table/bet.ts`,
      every reachable stake checked under eight balances). Enter deals and Space skips from the page;
      on a focused button they are the button's own.
- [x] Split: the hand divides on screen, the active hand is unmistakable, up to four hands — and the
      portrait layout for four hands of six cards. The pair's second card slides to the new hand and
      its stake follows; the active hand is ringed and lit, every other hand dimmed. **Decided:** more
      than two hands on a phone held upright go in **two rows** — four hands of six cards side by
      side would leave cards ≈35 px wide at 375 px; two rows keep them 64 px at 375 × 812 (60 at the
      defaults the tests use). A hand's place depends only on the number of hands, never on its cards
      — so a split's stake can be sent to where its hand will be before the reply — and a seventh
      card closes a hand's fan up rather than growing it. The felt is the band between the HUD and
      the controls, **measured** from the DOM (`Insets`), and the controls keep one height between
      the bet panel and the action bar so the band does not move mid-round. Held by
      `stage.test.ts` over nine viewports, one to four hands of two, six and nine cards, a dealer row
      of seven: every hand on the felt, none overlapping another, the dealer row or the shoe.
- [x] Double and split are **optimistic in chips only**: the chips move at the press, the cards wait
      for the server, and a refusal sends the chips back with the reason in words. `Stage.propose()`
      is the one optimistic API — there is none that could move a card — and the reply's `double` or
      `split` cue takes the chips in (a split's become the new hand's stack). A refusal, a failure
      (the move's fate unknown) and a conflict (a snap to the truth) all send them back; the HUD
      never moves at the press. Insurance is not optimistic: it is not a move on a hand.
- [x] Insurance under an ace, and the peek's result said plainly when the dealer does not have it.
      The dealer's hole card lifts at the peek; the line over the bar says "Dealer checked — no
      blackjack." or "Dealer has blackjack.", and what insurance came to — **a reply's lines add up**,
      so the peek is never overwritten by the insurance that settled after it. Insurance shows under
      the dealer's total on the felt.
- [x] Turbo (a `timeScale`) and reduced motion (a pace with no travel), both from settings, both
      remembered. Turbo is `Stage.setSpeed(2.5)` on the timeline and every tween — set mid-round, it
      speeds up the round already playing; reduced motion is `REDUCED`, every motion zero and every
      hold kept, so cards appear one at a time where they land. **Diverged:** a cue now separates its
      motion (`ms`) from the stillness after it (`hold`) — a card's gap and a result's moment are
      holds — which is what lets a pace drop the travel and keep the rhythm. `TURBO` the pace is gone.
      The settings live under a ⚙ in the HUD, in `localStorage`, defaulting to the system's
      `prefers-reduced-motion`; `?turbo` and `?reduced` override one visit.
- [x] The result moment: every hand's outcome and payout, the round's total, gone before the next
      deal. Each hand's total and result beside its stake, a lost stake greyed; over the controls
      "You win · Staked €25.00 · returned €50.00" — both figures the snapshot's, no subtraction — and
      the whole round said hand by hand to the live region. It appears when the last result has
      played and goes at the press of Deal, not when the next round's cards land.

**Done when:** thirty hands on a 300 ms throttled link — with a split, a double and an insurance
offer among them — never show a card before its reply, never light a button the server refuses, and
never let a double tap become two actions. **Met 2026-10-02** (`pnpm --filter @blackjack/web
decisions`, Chromium as a 375 × 812 phone, the browser's own throttling at 300 ms latency — round
trips 310–330 ms): 30 hands, four of them forced through the dev shoe (a pair of eights split and
split again, an eleven doubled, insurance taken and lost, insurance declined against a dealer
blackjack), the rest real shuffles played by basic strategy. ≈13,600 animation frames, each checked
in the page: no card on the felt that the truth did not hold, no lit action outside `allowed` or
while a request was out or the script still playing, Deal lit only between rounds — **zero
violations**. 57 decisions, each pressed twice (a double click, or its key struck twice): **57
actions and 30 deals reached the server, every answer 200** — no refusal, no conflict. 30 result
moments, each gone at the Deal press; the peek said plainly, "Dealer checked — no blackjack.
Insurance lost." among the lines over the bar. Six full runs of seven met it.

**The probe was tested before it was trusted.** Against a mutant that opens the gate at once it
failed on the first hand — after one fix: its first version asked the controller whether its own
gate was open, and passed the mutant; it now asks the stage. The seventh reported 29 result
moments for 30 hands and was not reproduced in five more: the likeliest cause is the probe's own —
it stopped a hand after twelve decisions, and read the line before that last reply had played; a
hand split to four can take twelve. It now plays each hand until the next Deal is offered, and
reports which hand lacked a result if one ever does.

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
