import { describe, expect, it } from 'vitest';
import {
  RANKS,
  SUITS,
  canonicalShoe,
  card,
  isCard,
  points,
  sameValue,
  value,
  type Card,
  type Rank,
} from './index.js';

const ALL: Card[] = canonicalShoe(1);

describe('card codes', () => {
  it('are the 52 two-character codes, and nothing else', () => {
    expect(ALL).toHaveLength(52);
    expect(new Set(ALL).size).toBe(52);
    for (const c of ALL) expect(isCard(c)).toBe(true);
  });

  it.each(['', 'A', 'AS ', '1S', 'aS', 'As', 'AX', '10S', 'TT', 42, null, undefined])(
    'refuses %j',
    (value) => {
      expect(isCard(value)).toBe(false);
    },
  );

  it('parses through card(), or throws naming the input', () => {
    expect(card('TD')).toBe('TD');
    expect(() => card('XX')).toThrow(/not a card: "XX"/);
  });

  it('counts points with the ace low and every face at ten', () => {
    const expected: Record<Rank, number> = {
      A: 1,
      2: 2,
      3: 3,
      4: 4,
      5: 5,
      6: 6,
      7: 7,
      8: 8,
      9: 9,
      T: 10,
      J: 10,
      Q: 10,
      K: 10,
    };
    for (const rank of RANKS) expect(points(`${rank}S`)).toBe(expected[rank]);
  });

  it('pairs for a split by value: tens with any ten, aces only with aces', () => {
    expect(sameValue('KS', 'TD')).toBe(true);
    expect(sameValue('JH', 'QC')).toBe(true);
    expect(sameValue('AS', 'AH')).toBe(true);
    expect(sameValue('AS', 'TS')).toBe(false);
    expect(sameValue('9S', 'TS')).toBe(false);
  });
});

describe('canonicalShoe', () => {
  it('is the order docs/protocol.md §3.2 pins: suits S H D C, ranks A to K, deck by deck', () => {
    const shoe = canonicalShoe(6);
    expect(shoe).toHaveLength(312);
    expect(shoe[0]).toBe('AS');
    expect(shoe[12]).toBe('KS');
    expect(shoe[13]).toBe('AH');
    expect(shoe[51]).toBe('KC');
    expect(shoe[52]).toBe('AS');
    expect(shoe[311]).toBe('KC');
    expect(shoe.slice(0, 52)).toEqual(SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`)));
  });

  it('holds each card once per deck', () => {
    const counts = new Map<Card, number>();
    for (const c of canonicalShoe(6)) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 6)).toBe(true);
  });

  it.each([0, 9, 1.5, -1])('refuses %s decks', (decks) => {
    expect(() => canonicalShoe(decks)).toThrow(RangeError);
  });
});

/**
 * An independent oracle: try every assignment of 1 or 11 to every ace and keep the best total that
 * does not bust (or the lowest, if all do). Slow and obviously right — the opposite of `value()`.
 */
function oracle(cards: readonly Card[]): { total: number; soft: boolean } {
  const aces = cards.filter((c) => c.startsWith('A')).length;
  const rest = cards.filter((c) => !c.startsWith('A')).reduce((sum, c) => sum + points(c), 0);
  let best = -1;
  let bestSoft = false;
  let lowest = Number.POSITIVE_INFINITY;
  for (let high = 0; high <= aces; high++) {
    const total = rest + high * 11 + (aces - high);
    lowest = Math.min(lowest, total);
    if (total <= 21 && total > best) {
      best = total;
      bestSoft = high > 0;
    }
  }
  return best >= 0 ? { total: best, soft: bestSoft } : { total: lowest, soft: false };
}

describe('value', () => {
  it('agrees with the oracle on every two-card hand', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        const v = value([a, b]);
        expect({ total: v.total, soft: v.soft }).toEqual(oracle([a, b]));
      }
    }
  });

  it('agrees with the oracle on every three-card hand of ranks', () => {
    for (const a of RANKS) {
      for (const b of RANKS) {
        for (const c of RANKS) {
          const hand: Card[] = [`${a}S`, `${b}H`, `${c}D`];
          const v = value(hand);
          expect({ total: v.total, soft: v.soft }).toEqual(oracle(hand));
          expect(v.bust).toBe(v.total > 21);
        }
      }
    }
  });

  it('agrees with the oracle on hands of many aces', () => {
    for (let n = 1; n <= 12; n++) {
      const hand: Card[] = Array.from({ length: n }, () => 'AS');
      const v = value(hand);
      expect({ total: v.total, soft: v.soft }).toEqual(oracle(hand));
    }
  });

  it('calls exactly the ace-and-ten-value pairs natural, in either order', () => {
    let naturals = 0;
    for (const a of ALL) {
      for (const b of ALL) {
        const v = value([a, b]);
        if (v.natural) {
          naturals++;
          expect(v.total).toBe(21);
          expect(v.soft).toBe(true);
        }
      }
    }
    // 4 aces × 16 ten-values, in two orders.
    expect(naturals).toBe(2 * 4 * 16);
  });

  it('never calls three cards to 21 natural', () => {
    expect(value(['7S', '7H', '7D'])).toEqual({
      total: 21,
      soft: false,
      natural: false,
      bust: false,
    });
    expect(value(['AS', '5H', '5D'])).toEqual({
      total: 21,
      soft: true,
      natural: false,
      bust: false,
    });
  });

  it('reads the hands a table talks about', () => {
    expect(value(['AS', '6H'])).toMatchObject({ total: 17, soft: true });
    expect(value(['AS', '6H', 'KD'])).toMatchObject({ total: 17, soft: false });
    expect(value(['AS', 'AH'])).toMatchObject({ total: 12, soft: true });
    expect(value(['KS', 'QH', '2D'])).toMatchObject({ total: 22, soft: false, bust: true });
    expect(value([])).toEqual({ total: 0, soft: false, natural: false, bust: false });
  });
});
