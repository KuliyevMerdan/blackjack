# Blackjack

A **single-player blackjack table** — stake, deal, insurance under an ace, then hit, stand, double
and split to four hands until the dealer plays. Node + TypeScript on the server, PixiJS + GSAP in the
browser, one HTTP request per decision.

> ⚠️ **Status (2026-10-02): the table serves and is measured; nothing draws it yet.** **S0–S4**
> and **C0** have landed — the workspace and its boundaries, the contracts, the round machine, the
> server (proven over 1,000 hands with two tabs, lost replies and restarts), basic strategy with a
> simulator (3·10⁷ rounds against the published 0.406 % house edge, [`docs/sim/`](docs/sim/README.md)),
> and the client core that holds the truth through a hostile network. See
> [`ROADMAP.md`](ROADMAP.md) — **C1**, the table on screen, is next.

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
