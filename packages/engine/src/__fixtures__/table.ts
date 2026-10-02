import { canonicalShoe, card, type Card } from '@blackjack/cards';
import { ZERO, add, minor, sub, sum, type Minor } from '@blackjack/money';
import {
  PUBLISHED_RULES,
  fold,
  gameEvent,
  round,
  rules as rulesSchema,
  tableOf,
  type GameEvent,
  type Round,
  type Rules,
} from '@blackjack/protocol';
import { view } from '../engine.js';
import type { Seeds, State } from '../state.js';

/** Test-only fixtures: the published rules, a fixed set of seeds, and shoes to deal from. */

export const RULES: Rules = rulesSchema.parse(PUBLISHED_RULES);

export const SEEDS: Seeds = {
  roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
  commit: 'ab'.repeat(32),
  clientSeed: 'engine-test',
  serverSeed: 'cd'.repeat(32),
  forced: false,
};

export const STAKE: Minor = minor(500);
export const BALANCE: Minor = minor(100_000);

/** A shoe stacked from the top, as the dev `forceShoe` would deal it. */
export function stacked(...codes: string[]): Card[] {
  return codes.map((code) => card(code));
}

/**
 * A six-deck shoe in a seeded order. The engine's tests may not import `fair` any more than the
 * engine may, and they need speed rather than the protocol's shuffle: mulberry32 driving a plain
 * Fisher–Yates is enough to put every situation on the table.
 */
export function seededShoe(seed: number): Card[] {
  const next = mulberry32(seed);
  const shoe = canonicalShoe(6);
  for (let i = shoe.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = shoe[i];
    const b = shoe[j];
    if (a === undefined || b === undefined) throw new RangeError('index out of the shoe');
    shoe[i] = b;
    shoe[j] = a;
  }
  return shoe;
}

/** A small seeded PRNG in [0, 1) — for tests that need many reproducible random choices. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What every step owes, computed for a test to assert: the snapshot parses against the wire
 * schema, every event does, the events fold from the previous snapshot to this one (invariant 6),
 * and the balance is the opening one less every stake placed plus every payout settled so far.
 */
export function audit(
  previous: Round | null,
  state: State,
  events: readonly GameEvent[],
  opening: Minor,
) {
  const snapshot = view(state);
  const paid = sum([...state.hands.map((h) => h.payout ?? ZERO), state.insurance?.payout ?? ZERO]);
  return {
    snapshot,
    parsed: round.safeParse(snapshot),
    badEvents: events.filter((e) => !gameEvent.safeParse(e).success),
    folded: fold(previous, events),
    table: tableOf(snapshot),
    balance: state.balance,
    expectedBalance: add(sub(opening, snapshot.totalStake), paid),
  };
}
