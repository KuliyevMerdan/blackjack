# ADR-0002 — The presentation lags the truth, and never leads it

- **Status:** accepted
- **Date:** 2026-10-02
- **Applies to:** `client-core`, `director`, `renderer`, `apps/web`.

## Context

The server answers a decision in tens of milliseconds. A player needs a second or two to *see* what
that answer was: the card slides from the shoe, turns, the total changes, and after a stand the
dealer's hole card flips, the dealer draws three cards one by one, and the hands settle left to
right. One reply from the server — "stand" — can carry the whole end of the round.

So at any moment there are two versions of the round in the client: the **truth** (the last
snapshot the server sent) and **what is on screen** (somewhere behind it, catching up). Every bug
class this game can have on the client lives in the gap between them:

- a button pressed while the card it depends on is still in the air, acting on a hand the player has
  not seen yet;
- a balance that shows the payout before the card that won it has landed;
- a reload or reconnect mid-animation that either replays the round from the start or jumps with no
  explanation;
- a refusal arriving while the optimistic part of an animation is already playing;
- a hidden tab coming back with five seconds of tweens due at once.

The naive arrangement — animate, and update the state when the animation finishes — makes the
animation the truth. Then a dropped frame, a killed tween or a navigation is a wrong balance.

## Decision

**The client holds the server's snapshot as the only truth, updated the instant a reply arrives. The
presentation is a separate, disposable script that catches the screen up to that truth. Input is
offered only for decisions the screen has already shown.**

Concretely:

- **`client-core` owns the truth.** Every reply replaces the round snapshot and the balance
  wholesale. Nothing in the client computes a hand's legal moves, a payout or a balance; the
  snapshot carries `allowed` actions and every amount ([`docs/protocol.md`](../protocol.md) §2).
- **Every reply carries both the new snapshot and the events that led to it** — `cardDealt`,
  `holeRevealed`, `handSettled`… — and the events are a proof of the snapshot: applying them to the
  previous one must produce it exactly. Dev builds assert this on every reply and throw on a
  mismatch, so a server that lies about what happened, or a client that misreads it, fails loudly.
- **`packages/director` turns events into beats** — a pure function `(previous snapshot, events,
  pace) → Beat[]`: deal this card to that hand, flip the hole card, move these chips, show this
  result. Beats are plain data with durations. No Pixi, no GSAP, no clock — so the choreography is
  unit-tested headless, and every beat sequence is checked to end in a picture of the new snapshot.
- **`packages/renderer` plays beats** with Pixi and one GSAP timeline per reply, driven from the Pixi
  ticker — one clock for the whole screen. It knows cards and positions, not messages.
- **The decision gate.** The action bar is enabled only when the timeline has reached the beat at
  which the current decision exists on screen — the player's second card face up, the active hand
  highlighted. Before that it is disabled, not hidden, so the layout does not jump.
- **Skip is always available.** A tap on the table, or a key, completes the current timeline
  (`progress(1)`): the screen snaps to the truth it was heading for. A hidden tab, a reconnect and a
  reload do the same — they render the snapshot directly, with no replay.
- **Optimism is cosmetic and reversible.** On Double or Split the chips start moving the moment the
  button is pressed, because that is the player's own action and its latency is felt. Cards never
  move before the server has dealt them. If the server refuses, the chips go back and the refusal is
  said in words. Money shown never moves optimistically: the balance changes only when the beat
  that earns it plays.
- **The balance is beat-gated too.** The HUD shows the truth's balance minus the payouts whose
  beats have not yet played, so the number goes up when the winning card lands — and when the
  timeline is skipped, it is the truth's balance at once. The arithmetic is the director's, tested;
  the HUD never adds.

## Consequences

**Good**

- A wrong balance needs a wrong snapshot. Killing an animation, losing a frame, navigating away or
  reloading cannot change money on screen, because the animation never owned money.
- Reconnect and resume are the same code as skip: render the snapshot. There is no catch-up replay to
  get wrong, and a hand resumed after a server restart looks like a hand resumed after a reload.
- The choreography is testable without a browser: a split into four hands with a dealer bust is a
  unit test on `director` that asserts the beat list and the picture it ends on.
- Pace is a parameter. Turbo mode is a `timeScale`; reduced motion is a pace with zero-length
  travels; the E2E suite runs at instant pace and asserts the same pictures.

**Costs, accepted**

- Every event type needs a beat, and every beat a renderer implementation and a "snap to end"
  implementation that agree. That is two code paths per beat, held together by tests that end both
  in the same picture.
- The decision gate makes a fast player wait for animation they may not want. The answer is skip and
  turbo, not opening the gate early — an early gate is a decision on a hand the player has not seen.
- The server must send events, not just snapshots. The wire is larger, and the engine must emit
  events it could otherwise keep to itself. They are the same events the verifier replays, so the
  cost is paid once.

## Alternatives rejected

- **Animate, then commit the state.** Makes the animation the source of truth; every interruption is
  a correctness bug.
- **Diff snapshots on the client to derive the animation.** A diff loses order: after a split, a
  double and a dealer draw, two snapshots do not say which card arrived first. The server knows the
  order; it says so.
- **Queue the player's inputs during animation and apply them after.** A buffered "hit" pressed
  while the previous card was in flight is a decision on a total the player did not see. Skip is the
  honest way to go faster.
- **Let the server pace the round** (send the dealer's draws one by one with delays). Ties the
  presentation to the network, makes turbo a server feature, and makes a slow link look like a slow
  dealer.
