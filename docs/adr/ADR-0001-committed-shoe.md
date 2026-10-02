# ADR-0001 — The shoe is committed before the bet, shuffled with the player's seed, and dealt face-down off the wire

- **Status:** accepted
- **Date:** 2026-10-02
- **Applies to:** the whole repository. Every other decision is downstream of this one.

## Context

A blackjack round is decided by the order of the cards in the shoe. The server holds that order, the
player never sees it, and two cards of it — the dealer's hole card and the next card off the top —
are worth more to the player than anything else in the game. That gives the server two ways to
cheat that the player cannot see:

1. **Choose the order late.** Draw each card when it is needed — after seeing the stake, after
   seeing the player stand on 16 — and pick the one that wins for the house. From the outside this
   looks exactly like an honest random draw. There is no artefact anyone can check afterwards.
2. **Choose the order early, knowing the bet.** Shuffle once, but only after the stake is on the
   table, and reshuffle until the shoe is a bad one for this player.

And it gives the *client* one way to leak what it must not: a card sent to the browser before it is
face up is a card the player can read in DevTools. A hole card on the wire, even "hidden" by a CSS
class, ends the game.

The sibling crash project answers its version of (1) and (2) with a hash chain committed in advance
and a seed revealed per round (its ADR-0001). That fits a round every player shares: no single
player can be allowed to contribute to it. Blackjack here is **single-player** — one seat against
the dealer — so the player *can* contribute, and should.

## Decision

**Every round's shoe is a deterministic shuffle of six decks from two seeds: a server seed the
server committed to before the player chose anything, and a client seed the player chose after
seeing that commit. The client receives a card only when it is face up. The server seed is revealed
when the round settles.**

Concretely:

- **The commit comes first.** The server draws a fresh 32-byte `serverSeed` from a CSPRNG for the
  *next* round and publishes `commit = SHA-256(serverSeed)` before that round exists — in the session
  reply and in every settled round's reply ([`docs/protocol.md`](../protocol.md) §3).
- **The player's seed comes second.** The client sends a `clientSeed` (its own random value by
  default, or one the player typed) **and the commit it was shown** with the deal request. The server
  refuses a deal naming any commit but the current one, so the commit a round was played under is
  provably the one the player saw before choosing.
- **The shoe is a pure function of the two seeds**: six decks in a fixed canonical order, shuffled by
  Fisher–Yates driven by an `HMAC-SHA256(serverSeed, clientSeed:counter)` byte stream with rejection
  sampling, so every one of the `312!` orders is reachable and none is favoured
  ([`docs/protocol.md`](../protocol.md) §3.2). Implemented once in
  [`packages/fair`](../../packages/fair), **isomorphic**, used by the server to deal and by the
  browser's verification page to check, never re-implemented.
- **Cards are dealt from the top in a fixed order**: player, dealer up, player, dealer hole — then
  every hit, double and split card in the order the player's decisions call for them, then the
  dealer's draws. The position of every card a round used is a function of the decisions taken, so
  the verifier can replay them.
- **A fresh shoe every round.** No penetration, no cut card, no state carried between rounds — the
  equivalent of a continuous shuffling machine. A round is verifiable on its own, and resuming one
  after a restart needs only its two seeds and its decisions.
- **Face-down never travels.** The dealer's hole card is not in any reply, snapshot, log line or
  error until it is turned. Neither is any card still in the shoe. The round snapshot names the hole
  card's *existence* (`holeHidden: true`), never its value. The peek for dealer blackjack happens
  on the server, and what reaches the client is its one-bit result — which is the rule of the game,
  not a leak.
- **The reveal settles the round.** The settled round carries `serverSeed`; the client checks
  `SHA-256(serverSeed) == commit` and can replay the whole hand — shoe, every card, every payout —
  through the same `engine` the server ran.

## Consequences

**Good**

- The server cannot choose the order late: the order exists before the first card, fixed by a commit
  the player saw. It cannot choose it early against this bet either: the commit predates the stake
  and the client seed, and the client seed is mixed into every card.
- A round is checkable alone, immediately, by the player who just lost it. No chain to walk, no wait
  for a rotation, no trust in the operator, this document, or the demo's uptime.
- The engine stays pure: it is handed a shoe as an array and deals from it. There is no RNG anywhere
  in a running round, so a hand reproduces from its seeds and its decisions — in tests, in
  `tools/sim`, and in the verifier.
- Card counting is moot by construction (a fresh shoe every round), which lets the published house
  edge be one number rather than a function of shoe depth.

**Costs, accepted**

- The next round's server seed is live state between rounds: it must persist with the session, or a
  restart that forgets it must publish a new commit — which the client sees and the deal refuses
  until it has re-chosen against it. Never deal a commit the player did not see.
- Six decks shuffled per round is 311 draws of HMAC-backed randomness per deal. Measured cost is
  S1's job; it is microseconds of SHA-256, but it is not free.
- "Face-down never travels" constrains the client: it cannot pre-load the hole card's face, so the
  flip animation waits on the reply that carries it. The presentation is built around that
  ([ADR-0002](ADR-0002-presentation-lags-truth.md)).

## Alternatives rejected

- **Draw each card from a CSPRNG when it is needed.** Unverifiable, and the precise shape of the
  accusation every losing player makes. Nothing is gained.
- **A crash-style hash chain, no client seed.** It proves the server did not change its mind, but in
  a single-player game the server still picked every seed knowing who would play it. The client
  seed closes that, and a single-player game is the one place it can be had.
- **Commit to the shoe itself (hash of the card order) per round.** It proves the order did not
  change, not that it was not chosen against the player. Seeds plus a client contribution prove
  both.
- **Send the hole card encrypted, key revealed later.** Encryption in the browser is a key in the
  browser. The only card the client cannot read is one it does not have.
- **A persistent shoe with penetration, as in a casino.** Realistic, and it makes every round's odds
  depend on the ones before it, the verifier stateful, and the published edge a range. Not worth it
  for a game whose point is that one round checks alone.
