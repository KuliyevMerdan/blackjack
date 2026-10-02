import type { Card } from '@blackjack/cards';
import { chart } from './chart.js';

/** The decisions a player makes — the protocol's `Action`, spelled out: `strategy` reads `cards` only. */
export type Decision = 'hit' | 'stand' | 'double' | 'split' | 'insurance' | 'noInsurance';

/**
 * What basic strategy does with `hand` against `upcard`, given the decisions the server offers.
 * Always one of `allowed`:
 *
 * - insurance is never taken — at six decks it costs about 7.5 % of its stake;
 * - a split the server does not offer (four hands already) plays the pair as its total;
 * - a double it does not offer (a third card, or no money) becomes a hit — or, for the soft 18s
 *   the chart doubles, a stand;
 * - a hit it does not offer (a split ace) becomes a stand.
 */
export function recommend(
  hand: readonly Card[],
  upcard: Card,
  allowed: readonly Decision[],
): Decision {
  if (allowed.includes('noInsurance')) return 'noInsurance';
  const code = chart(hand, upcard, allowed.includes('split'));
  const first: Decision =
    code === 'P'
      ? 'split'
      : code === 'D' || code === 'd'
        ? 'double'
        : code === 'H'
          ? 'hit'
          : 'stand';
  if (allowed.includes(first)) return first;
  if (first === 'double') {
    const fallback: Decision = code === 'd' ? 'stand' : 'hit';
    if (allowed.includes(fallback)) return fallback;
  }
  return allowed.includes('stand') ? 'stand' : (allowed[0] ?? 'stand');
}
