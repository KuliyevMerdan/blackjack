import { shoeFor, playRound, RULES, UNIT } from './play.js';
import { add, emptyTally, type Tally } from './tally.js';

/** Rounds `from` (inclusive) to `to` (exclusive) of the run seeded `seed`. Deterministic. */
export function simulate(seed: string, from: number, to: number): Tally {
  const tally = emptyTally();
  for (let i = from; i < to; i += 1) add(tally, playRound(shoeFor(seed, i, RULES)), UNIT);
  return tally;
}
