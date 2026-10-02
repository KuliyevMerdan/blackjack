import { card } from '@blackjack/cards';
import { describe, expect, it } from 'vitest';
import { expectedBalance, sameCards, within } from './audit.js';
import { percentiles } from './stats.js';

describe('the audit’s arithmetic', () => {
  it('a wallet is its start, less every stake at risk, plus every payout', () => {
    const settled = [
      { totalStake: 500, totalPayout: 1000 },
      { totalStake: 1000, totalPayout: 0 },
    ];
    expect(expectedBalance(10_000, settled, null)).toBe(9_500);
    expect(expectedBalance(10_000, settled, { totalStake: 750 })).toBe(8_750);
  });

  it('every card dealt is on the table once, and nothing else is', () => {
    const c = (...codes: string[]) => codes.map((x) => card(x));
    const round = (dealer: string[], hands: string[][]) => ({
      dealer: { cards: c(...dealer), holeHidden: false },
      hands: hands.map((h) => ({ cards: c(...h) })),
    });
    const ok = { dealt: c('9H', 'KS', '9C', '7D'), round: round(['KS', '7D'], [['9H', '9C']]) };
    expect(sameCards(ok as never)).toBeNull();
    const twice = { ...ok, round: round(['KS', '7D'], [['9H', '9H']]) };
    expect(sameCards(twice as never)).toMatch(/9H shown 2×, dealt 1×/);
    const extra = { ...ok, round: round(['KS', '7D'], [['9H', '9C', '2D']]) };
    expect(sameCards(extra as never)).toMatch(/5 cards on the table, 4 dealt/);
  });

  it('the server holds every accepted move, and at most the untold ones besides', () => {
    expect(within(3, 3, 0)).toBe(0);
    expect(within(4, 3, 1)).toBe(1); // a retry ran out, but the move had landed
    expect(within(5, 3, 1)).toBeNull(); // more than every intent: something landed twice
    expect(within(2, 3, 4)).toBeNull(); // an accepted move the server does not have
  });

  it('percentiles', () => {
    expect(percentiles([5, 1, 3, 2, 4])).toEqual({ count: 5, p50: 3, p90: 5, p99: 5, max: 5 });
  });
});
