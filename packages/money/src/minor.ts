declare const brand: unique symbol;

/**
 * An amount in minor units — cents of play money. A safe integer, possibly negative (a delta).
 *
 * The brand is what stops a card's points, a `seq` or a count of hands from being added to a
 * balance: all three are `number`, and only this one is money.
 */
export type Minor = number & { readonly [brand]: 'Minor' };

export function isMinor(value: number): value is Minor {
  return Number.isSafeInteger(value);
}

/** The one way into the brand: a safe integer, or a throw naming what it was handed. */
export function minor(value: number): Minor {
  if (!isMinor(value)) throw new RangeError(`not an amount of minor units: ${value}`);
  return value;
}

export const ZERO: Minor = minor(0);

export function add(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

export function sum(amounts: Iterable<Minor>): Minor {
  let total = ZERO;
  for (const amount of amounts) total = add(total, amount);
  return total;
}

export function compare(a: Minor, b: Minor): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Thrown when an amount would have to be rounded to exist. Always a config or rules bug. */
export class InexactAmountError extends RangeError {
  override readonly name = 'InexactAmountError';
}

/**
 * `amount × numerator / denominator`, exactly — or a throw. Never rounded, never floored.
 *
 * Every payout in this game is a ratio of a stake: a win `2/1`, a blackjack `5/2` (the stake back
 * and 3:2 on it), insurance `3/1` on a stake that is itself `1/2` of the base. Stakes are multiples
 * of an even `betUnit`, so each of those is an integer (docs/protocol.md §4.4); one that is not is a
 * bug in whatever chose the stake or the ratio, and it must fail where it is introduced rather
 * than leak a fraction of a cent into a balance on one runtime and not another.
 *
 * The product is checked before it is divided: past `Number.MAX_SAFE_INTEGER` it is no longer an
 * exact integer, and an amount computed from an inexact one is a wrong amount.
 */
export function ratio(amount: Minor, numerator: number, denominator: number): Minor {
  if (amount < 0) throw new RangeError(`a ratio of a negative amount: ${amount}`);
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError(`not a non-negative integer numerator: ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator < 1) {
    throw new RangeError(`not a positive integer denominator: ${denominator}`);
  }
  const product = amount * numerator;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`overflows: ${amount} × ${numerator}`);
  }
  if (product % denominator !== 0) {
    throw new InexactAmountError(`${amount} × ${numerator}/${denominator} is not a whole amount`);
  }
  return minor(product / denominator);
}

/**
 * What a stake returns at `numerator : denominator` *including the stake* — the protocol's
 * `payout` (§4.4). `payout(stake, 2, 1)` is an even-money win; `payout(stake, 5, 2)` a blackjack.
 */
export function payout(stake: Minor, numerator: number, denominator: number): Minor {
  return ratio(stake, numerator, denominator);
}

/** Exactly half — insurance's stake. Throws on an odd amount rather than losing the odd cent. */
export function half(amount: Minor): Minor {
  return ratio(amount, 1, 2);
}
