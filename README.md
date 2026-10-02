# Blackjack

A **single-player blackjack table** — stake, deal, insurance under an ace, then hit, stand, double
and split to four hands until the dealer plays. Node + TypeScript on the server, PixiJS + GSAP in the
browser, one HTTP request per decision.

> ⚠️ **Status (2026-10-02): the game is whole and hardened; the deploy comes next.** **S0–S4**,
> **C0–C3** and **P0** have landed — the contracts, the round machine, the server, basic strategy
> and a simulator ([`docs/sim/`](docs/sim/README.md)), and the table: Pixi + GSAP on one clock, a
> decision gate, splits to four hands on a phone held upright, a Double's chips sent at the press
> and sent back on a refusal, keys and screen-reader words for every decision, a history whose
> every hand verifies in the browser. Hardened: a network lab that loses your replies after the
> move applied, two tabs kept in step, and a 30-minute soak of 200 sessions with faults on and the
> server SIGKILLed under it, audited to zero findings ([`docs/load/`](docs/load/README.md)).
> `pnpm dev` to play it locally. See [`ROADMAP.md`](ROADMAP.md) — **P1**, the deploy, is next.

## What makes it interesting to build

Not the felt. The gap between what the server knows and what the screen shows.

- **A round is a tree of decisions**, each a round trip: split into up to four hands, double on any
  of them, insurance under an ace. Every request names the version of the hand it was decided on and
  carries its own idempotency key, so a double tap, a second tab or a lost reply never becomes a
  second card.
- **The presentation lags the truth, and never leads it.** The server's reply is applied at once; the
  animation is a separate script, built from the events in that reply, that catches the screen up.
  Buttons open only for a decision the screen has already shown, and skip, reload and reconnect all
  land on the same picture ([ADR-0002](docs/adr/ADR-0002-presentation-lags-truth.md)).
- **Face-down never travels.** The dealer's hole card is not in the browser until it turns — not in a
  reply, a log line or DevTools.
- **Provably fair, with the player's own seed.** The server commits to its seed before the player
  picks theirs; six decks are shuffled from both, fresh every round; and the settled hand is replayed
  in the browser through the same engine the server ran
  ([ADR-0001](docs/adr/ADR-0001-committed-shoe.md)).

## Documents

| File | What it is |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | The canon — architecture, packages, rules. Kept current as code lands. |
| [`ROADMAP.md`](ROADMAP.md) | The task map — blocks, gates, `Done when`. |
| [`docs/protocol.md`](docs/protocol.md) | The wire contract — every endpoint, reply and event, the shuffle, the rules. |
| [`docs/adr/`](docs/adr) | The decisions that everything else is downstream of. |

Play money only. No real money, no payments, no crypto — a visible 18+/demo notice instead.
