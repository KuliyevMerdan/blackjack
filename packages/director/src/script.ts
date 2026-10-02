import type { GameEvent, Round } from '@blackjack/protocol';
import type { Pace } from './pace.js';
import { applyBeat, pictureOf, type Beat, type Picture } from './picture.js';

/** A beat with its place in time, the table after it, and the balance the HUD may show by then. */
export interface Cue {
  readonly beat: Beat;
  /** Milliseconds from the start of the script. */
  readonly at: number;
  /** How long the beat's motion lasts — what the stage animates over. */
  readonly ms: number;
  /** Stillness after the motion, before the next cue may start (a card's `gap`). */
  readonly hold: number;
  readonly after: Picture;
  /** The truth's balance less every payout whose beat has not played yet (ADR-0002). */
  readonly hud: number;
}

export interface Script {
  readonly from: Picture;
  readonly to: Picture;
  readonly cues: readonly Cue[];
  /** When the last cue ends. */
  readonly duration: number;
  /** The HUD before the first cue. */
  readonly hudBefore: number;
}

/**
 * `(previous, events, pace) → Script` — the reply's events as beats with durations (ADR-0002). Pure:
 * no clock, no Pixi, no GSAP, so every script is a unit test. The script ends in the picture of
 * `next`; `script.test.ts` proves it for every step of thousands of real rounds.
 *
 * `balance` is the truth's balance after the reply. The HUD walks up to it payout by payout as the
 * results play — never ahead of the card that won the money.
 */
export function direct(
  previous: Round | null,
  events: readonly GameEvent[],
  next: Round,
  balance: number,
  pace: Pace,
): Script {
  const beats = events.flatMap(beatsOf);
  if (next.phase !== 'SETTLED') beats.push({ kind: 'decision' });

  const unpaid = beats.reduce((sum, b) => sum + payoutOf(b), 0);
  let hud = balance - unpaid;
  const from = previous === null ? pictureOf(null) : pictureOf(previous);
  let picture = from;
  let clock = 0;
  let last: Beat | null = null;
  const cues: Cue[] = [];
  for (const beat of beats) {
    clock += waitBefore(beat, last, pace);
    const ms = durationOf(beat, pace);
    const hold = holdAfter(beat, pace);
    picture = applyBeat(picture, beat);
    hud += payoutOf(beat);
    cues.push({ beat, at: clock, ms, hold, after: picture, hud });
    clock += ms + hold;
    last = beat;
  }
  return { from, to: picture, cues, duration: clock, hudBefore: balance - unpaid };
}

function beatsOf(event: GameEvent): Beat[] {
  switch (event.type) {
    case 'roundStarted':
      return [{ kind: 'clear', stake: event.stake }];
    case 'cardDealt':
      return [{ kind: 'card', to: event.to, face: event.card }];
    case 'holeDealt':
      return [{ kind: 'card', to: 'dealer', face: null }];
    case 'insuranceOffered':
      return [{ kind: 'offer' }];
    case 'insuranceDecided':
      return [{ kind: 'insure', stake: event.stake }];
    case 'dealerPeeked':
      return [{ kind: 'peek', blackjack: event.blackjack }];
    case 'handSplit':
      return [{ kind: 'split', hand: event.hand, stake: event.stake }];
    case 'handDoubled':
      return [{ kind: 'double', hand: event.hand, stake: event.stake }];
    case 'handStood':
      return [{ kind: 'stood', hand: event.hand, auto: event.auto }];
    case 'handBusted':
      return [{ kind: 'bust', hand: event.hand }];
    case 'activeHandChanged':
      return [{ kind: 'active', hand: event.hand }];
    case 'holeRevealed':
      return [{ kind: 'flip', card: event.card }];
    case 'handSettled':
      return [{ kind: 'settle', hand: event.hand, result: event.outcome, payout: event.payout }];
    case 'insuranceSettled':
      return [{ kind: 'insurancePaid', payout: event.payout }];
    case 'roundSettled':
      return []; // every result has played by now; the seed's reveal is the verifier's, not the felt's
    default: {
      const unhandled: never = event;
      throw new RangeError(`unknown event ${JSON.stringify(unhandled)}`);
    }
  }
}

function payoutOf(beat: Beat): number {
  return beat.kind === 'settle' || beat.kind === 'insurancePaid' ? beat.payout : 0;
}

function durationOf(beat: Beat, pace: Pace): number {
  switch (beat.kind) {
    case 'clear':
      return pace.clear;
    case 'card':
      return pace.travel;
    case 'flip':
      return pace.flip;
    case 'peek':
      return pace.peek;
    case 'insure':
    case 'insurancePaid':
    case 'double':
      return pace.chips;
    case 'split':
      return pace.split;
    case 'stood':
      return beat.auto ? 0 : pace.active;
    case 'bust':
      return pace.bust;
    case 'active':
      return pace.active;
    case 'settle': // a result is read, not watched: nothing moves, the table holds still for it
    case 'offer':
    case 'decision':
      return 0;
    default: {
      const unhandled: never = beat;
      throw new RangeError(`unknown beat ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Stillness after a beat's motion: a card lands and the table breathes; a result is read. */
function holdAfter(beat: Beat, pace: Pace): number {
  if (beat.kind === 'card') return pace.gap;
  if (beat.kind === 'settle') return pace.settle;
  return 0;
}

/** The dealer's own draws wait a beat each — after the turn, and after each other. */
function waitBefore(beat: Beat, last: Beat | null, pace: Pace): number {
  const dealerDraw = beat.kind === 'card' && beat.to === 'dealer' && beat.face !== null;
  const afterTurn = last?.kind === 'flip' || (last?.kind === 'card' && last.to === 'dealer');
  return dealerDraw && afterTurn ? pace.dealerPause : 0;
}
