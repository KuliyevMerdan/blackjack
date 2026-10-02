import { value, type Card } from '@blackjack/cards';
import type { Beat } from '@blackjack/director';
import type { Action, Round } from '@blackjack/protocol';

/**
 * The table in words — for the line over the action bar, and for a screen reader. Every number here
 * is one the snapshot carries; the only reading done is `cards.value()`, the client's one piece of
 * game logic (CLAUDE.md § The invariant that makes the client honest).
 */

type Format = (minor: number) => string;

const RANK: Readonly<Record<string, string>> = {
  A: 'ace',
  K: 'king',
  Q: 'queen',
  J: 'jack',
  T: '10',
};

export const cardName = (card: Card): string => {
  const rank = card[0] ?? '';
  return RANK[rank] ?? rank;
};

const WORDS: Readonly<Record<Action, string>> = {
  hit: 'hit',
  stand: 'stand',
  double: 'double',
  split: 'split',
  insurance: 'take insurance',
  noInsurance: 'no insurance',
};

function totalWords(cards: readonly Card[], fromSplit: boolean): string {
  const { total, soft, natural } = value(cards);
  if (natural && !fromSplit) return 'blackjack';
  return soft && total < 21 ? `soft ${total}` : String(total);
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1) ?? ''}`;
}

/**
 * The decision in front of the player, said once the screen shows it: which hand, what it holds,
 * what the dealer shows, and what the player may do — exactly `allowed`.
 */
export function promptOf(round: Round): string | null {
  if (round.phase === 'SETTLED' || round.allowed.length === 0) return null;
  const [up] = round.dealer.cards;
  const dealer = up === undefined ? '' : `Dealer shows ${article(cardName(up))}. `;
  const choices = `${capital(list(round.allowed.map((a) => WORDS[a])))}?`;
  if (round.phase === 'INSURANCE') return `${dealer}${choices}`;
  const index = round.activeHand ?? 0;
  const hand = round.hands[index];
  if (hand === undefined) return null;
  const which =
    round.hands.length > 1 ? `Hand ${index + 1} of ${round.hands.length}: ` : 'You have ';
  const cards = hand.cards.map(cardName).join(', ');
  return `${which}${cards} — ${totalWords(hand.cards, hand.fromSplit)}. ${dealer}${choices}`;
}

/**
 * The line a beat leaves over the action bar — the moments a player must not have to read off the
 * felt: an offer, the peek's answer said plainly either way, and what insurance came to. A reply's
 * lines add up (`Dealer checked — no blackjack. Insurance lost.`): one must not hide another.
 */
export function calloutOf(beat: Beat, format: Format): string | null {
  switch (beat.kind) {
    case 'offer':
      return 'The dealer shows an ace. Insurance?';
    case 'peek':
      return beat.blackjack ? 'Dealer has blackjack.' : 'Dealer checked — no blackjack.';
    case 'insurancePaid':
      return beat.payout > 0 ? `Insurance pays ${format(beat.payout)}.` : 'Insurance lost.';
    case 'split':
      return 'The pair splits.';
    case 'double':
      return 'Doubled — one card.';
    default:
      return null;
  }
}

/** The result moment: the round's verdict, its totals, and every hand's outcome in words. */
export interface Summary {
  readonly heading: string;
  /** Staked and returned, both as the snapshot has them. */
  readonly totals: string;
  /** Hand by hand, for the screen reader. */
  readonly detail: string;
}

export function summaryOf(round: Round, format: Format): Summary | null {
  if (round.phase !== 'SETTLED') return null;
  const paid = round.totalPayout ?? 0;
  const staked = round.totalStake;
  const blackjack = round.hands.some((h) => h.outcome === 'BLACKJACK');
  const heading =
    paid > staked
      ? blackjack
        ? 'Blackjack!'
        : 'You win'
      : paid === staked
        ? 'Push'
        : 'Dealer wins';
  const hands = round.hands.map((h, i) => {
    const name = round.hands.length > 1 ? `Hand ${i + 1}` : 'Your hand';
    const outcome = (h.outcome ?? 'LOSE').toLowerCase();
    const bust = h.state === 'BUST' ? ', bust' : '';
    return `${name}: ${totalWords(h.cards, h.fromSplit)}${bust}, ${outcome}${
      h.payout ? `, ${format(h.payout)} back` : ''
    }.`;
  });
  const dealer = `Dealer: ${totalWords(round.dealer.cards, false)}${
    value(round.dealer.cards).bust ? ', bust' : ''
  }.`;
  const insurance =
    round.insurance !== null && round.insurance.stake > 0
      ? [`Insurance ${round.insurance.payout ? `paid ${format(round.insurance.payout)}` : 'lost'}.`]
      : [];
  return {
    heading,
    totals: `Staked ${format(staked)} · returned ${format(paid)}`,
    detail: [dealer, ...hands, ...insurance].join(' '),
  };
}

const article = (word: string) => (/^[aeiou8]/.test(word) ? `an ${word}` : `a ${word}`);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
