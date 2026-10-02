# Simulation results

What `tools/sim` measured, kept beside the code that measured it. Regenerate with the commands
shown; every run is deterministic for its seed.

## The realised edge — `pnpm sim -- --hands 10000000 [--seed <s>]`

Basic strategy ([`packages/strategy`](../../packages/strategy)) through the engine, one unit a
round, every round dealt from the protocol's own shuffle of a fresh six-deck shoe (server seed
`SHA-256("<seed>:<index>")`, client seed `"sim"`). 12 threads on an M-series laptop, ≈190 s and
≈53,000 rounds/s a run.

| Seed | Rounds | Realised edge (±1σ) | vs published |
| --- | --- | --- | --- |
| `blackjack-sim` (the default) | 10⁷ | 0.4987 % ± 0.0365 % | +2.53σ |
| `second-run` | 10⁷ | 0.4238 % ± 0.0365 % | +0.48σ |
| `third-run` | 10⁷ | 0.4215 % ± 0.0365 % | +0.42σ |
| **pooled** | **3 · 10⁷** | **0.4480 % ± 0.0211 %** | **+1.98σ** |

**Published:** 0.40622 % — Wizard of Odds' [Blackjack House Edge
Calculator](https://wizardofodds.com/games/blackjack/calculator/), "basic strategy with continuous
shuffler", read 2026-10-02 for: 6 decks · dealer stands on soft 17 · double any two · double after
split · resplit to 4 hands · no resplit or hitting of split aces · original bet only against a
dealer blackjack · no surrender · 3 to 2. That column is the one that describes this game: a fresh
shoe every round, total-dependent basic strategy. Its neighbours — a cut card (0.42622 %) and
perfect composition-dependent play (0.40312 %) — do not.

Every run is within 3σ, the ROADMAP's bar. The pooled estimate sits 2σ high, and almost all of
that is the first run; the other two agree with the published figure to half a σ. It is recorded
as an open question in [`CLAUDE.md`](../../CLAUDE.md) § Gaps rather than rounded away.

The full report of the default run, with the distribution of outcomes and how often each rule
fires, is [`edge.txt`](edge.txt).

## The chart against the engine — `pnpm sim -- --chart`

Every pair cell — the ten pairs, plus a king and a ten (split by value, D8) — against every up
card: each open action played on the **same** 20,000 shoes and finished with basic strategy, so the
difference between two actions has a far smaller variance than either result. A cell holds when no
other action beats the chart's by more than three standard errors of the paired difference.

All 110 cells hold ([`chart.txt`](chart.txt), 46 s). The close ones are the known close ones —
6-6 v 7 (split 0.033 ± 0.014 worse than the chart's hit), 7-7 v 8 and v T, 3-3 v 8 — and a king
with a ten never wants splitting: standing beats it by 0.18–0.56 units against every up card.
