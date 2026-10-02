import { canonicalShoe, type Card } from '@blackjack/cards';
import { describe, expect, it } from 'vitest';
import { below, commit, shoe, shuffleInPlace, verifyCommit, wordStream } from './index.js';

const SERVER = '7f'.repeat(32);

/** A word source that replays a fixed list, then fails loudly if asked for more. */
function scripted(words: number[]): () => number {
  let i = 0;
  return () => {
    const word = words[i++];
    if (word === undefined) throw new Error('stream exhausted');
    return word;
  };
}

/** Pearson's χ² of observed counts against a uniform expectation. */
function chiSquare(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
}

describe('below — the unbiased draw', () => {
  it('discards a word at or above the largest multiple of n, then uses the next', () => {
    // n = 3: 2³² mod 3 = 1, so the limit is 2³² − 1 and the single word 0xFFFFFFFF is rejected.
    expect(below(3, scripted([0xffffffff, 5]))).toBe(2);
    // n = 5: 2³² mod 5 = 1 as well.
    expect(below(5, scripted([0xffffffff, 0xffffffff, 7]))).toBe(2);
    // n = 312: 2³² mod 312 = 256, so the top 256 words are rejected and the next one down is kept.
    const limit = 0x1_0000_0000 - 256;
    expect(below(312, scripted([limit, limit + 255, limit - 1]))).toBe((limit - 1) % 312);
  });

  it('accepts every word below the limit on the first draw', () => {
    expect(below(2, scripted([0xffffffff]))).toBe(1); // 2 divides 2³²: nothing is ever rejected
    expect(below(1, scripted([123]))).toBe(0);
  });

  it.each([0, -1, 1.5, 2 ** 32 + 1])('refuses n = %s', (n) => {
    expect(() => below(n, scripted([0]))).toThrow(RangeError);
  });
});

describe('shuffleInPlace — Fisher–Yates from the top', () => {
  it('swaps position i with the drawn j, from the last index down', () => {
    // n = 4: draws for i = 3, 2, 1 are word mod 4, 3, 2.
    expect(shuffleInPlace(['a', 'b', 'c', 'd'], scripted([0, 0, 0]))).toEqual(['b', 'c', 'd', 'a']);
    expect(shuffleInPlace(['a', 'b', 'c', 'd'], scripted([3, 2, 1]))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('makes all 24 orders of four items equally likely (χ², 240,000 shuffles)', () => {
    const next = wordStream(SERVER, 'uniformity-4');
    const counts = new Map<string, number>();
    for (let i = 0; i < 240_000; i++) {
      const order = shuffleInPlace(['a', 'b', 'c', 'd'], next).join('');
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    // 23 degrees of freedom: χ² above 49.7 has probability 0.001 under uniformity.
    expect(chiSquare([...counts.values()])).toBeLessThan(49.7);
  });
});

describe('shoe', () => {
  it('is a permutation of the canonical six decks', () => {
    const dealt = shoe(SERVER, 'perm');
    expect(dealt).toHaveLength(312);
    expect([...dealt].sort()).toEqual(canonicalShoe(6).sort());
  });

  it('depends on both seeds', () => {
    const base = shoe(SERVER, 'player').join();
    expect(shoe(SERVER, 'player').join()).toBe(base);
    expect(shoe(SERVER, 'player2').join()).not.toBe(base);
    expect(shoe('7e'.repeat(32), 'player').join()).not.toBe(base);
  });

  it('puts a given card in every position equally often (χ², 20,000 shoes)', () => {
    // Follow the ace of spades from the first deck — canonical index 0 — through the shoe by
    // identity, so its five twins do not count. 312 positions, 311 degrees of freedom: χ² above
    // 400 has probability under 0.0005 under uniformity.
    const positions = new Array<number>(312).fill(0);
    for (let i = 0; i < 20_000; i++) {
      const tagged = canonicalShoe(6).map((card, index) => ({ card, index }));
      shuffleInPlace(tagged, wordStream(SERVER, `position-${i}`));
      const at = tagged.findIndex((t) => t.index === 0);
      positions[at] = (positions[at] ?? 0) + 1;
    }
    expect(chiSquare(positions)).toBeLessThan(400);
  });

  it('deals a different shoe for a client seed that differs in one character', () => {
    const a: Card[] = shoe(SERVER, 'seed-a');
    const b: Card[] = shoe(SERVER, 'seed-b');
    const same = a.filter((card, i) => b[i] === card).length;
    // Two independent shoes agree at about 312 × 6/312 = 6 positions by chance.
    expect(same).toBeLessThan(25);
  });

  it.each(['', 'x'.repeat(65), 'tab\there', 'é'])('refuses the client seed %j', (clientSeed) => {
    expect(() => shoe(SERVER, clientSeed)).toThrow(/client seed/);
  });

  it.each(['', '7F'.repeat(32), '7f'.repeat(31), '7f'.repeat(33)])(
    'refuses the server seed %j',
    (serverSeed) => {
      expect(() => shoe(serverSeed, 'a')).toThrow(/server seed/);
      expect(verifyCommit(serverSeed, commit(SERVER))).toBe(false);
    },
  );

  it('verifies only the commit of its own seed', () => {
    expect(verifyCommit(SERVER, commit(SERVER))).toBe(true);
    expect(verifyCommit('7e'.repeat(32), commit(SERVER))).toBe(false);
  });
});
