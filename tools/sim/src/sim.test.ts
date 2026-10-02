import { canonicalShoe, card } from '@blackjack/cards';
import { describe, expect, it } from 'vitest';
import { judge, measureCell, stack } from './cells.js';
import { shoeFor } from './play.js';
import { simulate } from './run.js';
import { edge, emptyTally, merge } from './tally.js';

describe('a pinned run', () => {
  /**
   * 2,000 rounds of the run seeded "pinned", to the unit. The shuffle, the engine and the chart
   * all feed this number, so a change to any of them moves it — and the change must say why the
   * new number is right. Recompute with `simulate('pinned', 0, 2000)`.
   */
  it('plays 2,000 rounds to the same result every time', () => {
    const tally = simulate('pinned', 0, 2000);
    expect(tally).toEqual({
      rounds: 2000,
      net: 1200,
      netSquared: 25_805_000,
      outcomes: {
        '-8': 1,
        '-6': 2,
        '-4': 73,
        '-2': 873,
        0: 180,
        2: 665,
        3: 94,
        4: 102,
        6: 9,
        8: 1,
      },
      hands: 2057,
      splitRounds: 50,
      fourHandRounds: 2,
      doubles: 186,
      insuranceOffers: 160,
      dealerBlackjacks: 83,
      playerBlackjacks: 99,
      busts: 318,
    });
  });

  it('splits across threads without changing the answer', () => {
    expect(merge(simulate('pinned', 0, 700), simulate('pinned', 700, 2000))).toEqual(
      simulate('pinned', 0, 2000),
    );
  });
});

describe('edge', () => {
  it('is the mean loss per unit, with the standard error of that mean', () => {
    // Four rounds at a unit of 100: −1, −1, +1, 0 units — a mean of −0.25, a house edge of 25 %.
    const tally = { ...emptyTally(), rounds: 4, net: -100, netSquared: 30_000 };
    const { edge: e, standardError } = edge(tally, 100);
    expect(e).toBeCloseTo(0.25);
    // Sample variance (0.75 − 0.0625) × 4/3 = 0.9167; over n = 4, its root is 0.4787.
    expect(standardError).toBeCloseTo(0.4787, 4);
  });
});

describe('the chart against the engine', () => {
  it('moves the cell’s cards to the top and keeps the shoe whole', () => {
    const shoe = shoeFor('stack', 0);
    const top = ['KS', '6D', 'TH'].map((c) => card(c));
    const stacked = stack(shoe, top);
    expect(stacked.slice(0, 3)).toEqual(top);
    expect([...stacked].sort()).toEqual([...canonicalShoe(6)].sort());
  });

  it('a king and a ten against a six: standing beats splitting, by far more than the error', () => {
    const cell = measureCell(['KS', 'TH'], '6D', 2000, 'test');
    const v = judge(cell);
    expect(cell.chart).toBe('stand');
    const split = v.margins.split;
    expect(split?.margin).toBeGreaterThan(3 * (split?.standardError ?? Infinity));
    expect(v.ok).toBe(true);
  });

  it('aces against a six: splitting beats hitting', () => {
    const v = judge(measureCell(['AS', 'AH'], '6D', 2000, 'test'));
    expect(v.best).toBe('split');
    expect(v.ok).toBe(true);
  });
});
