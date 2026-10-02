import type { GameConfig } from '@blackjack/protocol';

/** What a stake must fit: the table's unit and range, and what the player has. */
export interface Limits {
  readonly betUnit: number;
  readonly minBet: number;
  readonly maxBet: number;
  readonly balance: number;
}

export const limitsOf = (config: GameConfig, balance: number): Limits => ({
  betUnit: config.betUnit,
  minBet: config.minBet,
  maxBet: config.maxBet,
  balance,
});

/**
 * The chips on the rail: 1, 5, 25 and 100 units — the denominations a table's felt is printed with —
 * as many of them as the table's maximum allows. Every one is a multiple of `betUnit`, so any stake
 * built from them is too (§2.2).
 */
export function chipsFor(limits: Pick<Limits, 'betUnit' | 'maxBet'>): number[] {
  const chips = [1, 5, 25, 100].map((n) => n * limits.betUnit).filter((c) => c <= limits.maxBet);
  return chips.length > 0 ? chips : [limits.betUnit];
}

/** The most the player may stake now: the table's maximum, or the balance, in whole units. */
export function ceilingOf(limits: Limits): number {
  const affordable = Math.floor(limits.balance / limits.betUnit) * limits.betUnit;
  return Math.min(limits.maxBet, affordable);
}

/** A chip lights only if it keeps the stake within the table's maximum and the balance. */
export function canAdd(stake: number, chip: number, limits: Limits): boolean {
  return stake + chip <= ceilingOf(limits);
}

export function add(stake: number, chip: number, limits: Limits): number {
  return canAdd(stake, chip, limits) ? stake + chip : stake;
}

/** The remembered stake, brought within reach — after a loss the last stake may be too much. */
export function fit(stake: number, limits: Limits): number {
  return Math.min(stake, ceilingOf(limits));
}

/**
 * Deal lights only for a stake the server will take: in range, a whole number of units, affordable
 * (§2.3). Its refusals — `BET_OUT_OF_RANGE`, `BET_NOT_A_UNIT_MULTIPLE`, `INSUFFICIENT_FUNDS` — are
 * the server's to make and the button's to never provoke.
 */
export function dealable(stake: number, limits: Limits): boolean {
  return (
    stake >= limits.minBet &&
    stake <= limits.maxBet &&
    stake % limits.betUnit === 0 &&
    stake <= limits.balance
  );
}
