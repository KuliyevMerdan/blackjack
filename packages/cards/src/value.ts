import { isAce, isTenValue, points, type Card } from './card.js';

export interface HandValue {
  /** The best total: an ace counts 11 when that does not bust the hand, otherwise 1. */
  readonly total: number;
  /** An ace is counting 11 — a "soft" total, which one more card cannot bust. */
  readonly soft: boolean;
  /**
   * Exactly two cards, an ace and a ten-value. Whether that *is* a blackjack depends on where the
   * hand came from — a split hand's 21 is 21 (docs/protocol.md §4.1) — which the engine knows and
   * this function does not.
   */
  readonly natural: boolean;
  readonly bust: boolean;
}

/**
 * The value of a hand from the cards it shows (docs/protocol.md §4.1). The one piece of game logic
 * the client runs (CLAUDE.md § The invariant that makes the client honest): it reads a total off
 * cards the player was shown, with the same function the engine uses to decide one.
 *
 * At most one ace can ever count 11 — two would be 22 — so the soft total is the hard total plus
 * ten, taken when there is an ace and it fits.
 */
export function value(cards: readonly Card[]): HandValue {
  let hard = 0;
  let hasAce = false;
  for (const c of cards) {
    hard += points(c);
    if (isAce(c)) hasAce = true;
  }
  const soft = hasAce && hard + 10 <= 21;
  const total = soft ? hard + 10 : hard;
  const [first, second] = cards;
  const natural =
    cards.length === 2 &&
    first !== undefined &&
    second !== undefined &&
    ((isAce(first) && isTenValue(second)) || (isTenValue(first) && isAce(second)));
  return { total, soft, natural, bust: total > 21 };
}
