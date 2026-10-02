import type { RoundResult } from './play.js';

/**
 * A run's sufficient statistics — plain numbers, so a worker's tally crosses a thread boundary as
 * it is and two tallies merge by addition, in any order.
 */
export interface Tally {
  rounds: number;
  /** Σ net and Σ net², in minor units: the mean and its standard error. */
  net: number;
  netSquared: number;
  /** Net per round in half-units (stake 100 → key = net / 50), e.g. `"3"` is +1.5 units. */
  outcomes: Record<string, number>;
  hands: number;
  splitRounds: number;
  fourHandRounds: number;
  doubles: number;
  insuranceOffers: number;
  dealerBlackjacks: number;
  playerBlackjacks: number;
  busts: number;
}

export function emptyTally(): Tally {
  return {
    rounds: 0,
    net: 0,
    netSquared: 0,
    outcomes: {},
    hands: 0,
    splitRounds: 0,
    fourHandRounds: 0,
    doubles: 0,
    insuranceOffers: 0,
    dealerBlackjacks: 0,
    playerBlackjacks: 0,
    busts: 0,
  };
}

export function add(tally: Tally, round: RoundResult, unit: number): void {
  tally.rounds += 1;
  tally.net += round.net;
  tally.netSquared += round.net * round.net;
  const key = String(Math.round((round.net * 2) / unit));
  tally.outcomes[key] = (tally.outcomes[key] ?? 0) + 1;
  tally.hands += round.hands;
  if (round.hands > 1) tally.splitRounds += 1;
  if (round.hands === 4) tally.fourHandRounds += 1;
  tally.doubles += round.doubles;
  if (round.insuranceOffered) tally.insuranceOffers += 1;
  if (round.dealerBlackjack) tally.dealerBlackjacks += 1;
  if (round.playerBlackjack) tally.playerBlackjacks += 1;
  tally.busts += round.busts;
}

export function merge(a: Tally, b: Tally): Tally {
  const outcomes = { ...a.outcomes };
  for (const [key, count] of Object.entries(b.outcomes))
    outcomes[key] = (outcomes[key] ?? 0) + count;
  return {
    rounds: a.rounds + b.rounds,
    net: a.net + b.net,
    netSquared: a.netSquared + b.netSquared,
    outcomes,
    hands: a.hands + b.hands,
    splitRounds: a.splitRounds + b.splitRounds,
    fourHandRounds: a.fourHandRounds + b.fourHandRounds,
    doubles: a.doubles + b.doubles,
    insuranceOffers: a.insuranceOffers + b.insuranceOffers,
    dealerBlackjacks: a.dealerBlackjacks + b.dealerBlackjacks,
    playerBlackjacks: a.playerBlackjacks + b.playerBlackjacks,
    busts: a.busts + b.busts,
  };
}

/**
 * The house edge — the player's mean loss per unit staked initially — and its standard error.
 * Both as fractions: 0.004 is 0.4 %.
 */
export function edge(tally: Tally, unit: number): { edge: number; standardError: number } {
  const n = tally.rounds;
  const mean = tally.net / n / unit;
  const variance = (tally.netSquared / n / unit ** 2 - mean ** 2) * (n / (n - 1));
  return { edge: -mean, standardError: Math.sqrt(variance / n) };
}
