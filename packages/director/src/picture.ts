import { value, type Card } from '@blackjack/cards';
import type { Round } from '@blackjack/protocol';

/** A card on the table: its code, or `null` while it lies face down. */
export type Face = Card | null;

export type HandState = 'PLAYING' | 'STOOD' | 'BUST' | 'BLACKJACK' | 'DONE';
export type Result = 'WIN' | 'LOSE' | 'PUSH' | 'BLACKJACK';

export interface HandPicture {
  readonly cards: readonly Card[];
  /** Minor units on the hand — the chips in front of it. */
  readonly stake: number;
  readonly doubled: boolean;
  readonly fromSplit: boolean;
  readonly state: HandState;
  readonly result: Result | null;
  readonly payout: number | null;
}

/**
 * What the table looks like — the stage's whole vocabulary, in cards, chips and marks. No phases, no
 * `allowed`, no ids: the renderer draws this and knows nothing of replies (`renderer-deps`).
 */
export interface Picture {
  /** The dealer's cards in the order dealt; the hole card is `null` until it turns. */
  readonly dealer: readonly Face[];
  readonly hands: readonly HandPicture[];
  readonly active: number | null;
  /** `null` when never offered or not yet decided; a stake of 0 is a decline. */
  readonly insurance: { readonly stake: number; readonly payout: number | null } | null;
}

export const EMPTY: Picture = { dealer: [], hands: [], active: null, insurance: null };

/** The picture of a snapshot — what the screen shows once every beat has played, or on a snap. */
export function pictureOf(round: Round | null): Picture {
  if (round === null) return EMPTY;
  const [up] = round.dealer.cards;
  return {
    dealer: round.dealer.holeHidden && up !== undefined ? [up, null] : [...round.dealer.cards],
    hands: round.hands.map((h) => ({
      cards: [...h.cards],
      stake: h.stake,
      doubled: h.doubled,
      fromSplit: h.fromSplit,
      state: h.state,
      result: h.outcome ?? null,
      payout: h.payout ?? null,
    })),
    active: round.activeHand,
    insurance:
      round.insurance === null
        ? null
        : { stake: round.insurance.stake, payout: round.insurance.payout ?? null },
  };
}

/** One step of the script. Each says what changes on the table; the cue says when and for how long. */
export type Beat =
  | { readonly kind: 'clear'; readonly stake: number }
  | { readonly kind: 'card'; readonly to: 'dealer' | number; readonly face: Face }
  | { readonly kind: 'flip'; readonly card: Card }
  | { readonly kind: 'peek'; readonly blackjack: boolean }
  | { readonly kind: 'offer' }
  | { readonly kind: 'insure'; readonly stake: number }
  | { readonly kind: 'insurancePaid'; readonly payout: number }
  | { readonly kind: 'split'; readonly hand: number; readonly stake: number }
  | { readonly kind: 'double'; readonly hand: number; readonly stake: number }
  | { readonly kind: 'stood'; readonly hand: number; readonly auto: boolean }
  | { readonly kind: 'bust'; readonly hand: number }
  | { readonly kind: 'active'; readonly hand: number | null }
  | {
      readonly kind: 'settle';
      readonly hand: number;
      readonly result: Result;
      readonly payout: number;
    }
  /** The decision gate: from here the decision in front of the player is on screen. */
  | { readonly kind: 'decision' };

/**
 * A beat applied to a picture — pure. The director's tests hold the chain of these to the next
 * snapshot's picture; the renderer animates from each `after` to the next.
 */
export function applyBeat(picture: Picture, beat: Beat): Picture {
  switch (beat.kind) {
    case 'clear':
      return {
        dealer: [],
        hands: [
          {
            cards: [],
            stake: beat.stake,
            doubled: false,
            fromSplit: false,
            state: 'PLAYING',
            result: null,
            payout: null,
          },
        ],
        active: null,
        insurance: null,
      };
    case 'card': {
      if (beat.to === 'dealer') return { ...picture, dealer: [...picture.dealer, beat.face] };
      if (beat.face === null) throw new RangeError('a player card is never face down');
      const card = beat.face;
      return withHand(picture, beat.to, (h) => {
        const cards = [...h.cards, card];
        // A natural on a hand not born of a split is a blackjack (docs/protocol.md §4.1).
        const state = !h.fromSplit && value(cards).natural ? 'BLACKJACK' : h.state;
        return { ...h, cards, state };
      });
    }
    case 'flip':
      return { ...picture, dealer: picture.dealer.map((f, i) => (i === 1 ? beat.card : f)) };
    case 'insure':
      return { ...picture, insurance: { stake: beat.stake, payout: null } };
    case 'insurancePaid':
      return {
        ...picture,
        insurance: { stake: picture.insurance?.stake ?? 0, payout: beat.payout },
      };
    case 'split': {
      const hand = handAt(picture, beat.hand);
      const [first, second] = hand.cards;
      if (first === undefined || second === undefined) throw new RangeError('nothing to split');
      const hands = [...picture.hands];
      hands.splice(
        beat.hand,
        1,
        { ...hand, cards: [first], fromSplit: true },
        {
          ...hand,
          cards: [second],
          stake: beat.stake,
          fromSplit: true,
        },
      );
      return { ...picture, hands };
    }
    case 'double':
      return withHand(picture, beat.hand, (h) => ({
        ...h,
        stake: h.stake + beat.stake,
        doubled: true,
      }));
    case 'stood':
      return withHand(picture, beat.hand, (h) => ({ ...h, state: beat.auto ? 'DONE' : 'STOOD' }));
    case 'bust':
      return withHand(picture, beat.hand, (h) => ({ ...h, state: 'BUST' }));
    case 'active':
      return { ...picture, active: beat.hand };
    case 'settle':
      return withHand(picture, beat.hand, (h) => ({
        ...h,
        result: beat.result,
        payout: beat.payout,
      }));
    case 'peek':
    case 'offer':
    case 'decision':
      return picture;
    default: {
      const unhandled: never = beat;
      throw new RangeError(`unknown beat ${JSON.stringify(unhandled)}`);
    }
  }
}

function handAt(picture: Picture, index: number): HandPicture {
  const hand = picture.hands[index];
  if (hand === undefined) throw new RangeError(`no hand ${index}`);
  return hand;
}

function withHand(
  picture: Picture,
  index: number,
  change: (hand: HandPicture) => HandPicture,
): Picture {
  const hand = handAt(picture, index);
  return { ...picture, hands: picture.hands.map((h, i) => (i === index ? change(hand) : h)) };
}
