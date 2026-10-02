import type { Card } from '@blackjack/cards';

/**
 * What the stage draws — declared here, in the stage's own words, because `renderer` may not see
 * `protocol` or `director` (`renderer-deps`). The director's `Picture` and `Cue` fit these shapes;
 * `apps/web` is where the compiler holds the two together.
 */
export interface StageHand {
  readonly cards: readonly Card[];
  readonly stake: number;
  readonly doubled: boolean;
  readonly state: 'PLAYING' | 'STOOD' | 'BUST' | 'BLACKJACK' | 'DONE';
  readonly result: 'WIN' | 'LOSE' | 'PUSH' | 'BLACKJACK' | null;
  readonly payout: number | null;
}

export interface StagePicture {
  /** `null` is a card lying face down. */
  readonly dealer: readonly (Card | null)[];
  readonly hands: readonly StageHand[];
  readonly active: number | null;
  readonly insurance: { readonly stake: number; readonly payout: number | null } | null;
}

/** A beat as the stage needs it: what kind of moment, and for a split, which hand came apart. */
export interface StageBeat {
  readonly kind: string;
  readonly hand?: number | null;
}

export interface StageCue {
  readonly beat: StageBeat;
  readonly at: number;
  /** How long the cue's motion lasts. */
  readonly ms: number;
  /** Stillness after it — counted into the script's length, never animated. */
  readonly hold?: number;
  readonly after: StagePicture;
}

export const EMPTY_PICTURE: StagePicture = { dealer: [], hands: [], active: null, insurance: null };
