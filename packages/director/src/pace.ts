/**
 * How long things take, in milliseconds — numbers, not clocks (CLAUDE.md § Purity rules). Set by
 * feel in C1 and written down here; `script.test.ts` measures what they add up to over real rounds.
 */
export interface Pace {
  /** Clearing the last round and placing the stake. */
  readonly clear: number;
  /** A card from the shoe to its place. */
  readonly travel: number;
  /** The stillness after a card lands, before the next beat — a hold, not a motion. */
  readonly gap: number;
  /** The hole card turning over. */
  readonly flip: number;
  /** The dealer checking under an ace or a ten. */
  readonly peek: number;
  /** Before each card the dealer draws for themselves — the moment the table holds its breath. A hold. */
  readonly dealerPause: number;
  /** Chips moving: a double, a split's second stake, insurance. */
  readonly chips: number;
  /** A pair coming apart into two hands. */
  readonly split: number;
  /** The highlight moving to the next hand. */
  readonly active: number;
  /** A hand going over 21. */
  readonly bust: number;
  /** Each hand's result, left to right — a hold: nothing moves while it is read. */
  readonly settle: number;
}

export const NORMAL: Pace = {
  clear: 220,
  travel: 300,
  gap: 90,
  flip: 260,
  peek: 600,
  dealerPause: 450,
  chips: 260,
  split: 320,
  active: 160,
  bust: 320,
  settle: 380,
};

/** Every duration scaled — `scaled(NORMAL, 0)` is the E2E suite's instant pace. */
export function scaled(pace: Pace, factor: number): Pace {
  const at = (ms: number) => Math.round(ms * factor);
  return {
    clear: at(pace.clear),
    travel: at(pace.travel),
    gap: at(pace.gap),
    flip: at(pace.flip),
    peek: at(pace.peek),
    dealerPause: at(pace.dealerPause),
    chips: at(pace.chips),
    split: at(pace.split),
    active: at(pace.active),
    bust: at(pace.bust),
    settle: at(pace.settle),
  };
}

export const INSTANT: Pace = scaled(NORMAL, 0);

/**
 * Reduced motion (ADR-0002): nothing travels, turns or slides — every motion is zero long — but the
 * holds stay, so the round still happens one card at a time, in order, at a pace a person can read.
 * A card's travel becomes stillness after it (`gap`); the dealer still pauses before each draw, and
 * each result still gets its moment. Turbo is not a pace: it is the stage's `timeScale`, and the two
 * combine.
 */
export const REDUCED: Pace = {
  clear: 0,
  travel: 0,
  gap: NORMAL.travel,
  flip: 0,
  peek: 0,
  dealerPause: NORMAL.dealerPause,
  chips: 0,
  split: 0,
  active: 0,
  bust: 0,
  settle: NORMAL.settle,
};
