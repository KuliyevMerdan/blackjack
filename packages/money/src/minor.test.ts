import { describe, expect, it } from 'vitest';
import {
  InexactAmountError,
  ZERO,
  add,
  compare,
  formatMinor,
  half,
  minor,
  payout,
  ratio,
  sub,
  sum,
} from './index.js';

describe('Minor', () => {
  it('admits safe integers, negative ones included', () => {
    expect(minor(0)).toBe(0);
    expect(minor(-250)).toBe(-250);
    expect(minor(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses %s',
    (value) => {
      expect(() => minor(value)).toThrow(RangeError);
    },
  );

  it('adds, subtracts, sums and compares exactly', () => {
    expect(add(minor(150), minor(250))).toBe(400);
    expect(sub(minor(150), minor(250))).toBe(-100);
    expect(sum([minor(500), minor(500), minor(250)])).toBe(1250);
    expect(sum([])).toBe(ZERO);
    expect(compare(minor(1), minor(2))).toBe(-1);
    expect(compare(minor(2), minor(2))).toBe(0);
    expect(compare(minor(3), minor(2))).toBe(1);
  });

  it('refuses an overflowing sum rather than losing precision', () => {
    expect(() => add(minor(Number.MAX_SAFE_INTEGER), minor(1))).toThrow(RangeError);
  });
});

describe('ratio, payout and half — exact or nothing', () => {
  it.each([
    // [stake, numerator, denominator, expected] — the table in docs/protocol.md §4.4
    [500, 0, 1, 0], // LOSE
    [500, 1, 1, 500], // PUSH
    [500, 2, 1, 1000], // WIN
    [500, 5, 2, 1250], // BLACKJACK: the stake back and 3:2 on it
    [100, 5, 2, 250], // the smallest stake at betUnit 100
    [250, 3, 1, 750], // insurance at 2:1 on half of 500
  ])('payout(%i, %i, %i) is %i', (stake, numerator, denominator, expected) => {
    expect(payout(minor(stake), numerator, denominator)).toBe(expected);
  });

  it('pays every stake a multiple of an even unit exactly, at every ratio the game uses', () => {
    // One `expect` at the end, not three per stake: 150,000 matcher calls timed out on a busy CI
    // runner while the arithmetic itself takes milliseconds.
    const wrong: number[] = [];
    for (let stake = 2; stake <= 100_000; stake += 2) {
      const amount = minor(stake);
      if (
        payout(amount, 5, 2) * 2 !== stake * 5 ||
        half(amount) * 2 !== stake ||
        payout(half(amount), 3, 1) !== (stake / 2) * 3
      ) {
        wrong.push(stake);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('refuses an inexact result instead of rounding it', () => {
    expect(() => payout(minor(101), 5, 2)).toThrow(InexactAmountError);
    expect(() => half(minor(101))).toThrow(InexactAmountError);
    expect(() => ratio(minor(1), 1, 3)).toThrow(/not a whole amount/);
  });

  it('refuses a product past the safe integers', () => {
    expect(() => ratio(minor(Number.MAX_SAFE_INTEGER), 2, 1)).toThrow(/overflows/);
  });

  it.each([
    [-2, 1, 1],
    [2, -1, 1],
    [2, 1.5, 1],
    [2, 1, 0],
    [2, 1, 0.5],
  ])('refuses ratio(%s, %s, %s)', (amount, numerator, denominator) => {
    expect(() => ratio(minor(amount), numerator, denominator)).toThrow(RangeError);
  });
});

describe('formatMinor', () => {
  it('formats cents without a float in sight', () => {
    expect(formatMinor(minor(123456), { locale: 'en-US' })).toBe('1,234.56');
    expect(formatMinor(minor(-5), { locale: 'en-US' })).toBe('-0.05');
    expect(formatMinor(minor(100000), { locale: 'de-DE' })).toBe('1.000,00');
    expect(formatMinor(minor(250), { locale: 'en-US', fractionDigits: 0 })).toBe('250');
  });
});
