/** Where everything sits, for a viewport and a number of hands. Pure — tested without Pixi. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly shoe: Point;
  /** The dealer's first card; the rest fan to its right. */
  readonly dealer: Point;
  /** Each hand's first card; its cards climb up and to the right of it. */
  readonly hands: readonly Point[];
  /** The step from one card of a hand to the next. */
  readonly fan: Point;
}

/** Card proportions: a poker card, 63 × 88 mm. */
export const CARD_RATIO = 88 / 63;

/** Each card of a hand sits this many card widths right of the one before. */
const FAN = 0.28;

/**
 * The felt for `width × height` CSS pixels and `count` hands. Cards are sized by the narrower of
 * two limits — a fifth of the width, an eighth of the height — so a phone held upright and a laptop
 * both get cards that read. With more hands than fit side by side the cards shrink to make room:
 * four split hands in portrait is C2's problem to finish (CLAUDE.md § Gaps); this keeps them on
 * screen.
 */
export function layout(width: number, height: number, count: number): Layout {
  const hands = Math.max(1, count);
  // A hand's footprint is its first card plus a fan of four more — five cards is most hands' most.
  const span = 1 + 4 * FAN;
  const gutter = 0.25;
  const byWidth = (width * 0.96) / (hands * span + (hands - 1) * gutter);
  const cardWidth = Math.round(Math.min(width / 5, (height / 8 / CARD_RATIO) * 1.4, byWidth, 120));
  const cardHeight = Math.round(cardWidth * CARD_RATIO);
  const fan = { x: Math.round(cardWidth * FAN), y: -Math.round(cardHeight * 0.16) };
  const step = cardWidth * (span + gutter);
  const total = cardWidth * (hands * span + (hands - 1) * gutter);
  const left = (width - total) / 2 + cardWidth / 2;
  return {
    width,
    height,
    cardWidth,
    cardHeight,
    shoe: { x: width - cardWidth * 0.8, y: height * 0.08 },
    dealer: { x: width / 2 - cardWidth * 0.6, y: height * 0.24 },
    hands: Array.from({ length: hands }, (_, i) => ({
      x: Math.round(left + i * step),
      y: Math.round(height * 0.66),
    })),
    fan,
  };
}

/** A card's centre: the `index`-th of a hand (or the dealer's row, which fans flat). */
export function cardAt(l: Layout, owner: 'dealer' | number, index: number): Point {
  if (owner === 'dealer') {
    return { x: l.dealer.x + index * Math.round(l.cardWidth * 0.62), y: l.dealer.y };
  }
  const base = l.hands[owner] ?? l.hands[0] ?? { x: 0, y: 0 };
  return { x: base.x + index * l.fan.x, y: base.y + index * l.fan.y };
}
