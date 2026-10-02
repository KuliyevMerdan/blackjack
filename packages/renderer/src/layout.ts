/** Where everything sits, for a viewport and the cards on the table. Pure — tested without Pixi. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How many cards each owner holds — all a layout needs to know about a picture. */
export interface Shape {
  readonly dealer: number;
  readonly hands: readonly number[];
}

/**
 * The felt's free band, in CSS pixels from the top: below the HUD, above the controls. The app
 * measures its DOM and hands these in; without them a layout assumes a HUD and a control bar of a
 * phone's usual size. `right`, from the left edge, when the controls stand in a column beside the
 * felt instead of under it — a phone held sideways, too short for a bar under the table.
 */
export interface Insets {
  readonly top: number;
  readonly bottom: number;
  readonly right?: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  /** The felt's width: `width`, less a column of controls at the right. */
  readonly felt: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  /** Hands per row, and how many rows: four hands on a phone held upright take two. */
  readonly columns: number;
  readonly rows: number;
  readonly shoe: Point;
  /** The dealer's first card; the rest fan flat to its right, `dealerStep` apart. */
  readonly dealer: Point;
  readonly dealerStep: number;
  /** Each hand's first card; its cards climb up and to the right of it, `fans[i]` a step. */
  readonly hands: readonly Point[];
  readonly fans: readonly Point[];
  /** A chip's radius — a stake's stack sits under the first card of its hand. */
  readonly chip: number;
  /** Where the player's chips come from: below the felt, under the controls. */
  readonly bank: Point;
  /** The felt between the HUD and the controls — nothing is drawn outside it. */
  readonly top: number;
  readonly bottom: number;
}

/** Card proportions: a poker card, 63 × 88 mm. */
export const CARD_RATIO = 88 / 63;

/** Each card of a hand sits this many card widths right of the one before… */
const FAN_X = 0.28;
/** …and this many card heights above it. */
const FAN_Y = 0.16;
/** A hand is laid out for six cards; a seventh and beyond close the fan up rather than grow it. */
const ROOM = 6;
/** The space between two hands, in card widths. */
const GUTTER = 0.25;
/** Room under a hand's first card for its chips and its total, and under the dealer's for theirs. */
const UNDER = 40;
const DEALER_UNDER = 40;

/**
 * The felt for `width × height` CSS pixels and the cards in `shape`.
 *
 * The felt is three bands between the HUD and the controls (which are DOM, over the canvas): the
 * dealer's row, then the hands — in one row, or in two when more than two hands meet a phone held
 * upright, where four hands of six cards side by side would leave cards a third of an inch wide.
 * Cards take the largest width every limit allows: the felt's width across a row of hands, its
 * height down the bands, a fifth of the screen, 120 px.
 *
 * A hand's place depends only on how many hands there are, never on how many cards they hold: a
 * split's new stake can be sent to where its hand will be before the server has said so.
 */
export function layout(viewWidth: number, height: number, shape: Shape, insets?: Insets): Layout {
  // Everything below is placed across the felt, which is the screen unless a column takes its right.
  const width = Math.round(Math.min(viewWidth, insets?.right ?? viewWidth));
  const count = Math.max(1, shape.hands.length);
  const rows = count > 2 && width < height ? 2 : 1;
  const columns = Math.ceil(count / rows);
  const top = Math.round(insets?.top ?? Math.max(52, height * 0.07));
  const bottom = Math.round(
    insets === undefined ? height - Math.min(180, Math.max(120, height * 0.19)) : insets.bottom,
  );
  const room = bottom - top;
  const gap = Math.round(height * 0.03);

  const span = 1 + (ROOM - 1) * FAN_X;
  const climb = (ROOM - 1) * FAN_Y; // in card heights
  const byWidth = (width * 0.96) / (columns * span + (columns - 1) * GUTTER);
  const byHeight =
    (room - DEALER_UNDER - rows * UNDER - rows * gap) / (CARD_RATIO * (1 + rows * (1 + climb)));
  const cardWidth = Math.max(16, Math.floor(Math.min(width / 5, byWidth, byHeight, 120)));
  const cardHeight = Math.round(cardWidth * CARD_RATIO);

  const shoe = { x: Math.round(width - cardWidth * 0.75), y: Math.round(top + cardHeight / 2) };
  const dealer = { x: Math.round(width / 2 - cardWidth * 0.6), y: shoe.y };
  const dealerCards = Math.max(2, shape.dealer);
  const dealerRoom = shoe.x - cardWidth - dealer.x - 4; // the last card stops short of the shoe
  const dealerStep = Math.floor(Math.min(cardWidth * 0.62, dealerRoom / (dealerCards - 1)));

  const bandTop = top + cardHeight + DEALER_UNDER + gap;
  const rowHeight = cardHeight * (1 + climb) + UNDER + gap;
  const step = cardWidth * (span + GUTTER);
  const hands: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, count - row * columns);
    const total = cardWidth * (inRow * span + (inRow - 1) * GUTTER);
    const left = (width - total) / 2 + cardWidth / 2;
    hands.push({
      x: Math.round(left + (i - row * columns) * step),
      y: Math.round(bandTop + row * rowHeight + cardHeight * (climb + 0.5)),
    });
  }
  const fans = hands.map((_, i) => {
    const cards = shape.hands[i] ?? 0;
    const squeeze = cards > ROOM ? (ROOM - 1) / (cards - 1) : 1;
    return {
      x: Math.round(cardWidth * FAN_X * squeeze),
      y: -Math.round(cardHeight * FAN_Y * squeeze),
    };
  });
  // Capped so a stack and the two lines beside it always fit in `UNDER`.
  const chip = Math.min(16, Math.max(9, Math.round(cardWidth * 0.2)));
  return {
    width: viewWidth,
    height,
    felt: width,
    cardWidth,
    cardHeight,
    columns,
    rows,
    shoe,
    dealer,
    dealerStep,
    hands,
    fans,
    chip,
    bank: { x: Math.round(width / 2), y: Math.round(height + chip * 2) },
    top,
    bottom,
  };
}

/** A card's centre: the `index`-th of a hand, or of the dealer's row. */
export function cardAt(l: Layout, owner: 'dealer' | number, index: number): Point {
  if (owner === 'dealer') return { x: l.dealer.x + index * l.dealerStep, y: l.dealer.y };
  const base = l.hands[owner] ?? l.hands[0] ?? { x: 0, y: 0 };
  const fan = l.fans[owner] ?? { x: 0, y: 0 };
  return { x: base.x + index * fan.x, y: base.y + index * fan.y };
}

/** Where a hand's stake stands: under its first card, at the left. */
export function chipAt(l: Layout, hand: number): Point {
  const base = l.hands[hand] ?? l.hands[0] ?? { x: 0, y: 0 };
  return {
    x: Math.round(base.x - l.cardWidth / 2 + l.chip),
    y: Math.round(base.y + l.cardHeight / 2 + 4 + l.chip),
  };
}

/** The rectangle a hand of `cards` cards covers, chips and total included. */
export function footprint(
  l: Layout,
  hand: number,
  cards: number,
): { left: number; top: number; right: number; bottom: number } {
  const first = cardAt(l, hand, 0);
  const last = cardAt(l, hand, Math.max(0, cards - 1));
  return {
    left: first.x - l.cardWidth / 2,
    right: last.x + l.cardWidth / 2,
    top: last.y - l.cardHeight / 2,
    bottom: first.y + l.cardHeight / 2 + UNDER,
  };
}
