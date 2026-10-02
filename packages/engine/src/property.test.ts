import { minor, type Minor } from '@blackjack/money';
import { ACTIONS, type Action, type GameEvent, type Round, type Rules } from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import { RULES, SEEDS, audit, mulberry32, seededShoe } from './__fixtures__/table.js';
import { act, allowed, deal, view } from './engine.js';
import { replay, type Decision } from './replay.js';
import type { State } from './state.js';

/**
 * The engine under random legal play. Every hand is a fresh seeded shoe, a random stake and
 * balance, and a uniformly random choice from `allowed` at every decision — so splits to four
 * hands, doubles after splits and insurance with no money left all turn up without being written.
 */

type Random = () => number;

const pick = <T>(random: Random, items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new RangeError('picked from nothing');
  return item;
};

/** A stake of 1–100 units of 100, and a balance from barely enough to plenty. */
function stakeAndBalance(random: Random): { stake: Minor; balance: Minor } {
  const stake = 100 * (1 + Math.floor(random() * 100));
  const balance = stake + 50 * Math.floor(random() * ((stake * 9) / 50));
  return { stake: minor(stake), balance: minor(balance) };
}

/** Rule sets other than the published one, so `allowed` is checked against each switch. */
function someRules(random: Random): Rules {
  return {
    ...RULES,
    dealerHitsSoft17: random() < 0.5,
    insurance: random() < 0.8,
    doubleAfterSplit: random() < 0.5,
    maxHands: pick(random, [1, 2, 3, 4]),
    resplitAces: random() < 0.5,
    hitSplitAces: random() < 0.5,
    autoStandOn21: random() < 0.5,
  };
}

interface Hand {
  readonly states: State[];
  readonly decisions: Decision[];
  readonly steps: (readonly GameEvent[])[];
}

/** Plays one random hand to settlement, calling `onDecision` before each choice. */
function playRandom(
  seed: number,
  rules: Rules,
  onStep: (
    previous: Round | null,
    state: State,
    events: readonly GameEvent[],
    opening: Minor,
  ) => void,
  onDecision: (state: State) => void = () => {},
): Hand & { stake: Minor; balance: Minor } {
  const random = mulberry32(seed ^ 0x9e3779b9);
  const shoe = seededShoe(seed);
  const { stake, balance } = stakeAndBalance(random);
  const dealt = deal({ type: 'deal', rules, seeds: SEEDS, stake, balance }, shoe);
  if (!dealt.ok) throw new Error(`deal refused: ${dealt.refusal}`);
  onStep(null, dealt.state, dealt.events, balance);

  const hand: Hand = { states: [dealt.state], decisions: [], steps: [dealt.events] };
  let state = dealt.state;
  while (state.phase !== 'SETTLED') {
    onDecision(state);
    const action = pick(random, allowed(state));
    const next = act(state, action, shoe);
    if (!next.ok) throw new Error(`${action} refused: ${next.refusal}`);
    onStep(view(state), next.state, next.events, balance);
    hand.decisions.push({ seq: state.seq, action });
    hand.steps.push(next.events);
    hand.states.push(next.state);
    state = next.state;
  }
  return { ...hand, stake, balance };
}

describe('100,000 seeded hands of random legal play', () => {
  it('parse, fold to their snapshots and conserve money at every step', () => {
    const seen = new Map<string, number>();
    const count = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);
    let failures = 0;

    for (let seed = 1; seed <= 100_000; seed += 1) {
      const hand = playRandom(seed, RULES, (previous, state, events, opening) => {
        const a = audit(previous, state, events, opening);
        // One `expect` per failure, not per step: 300,000 deep compares are the slow part.
        const ok =
          a.parsed.success &&
          a.badEvents.length === 0 &&
          JSON.stringify(sorted(a.folded)) === JSON.stringify(sorted(a.table)) &&
          a.balance === a.expectedBalance;
        if (!ok && failures++ < 3) {
          expect({ seed, error: a.parsed.error?.message, badEvents: a.badEvents }).toEqual({
            seed,
            error: undefined,
            badEvents: [],
          });
          expect(a.folded).toEqual(a.table);
          expect(a.balance).toBe(a.expectedBalance);
        }
      });

      const last = view(hand.states.at(-1) ?? hand.states[0]!);
      count(`hands:${last.hands.length}`);
      for (const h of last.hands) {
        count(`outcome:${h.outcome}`);
        if (h.doubled && h.fromSplit) count('double-after-split');
      }
      for (const d of hand.decisions) count(`action:${d.action}`);
      if (last.dealer.cards.length > 2) count('dealer-drew');
    }

    expect(failures).toBe(0);
    // The run is only as good as what it reached: every action, every outcome, four hands.
    for (const action of ACTIONS) expect(seen.get(`action:${action}`)).toBeGreaterThan(100);
    for (const outcome of ['WIN', 'LOSE', 'PUSH', 'BLACKJACK']) {
      expect(seen.get(`outcome:${outcome}`)).toBeGreaterThan(1000);
    }
    expect(seen.get('hands:4')).toBeGreaterThan(10);
    expect(seen.get('double-after-split')).toBeGreaterThan(100);
    expect(seen.get('dealer-drew')).toBeGreaterThan(1000);
  }, 120_000);
});

describe('allowed at every decision of 10,000 hands, under random rules', () => {
  it('matches an oracle written from §4.2, and act agrees with it action by action', () => {
    let decisions = 0;
    const mismatches: unknown[] = [];

    for (let seed = 1; seed <= 10_000; seed += 1) {
      const rules = someRules(mulberry32(seed * 7919));
      const shoe = seededShoe(seed);
      playRandom(
        seed,
        rules,
        () => {},
        (state) => {
          decisions += 1;
          const offered = allowed(state);
          const expected = oracle(view(state), state.balance, rules);
          if (offered.join() !== expected.join()) mismatches.push({ seed, offered, expected });
          for (const action of ACTIONS) {
            const accepted = act(state, action, shoe).ok;
            if (accepted !== offered.includes(action)) {
              mismatches.push({ seed, action, accepted });
            }
          }
        },
      );
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(decisions).toBeGreaterThan(10_000);
  }, 60_000);
});

describe('replay', () => {
  it('reproduces 10,000 random hands from their decisions alone', () => {
    for (let seed = 1; seed <= 10_000; seed += 1) {
      const played = playRandom(seed, RULES, () => {});
      const replayed = replay({
        rules: RULES,
        seeds: SEEDS,
        stake: played.stake,
        decisions: played.decisions,
        shoe: seededShoe(seed),
      });
      if (!replayed.ok) throw new Error(`seed ${seed}: replay refused at ${replayed.at}`);
      const final = played.states.at(-1);
      if (final === undefined) throw new Error('no state');
      if (JSON.stringify(view(replayed.state)) !== JSON.stringify(view(final))) {
        expect(view(replayed.state)).toEqual(view(final));
      }
      if (JSON.stringify(replayed.events) !== JSON.stringify(played.steps)) {
        expect(replayed.events).toEqual(played.steps);
      }
    }
  }, 60_000);
});

/**
 * `allowed` as docs/protocol.md §4.2 words it, read off the wire snapshot with nothing from the
 * engine — its own card points, its own idea of a split ace. A second reading of the rules, so the
 * engine's cannot drift from the document unnoticed.
 */
function oracle(round: Round, balance: Minor, rules: Rules): Action[] {
  if (round.phase === 'SETTLED') return [];
  if (round.phase === 'INSURANCE') {
    return balance * 2 >= round.stake ? ['insurance', 'noInsurance'] : ['noInsurance'];
  }
  const hand = round.hands[round.activeHand ?? -1];
  if (hand === undefined) throw new Error('PLAYER with no active hand');
  const points = (c: string) =>
    'TJQK'.includes(c[0] ?? '') ? 10 : c[0] === 'A' ? 1 : Number(c[0]);
  const [a, b] = hand.cards;
  const twoCards = hand.cards.length === 2 && a !== undefined && b !== undefined;
  const splitAce = hand.fromSplit && hand.cards[0]?.[0] === 'A';
  const covers = balance >= hand.stake;

  const result: Action[] = [];
  if (!(splitAce && !rules.hitSplitAces)) result.push('hit');
  result.push('stand');
  if (
    twoCards &&
    covers &&
    !(splitAce && !rules.hitSplitAces) &&
    (!hand.fromSplit || rules.doubleAfterSplit)
  ) {
    result.push('double');
  }
  if (
    twoCards &&
    covers &&
    points(a) === points(b) &&
    round.hands.length < rules.maxHands &&
    !(splitAce && !rules.resplitAces)
  ) {
    result.push('split');
  }
  return result;
}

/** Key-sorted JSON, for a cheap structural compare in the hot loop. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([k, v]) => [k, sorted(v)]),
    );
  }
  return value;
}
