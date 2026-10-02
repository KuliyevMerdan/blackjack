/**
 * A card on the wire: two characters, rank then suit (docs/protocol.md §2.7). `"TD"` is the ten of
 * diamonds. The type is the exact set of 52 strings, so a typo is a compile error and a value from
 * outside has to come through `isCard`.
 */
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
export const SUITS = ['S', 'H', 'D', 'C'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

const RANK_SET: ReadonlySet<string> = new Set(RANKS);
const SUIT_SET: ReadonlySet<string> = new Set(SUITS);

export function isRank(value: string): value is Rank {
  return RANK_SET.has(value);
}

export function isSuit(value: string): value is Suit {
  return SUIT_SET.has(value);
}

export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    isRank(value.charAt(0)) &&
    isSuit(value.charAt(1))
  );
}

/** The one way into `Card` from a string: the card, or a throw naming what it was handed. */
export function card(value: string): Card {
  if (!isCard(value)) throw new RangeError(`not a card: ${JSON.stringify(value)}`);
  return value;
}

export function rankOf(c: Card): Rank {
  const rank = c.charAt(0);
  if (!isRank(rank)) throw new RangeError(`not a card: ${c}`);
  return rank;
}

export function suitOf(c: Card): Suit {
  const suit = c.charAt(1);
  if (!isSuit(suit)) throw new RangeError(`not a card: ${c}`);
  return suit;
}

/**
 * A card's points with the ace counted low: `A` is 1, `T J Q K` are 10. Whether an ace counts 11 is
 * a property of the hand, not the card — `value()` decides it.
 */
export function points(c: Card): number {
  const rank = rankOf(c);
  switch (rank) {
    case 'A':
      return 1;
    case 'T':
    case 'J':
    case 'Q':
    case 'K':
      return 10;
    default:
      return Number(rank);
  }
}

export function isAce(c: Card): boolean {
  return rankOf(c) === 'A';
}

export function isTenValue(c: Card): boolean {
  return points(c) === 10;
}

/**
 * Two cards that may be split together under `splitBy: "VALUE"` (docs/protocol.md D8): equal
 * points, so `K` and `T` pair, and aces pair only with aces.
 */
export function sameValue(a: Card, b: Card): boolean {
  return points(a) === points(b);
}

/**
 * The canonical shoe the shuffle starts from (docs/protocol.md §3.2): for each deck, suits in the
 * order `S H D C`, ranks `A` to `K`. Index 0 is `AS` of the first deck; with six decks, index 311
 * is `KC` of the last. The order is part of the contract — the shuffle permutes *positions*, so a
 * different starting order is a different shoe for the same seeds.
 */
export function canonicalShoe(decks: number): Card[] {
  if (!Number.isSafeInteger(decks) || decks < 1 || decks > 8) {
    throw new RangeError(`decks must be an integer from 1 to 8: ${decks}`);
  }
  const shoe: Card[] = [];
  for (let deck = 0; deck < decks; deck++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) shoe.push(`${rank}${suit}`);
    }
  }
  return shoe;
}
