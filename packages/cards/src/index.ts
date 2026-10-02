/**
 * @blackjack/cards — card codes, the canonical shoe, and the value of a hand.
 *
 * Pure and tiny, and shipped to both sides: the engine decides with `value()`, the client reads a
 * total off the cards it was shown with the same function, and the shuffle in `@blackjack/fair`
 * starts from `canonicalShoe()`.
 */
export {
  RANKS,
  SUITS,
  type Rank,
  type Suit,
  type Card,
  isRank,
  isSuit,
  isCard,
  card,
  rankOf,
  suitOf,
  points,
  isAce,
  isTenValue,
  sameValue,
  canonicalShoe,
} from './card.js';
export { value, type HandValue } from './value.js';
