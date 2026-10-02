# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project status

> ⚠️ **The rules play headless; nothing serves them yet.** **S0 landed 2026-10-02**: the pnpm + Turborepo
> workspace, strict TypeScript, the dependency graph and the purity rules enforced and *proven to
> fire* against deliberately illegal fixtures, and CI running `pnpm check`. **S1 landed
> 2026-10-02**: the four packages everything reads — `money` (exact or nothing), `cards` (the value
> of a hand), `fair` (SHA-256, HMAC and an unbiased shuffle, pinned by an independent Python
> implementation in Node and in a DOM), and `protocol` (every request, reply, event and error as a
> zod schema, with the face-down invariant checked at the boundary). **S2 landed 2026-10-02**: the
> round machine — deal, insurance, peek, four-hand splits, the dealer, settlement — pure, with
> `allowed` matched against an independent oracle and 100,000 random hands folding to their
> snapshots with money conserved at every step. Eight units are still empty shells, each already
> policed. **S3 (the server) and S4 (strategy + sim) are next, in either order.**
>
> The canon is four documents: `CLAUDE.md` (this file), [`ROADMAP.md`](ROADMAP.md) (the task map),
> [`docs/protocol.md`](docs/protocol.md) (the wire contract) and [`docs/adr/`](docs/adr) (the
> decisions everything else is downstream of).
>
> Below **Project description**, a section written in the present tense describes code that exists;
> one that names a block (`S1`, `C1`…) describes the shape the code **must take** when that block
> lands.
>
> **This distinction is load-bearing.** When you implement a block, rewrite its section here in the
> present tense in the same change ([Rule 0](#rule-0--keep-this-file-updated-after-every-change)) —
> and if reality diverged from the plan, the plan is what's wrong.

**This repository is standalone.** It shares no code with `../slots` or `../crash` and must not grow
a dependency on either — not a package, not a path alias, not a copied `tsconfig` that references
one. Decisions repeat between the projects; modules do not.

## Project description

> ⚠️ **Keep this section current.** See [Rule 0](#rule-0--keep-this-file-updated-after-every-change).

A **single-player blackjack table**. One seat against the dealer: stake, deal, insurance under an
ace, then hit, stand, double and split — up to four hands — until the dealer plays and every hand
settles. Node + TypeScript server, PixiJS + GSAP client, one HTTP request per decision.

**Target role:** game client / frontend developer at an iGaming studio. This is the third portfolio
project, and it exists for the axis the other two do not cover: **a round that is a tree of player
decisions, each a round trip, presented as choreography that must never run ahead of the server**.
The slot presents one committed outcome; the crash game synchronises one shared clock; this one
holds a branching hand — split, double, insurance — through double taps, two tabs, lost replies and
reloads, and animates it at a human pace while the truth is already final.

Play money only. No real money, payments or crypto — a visible 18+/demo notice instead.

### The two decisions everything hangs on

**1. The shoe is committed before the bet and shuffled with the player's seed**
([ADR-0001](docs/adr/ADR-0001-committed-shoe.md)). The server publishes `SHA-256(serverSeed)` for
the next round before the player chooses a stake or a client seed; six decks are shuffled from both
seeds by an HMAC-driven Fisher–Yates, fresh every round. Face-down cards never travel: the hole card
is not on the wire until it turns. The settled round reveals the server seed, and the browser
replays the whole hand through the same `engine` the server ran.

**2. The presentation lags the truth, and never leads it**
([ADR-0002](docs/adr/ADR-0002-presentation-lags-truth.md)). Every reply carries the new snapshot —
the truth, applied at once — and the events that produced it. A pure `director` turns events into
beats; the renderer plays them with GSAP on the Pixi ticker. Buttons open only for a decision the
screen has already shown; skip, reconnect and reload all render the snapshot directly.

Everything else in this repository is downstream of those two.

### The invariant that makes the client honest

**The client computes nothing that decides or moves money.** `allowed` actions, stakes, payouts and
the balance all arrive in the snapshot. The client's one piece of game logic is `cards.value()` —
reading a total off cards it was shown — and it is the same function the engine uses. A button the
server would refuse never lights, and a number on screen that the server would disagree with has
nowhere to come from.

### Packages

All thirteen exist since **S0**; the five marked ✅ are written, the rest are empty shells — a
`src/index.ts` naming its block, a build to `dist/`, and the dependency rules already applied. The
right-hand column is the block that fills each.

| Package | Responsibility | Block |
| --- | --- | --- |
| `packages/protocol` | zod schemas + inferred types for every request, reply and event in [`docs/protocol.md`](docs/protocol.md); the four-class error taxonomy with the class a function of the code; `ENDPOINTS`, `EVENT_TYPES`, `PUBLISHED_RULES`. The `round` schema refuses a snapshot that breaks a protocol invariant — a server seed or a second dealer card before settlement, an `allowed` outside its phase. `fold(previous, events)` — invariant 6 as a function, shared by the engine's tests and the client's dev assertion | ✅ S1 · `fold` S2 |
| `packages/money` | branded `Minor`, integer arithmetic, `ratio` / `payout` / `half` that return an exact amount or throw `InexactAmountError` — never round, never floor — and `Intl.NumberFormat` display | ✅ S1 |
| `packages/cards` | `Card` as the exact set of 52 two-character codes, `canonicalShoe(decks)`, `points`, `sameValue` (the split-by-value test), and `value(cards) → { total, soft, natural, bust }`. `natural` is an ace and a ten-value as two cards; whether that is a *blackjack* depends on whether the hand came from a split, which the engine knows. Pure, tiny, shipped to both sides | ✅ S1 |
| `packages/fair` | SHA-256 and HMAC-SHA256 in plain TypeScript (a key's inner and outer states computed once, so each HMAC is two compressions), `commit`, `wordStream`, `below` (rejection), `shuffleInPlace`, `shoe(serverSeed, clientSeed)` — 85 µs a shoe. **Isomorphic**: the same suite passes in Node and happy-dom | ✅ S1 |
| `packages/engine` | the round machine — deal, insurance, peek, decisions, dealer play, settlement, `allowed`. `step(state, command, shoe) → { state, events }` with refusals as values; `view(state)` the only door to the wire (the hole card and server seed stay behind it); `replay(…)` for the verifier and the server's resume. Pure | ✅ S2 |
| `packages/strategy` | basic strategy for the published rules, as a table, with the action it recommends for any `(hand, upcard, allowed)`. Pure | S4 |
| `packages/client-core` | HTTP transport, session, the truth store, `actionId` + `seq` discipline, retry, resync. **No DOM** | C0 |
| `packages/director` | `(previous snapshot, events, pace) → Beat[]` — the choreography as data. Pure, **no Pixi, no GSAP** | C1 |
| `packages/renderer` | the table: Pixi v8 scene, generated card atlas, GSAP timelines on the Pixi ticker, plays `Beat[]`. **No protocol** | C1 |
| `apps/server` | Fastify — sessions, wallets, rounds, seeds, idempotency, SQLite persistence, `/fair` | S3 |
| `apps/web` | Vite — the Pixi canvas, a DOM action bar and bet panel over it, the verification page | C1–C3 |
| `tools/sim` | N-million-hand run of basic strategy: realised house edge and its confidence interval | S4 |
| `tools/load` | many sessions playing basic strategy against a running server, money audited | P0 |

**PixiJS + GSAP, DOM controls.** The table — felt, shoe, cards in flight, chips — is a scene, and
Pixi is the studio-standard tool for it; GSAP is the studio-standard tool for choreography, and
here it is driven from the Pixi ticker so the whole screen runs on one clock. The action bar and
the bet panel are **DOM**, not Pixi: they are buttons, and DOM buttons come with focus, keyboard,
screen readers and text that wraps, for free. No React — the shell is small enough that a framework
would be the largest thing in it, and the crash project already shows React around a canvas.

### Dependency rules — enforced, not suggested

Enforced by `dependency-cruiser` ([`.dependency-cruiser.cjs`](.dependency-cruiser.cjs)) in
`pnpm lint:boundaries`, which `pnpm lint` and CI run — not by discipline. Each unit has an allow-list
matching this graph exactly; anything else in the workspace is an error.

```
money ──▶ (nothing)
cards ──▶ (nothing)
protocol ──▶ money, cards
fair ──▶ cards
engine ──▶ protocol, money, cards
strategy ──▶ cards
client-core ──▶ protocol, money
director ──▶ protocol, money, cards
renderer ──▶ cards
apps/server ──▶ engine, protocol, money, cards, fair
apps/web ──▶ client-core, director, renderer, protocol, money, cards, fair, strategy,
             engine (src/verify/ only)
tools/sim ──▶ engine, strategy, fair, cards, money, protocol
tools/load ──▶ client-core, strategy, protocol, money, cards
```

Hard rules on top of the graph:

- **`renderer` may not import `protocol`** (`renderer-deps`). It plays beats; it does not know what
  a reply is. This is the seam that lets the table be tested without a server and re-skinned without
  touching the game.
- **Pixi and GSAP stay on the stage** (`stage-libs-stay-on-stage`): `renderer` and `apps/web` only.
  The director writes choreography as data; timing is a number in a beat.
- **`engine` reaches `apps/web` only through `src/verify/`** (`engine-only-in-verify`). The
  verification page replays a settled hand through the engine; the game screen never runs it. A
  table that ran the engine could start deciding things.
- **`engine` takes the shoe as an argument** and does not import `fair` (`engine-deps`). The engine
  deals from an array; where the array came from is the server's business and the verifier's.
- **The load tool plays over the wire** (`load-deps`): `client-core`, never the engine.
- **No React anywhere** (`no-react`).
- **Nothing imports `apps/*`** (`nothing-imports-apps`).
- **No package may import from `../slots` or `../crash`** (`no-siblings`) — by relative path or by
  `@slot/*` / `@crash/*` name.
- **No package imports a Node builtin** (`packages-no-node-builtins`) **or a server library** —
  `fastify`, `pino`, the database (`packages-no-server-libs`). Node belongs to `apps/server` and
  `tools/*`.
- **A unit is reached through its entry point**, never its `src/` (`no-cross-package-deep-imports`).

**The rules are proven, not trusted.** `lint:boundaries` finding nothing in the real workspace says
nothing about whether a rule works, so [`config/fixtures/`](config/fixtures) holds deliberately
illegal imports and `tests/boundaries.test.ts` asserts each is rejected **by name** — and that the
legal allow-lists, the verification page's engine import among them, are not. A workspace import
resolves to the target's `dist/`, and the config *does not follow* `dist` rather than excluding it:
excluding it would delete the edge, and an illegal import would go quiet the moment its dependency
was declared (verified against the real workspace at S0: `renderer → protocol` and
`apps/web/src/table → engine`, both declared and built, are still errors).

### Purity rules for `engine`, `cards`, `fair`, `money`, `strategy`, `director`

Enforced by ESLint ([`eslint.config.mjs`](eslint.config.mjs), `PURE_PACKAGES`) and proven by
`tests/purity.test.ts`, which lints one impure fixture per package — a package dropped from the list
is the likeliest way for the rule to stop applying:

- No `Date.now()`, `new Date()`, `performance.now()`. **Time is a parameter** — the engine stamps
  nothing, and the director's durations are numbers, not clocks.
- No `Math.random()`. Randomness enters only as seeds, through `fair`.
- No I/O, no globals, no ambient config — `fetch`, `window`, `document`, `localStorage`, `process`
  are lint errors. `fair`, `cards` and `engine` must run unchanged in Node and in the browser: the
  verifier depends on it.

The compiler holds the same line: the base tsconfig has **no DOM lib and no Node types**, so a pure
package — and `protocol` and `client-core`, which must also run anywhere — cannot name `document` or
`Buffer` without failing to build. `renderer` and `apps/web` opt into the DOM
(`config/tsconfig-dom.json`); `apps/server` and `tools/*` into Node (`config/tsconfig-node.json`).

### The round lives in the engine, the table lives in the server

`apps/server` owns sessions, wallets, seeds, persistence and HTTP. For each request it loads the
round, regenerates the shoe from its seeds, calls `engine.step(state, command, shoe)`, and persists
the new state, the events, the reply and the money **in one transaction before replying**. The
engine returns; it never writes. That is what lets `tools/sim` play millions of hands through the
code that serves the demo, and the verifier replay one.

### The client: truth, script, stage

```
HTTP reply ──▶ client-core (truth: snapshot, balance, commit)
                    │
                    ├──▶ director (previous snapshot + events → Beat[])  ──▶ renderer (Pixi + GSAP)
                    │                                                        │
                    └──▶ DOM action bar  ◀── decision gate: open when the ──┘
                                              timeline reaches the decision beat
```

- `client-core` holds the truth and nothing else; it is the only thing that talks to the server.
- `director` writes the script. It is where pacing lives (a card's travel, the pause before the
  dealer draws, the order hands settle in), where the beat-gated balance is computed, and where every
  script is proved to end in a picture of the new snapshot.
- `renderer` is the stage. Every beat has an animated path and a snap-to-end path; skip, a hidden
  tab, a reconnect and a reload all take the snap.

### Testing layers

| Layer | What it proves | Block |
| --- | --- | --- |
| Unit | `cards.value` against a brute-force oracle over every two-card hand and every three-card hand of ranks; `money` exact at every ratio the game uses, refusing every inexact one; SHA-256 and HMAC against the FIPS 180-4 and RFC 4231 vectors; `below` rejecting exactly the words it must; the schemas refusing every invariant break | ✅ S1 |
| Golden | the first 20 cards for 30 seed pairs, and all 312 for one, from [`packages/fair/golden/shuffle.py`](packages/fair/golden/shuffle.py) — Python's `hashlib` and `hmac`, written from the protocol document. `tests/golden-fresh.test.ts` reruns it and requires the committed fixture byte for byte, so the vectors cannot drift by hand | ✅ S1 |
| Uniformity | χ² over 240,000 shuffles of four items (all 24 orders) and over 20,000 full shoes (one tagged card's position) — the rejection step proven by test, not assumed | ✅ S1 |
| Engine | every transition and refusal on stacked shoes · `allowed` against an oracle written from §4.2 at every decision of 10,000 hands under random rule sets, and `act` accepting exactly it · 100,000 seeded hands of random legal play: every snapshot and event parsed, events folding to the snapshot, money conserved at every step · 10,000 hands replayed from their decisions alone | ✅ S2 |
| Statistical | `tools/sim`: basic strategy over ≥10⁷ hands, realised edge within 3σ of the published figure for these rules | S4 |
| Choreography | `director`: every event sequence ends in its snapshot's picture; skip from any beat lands there too | C1 |
| Integration | a real server, two tabs on one hand, lost replies, restart mid-hand | S3, P0 |
| E2E | Playwright: a forced split into four hands with a double and a dealer bust, played through the real UI, then verified in the browser | P1 |

## Commands

Everything runs from the repo root on Node ≥ 20.19 (CI uses 22) and pnpm 10. The one command before
every commit:

```bash
pnpm check
```

| Command | What it does |
| --- | --- |
| `pnpm check` | lint → build → typecheck → unit tests → root suites → format check. **What CI runs.** |
| `pnpm lint` | ESLint (purity, type-safety) and `lint:boundaries` |
| `pnpm lint:boundaries` | dependency-cruiser over `packages/`, `apps/`, `tools/` |
| `pnpm build` | `tsc` to `dist/` per unit, in dependency order (Turborepo) |
| `pnpm typecheck` | the root suites' tsconfig, then every unit's |
| `pnpm test` | each unit's own `src/**/*.test.ts` (`config/vitest.package.ts`) |
| `pnpm test:root` | `tests/` — the rules proven against `config/fixtures/`, the protocol document held to the schemas, and the golden fixture held to its generator (needs `python3`, standard library only) |
| `pnpm format` | Prettier. Markdown is excluded: the canon is hand-wrapped |

Units resolve each other through their built `dist/` and package `exports`, ordered by Turborepo's
`^build` — not through TypeScript project references, which would duplicate what Turborepo already
orders. `build` therefore runs before `typecheck` and the tests.

Still to come: `pnpm dev` (server + web, watch mode) with **S3/C1**, and
`pnpm sim -- --hands 10000000` (the realised edge) with **S4**.

A pre-commit hook (husky → lint-staged) runs ESLint and Prettier over staged files. `turbo.json`
sets `agentGuidance: false`: Turborepo ≥ 2.11 otherwise writes an `AGENTS.md` whenever it detects an
AI agent, and this file is where the repository's guidance lives.

## Gaps & missing pieces

Log what you hit here as you hit it ([Rule 1](#rule-1--log-the-gaps-you-hit)). Open at time of
writing:

- **The published house edge for these rules.** Six decks, S17, DAS, split to four hands, no
  resplit aces, no surrender, peek, split by value. Published calculators put rule sets like this
  near 0.4%; the exact figure for *this* set is pinned in **S4** from a published source and
  confirmed by the sim — do not quote a number before then.
- **Basic strategy for split-by-value and four hands.** Standard charts assume the usual rules. **S4**
  confirms the table against the engine (per-cell EV by simulation where the chart is in doubt)
  before the sim's edge is believed.
- **Pace.** How long a card travels, the pause before the dealer's draws, the gap between hands
  settling — **C1** sets the numbers by feel and by a measured round length, and writes them down.
- **Four split hands in portrait.** Four hands of up to six cards each, a dealer row and a shoe, on a
  phone held upright. A real layout problem, not a detail — **C2**.
- **Card art.** Drawn at boot into an atlas by Pixi `Graphics` + text, or SVG rasterised once.
  **C1** picks by measured boot time and sharpness at 3× DPR.
- **The host.** The sibling projects run on Render's free tier: no disk, asleep after 15 idle
  minutes. Here an open round lives in SQLite; on a diskless host a restart drops open rounds and
  wallets together, which is honest for a demo but must be said. **P1** decides and writes an ADR.

## Rules

### Rule 0 — Keep this file updated after every change

When a block lands, rewrite its sections here in the **present tense** in the **same change**, and
tick it off in [`ROADMAP.md`](ROADMAP.md). A section describing an intent the code no longer has is
worse than no section: the next reader trusts it.

If the code diverged from the plan, the plan is what's wrong. Fix the document, and if the
divergence touched a pinned decision, write or amend an ADR.

### Rule 1 — Log the gaps you hit

When you hit something the canon doesn't answer, add it to **Gaps & missing pieces** with the block
that should close it — then keep working. Delete the entry in the change that fills it. The list is
a work queue, not an archive.

### Other rules

- **The protocol document and `packages/protocol` change together**, in one commit, always.
- **No `any`, no non-null `!`, no `as` outside a parser boundary.** `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; the bans are lint errors in every unit's
  source, proven by a fixture. `as const` stays legal.
- **Every request and reply is parsed with its zod schema at the boundary**, on both sides. The
  server does not trust the client; the client does not trust the server either — a mismatch is
  deploy skew, worth failing loudly on.
- **Never log, return or render a face-down card or an unrevealed server seed** — including in
  errors, traces, debug panels and the network lab. This is the one leak with no recovery.
- **Money never touches a float.** Stakes are multiples of an even `betUnit`; `money.payout` refuses
  an inexact product rather than rounding it.
