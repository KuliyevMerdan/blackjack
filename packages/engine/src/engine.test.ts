import type { Card } from '@blackjack/cards';
import { InexactAmountError, minor, type Minor } from '@blackjack/money';
import type { Action, GameEvent, Round, Rules } from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import { BALANCE, RULES, SEEDS, STAKE, audit, stacked } from './__fixtures__/table.js';
import { act, allowed, deal, dealt, maxExposure, step, view } from './engine.js';
import { replay } from './replay.js';
import type { State } from './state.js';

interface Options {
  readonly rules?: Rules;
  readonly balance?: Minor;
  readonly stake?: Minor;
}

interface Played {
  readonly state: State;
  readonly round: Round;
  /** Each step's events: the deal's, then one list per action. */
  readonly steps: readonly (readonly GameEvent[])[];
}

/** Deals from a stacked shoe and plays `actions`, auditing every step on the way. */
function play(shoe: readonly Card[], actions: readonly Action[], options: Options = {}): Played {
  const opening = options.balance ?? BALANCE;
  const first = deal(
    {
      type: 'deal',
      rules: options.rules ?? RULES,
      seeds: SEEDS,
      stake: options.stake ?? STAKE,
      balance: opening,
    },
    shoe,
  );
  if (!first.ok) throw new Error(`deal refused: ${first.refusal}`);
  let state = first.state;
  let previous: Round | null = null;
  const steps: (readonly GameEvent[])[] = [];
  const check = (events: readonly GameEvent[]) => {
    const a = audit(previous, state, events, opening);
    expect(a.parsed.error).toBeUndefined();
    expect(a.badEvents).toEqual([]);
    expect(a.folded).toEqual(a.table);
    expect(a.balance).toBe(a.expectedBalance);
    previous = a.snapshot;
    steps.push(events);
  };
  check(first.events);
  for (const action of actions) {
    const next = act(state, action, shoe);
    if (!next.ok) throw new Error(`${action} refused: ${next.refusal} (allowed ${allowed(state)})`);
    state = next.state;
    check(next.events);
  }
  return { state, round: view(state), steps };
}

const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

describe('the deal', () => {
  it('deals player, dealer up, player, hole — and the hole card never travels', () => {
    const { round, steps } = play(stacked('9H', 'KS', '9C', '7D'), []);
    expect(steps[0]).toEqual([
      { type: 'roundStarted', stake: 500 },
      { type: 'cardDealt', to: 0, card: '9H' },
      { type: 'cardDealt', to: 'dealer', card: 'KS' },
      { type: 'cardDealt', to: 0, card: '9C' },
      { type: 'holeDealt' },
      { type: 'dealerPeeked', blackjack: false },
      { type: 'activeHandChanged', hand: 0 },
    ]);
    expect(round.dealer).toEqual({ cards: ['KS'], holeHidden: true });
    expect(JSON.stringify(round)).not.toContain('7D');
    expect(JSON.stringify(steps)).not.toContain('7D');
    expect(round.serverSeed).toBeUndefined();
    expect(round).toMatchObject({ seq: 0, phase: 'PLAYER', activeHand: 0, totalStake: 500 });
    expect(round.allowed).toEqual(['hit', 'stand', 'double', 'split']);
  });

  it('does not peek under a small card', () => {
    const { steps } = play(stacked('9H', '6S', '9C', '7D'), []);
    expect(types(steps[0] ?? [])).not.toContain('dealerPeeked');
  });

  it('settles a player blackjack in the deal reply, paying 3:2', () => {
    const { round, state, steps } = play(stacked('AH', '9S', 'KC', '7D'), []);
    expect(types(steps[0] ?? [])).toEqual([
      'roundStarted',
      'cardDealt',
      'cardDealt',
      'cardDealt',
      'holeDealt',
      'holeRevealed',
      'handSettled',
      'roundSettled',
    ]);
    expect(round.phase).toBe('SETTLED');
    expect(round.hands[0]).toMatchObject({
      state: 'BLACKJACK',
      outcome: 'BLACKJACK',
      payout: 1250,
    });
    expect(round.dealer).toEqual({ cards: ['9S', '7D'], holeHidden: false });
    expect(round.serverSeed).toBe(SEEDS.serverSeed);
    expect(state.balance).toBe(BALANCE + 750);
  });

  it('settles a dealer blackjack under a ten-value in the deal reply', () => {
    const { round, steps } = play(stacked('9H', 'KS', '9C', 'AD'), []);
    expect(types(steps[0] ?? []).slice(5)).toEqual([
      'dealerPeeked',
      'holeRevealed',
      'handSettled',
      'roundSettled',
    ]);
    expect(round.hands[0]).toMatchObject({ outcome: 'LOSE', payout: 0 });
    expect(round.totalPayout).toBe(0);
  });

  it('pushes blackjack against blackjack', () => {
    const { round } = play(stacked('AH', 'KS', 'TC', 'AD'), []);
    expect(round.hands[0]).toMatchObject({ state: 'BLACKJACK', outcome: 'PUSH', payout: 500 });
  });

  it('waits on insurance under an ace, without peeking', () => {
    const { round, steps } = play(stacked('9H', 'AS', '9C', 'KD'), []);
    expect(types(steps[0] ?? []).at(-1)).toBe('insuranceOffered');
    expect(types(steps[0] ?? [])).not.toContain('dealerPeeked');
    expect(round).toMatchObject({ phase: 'INSURANCE', activeHand: null, insurance: null });
    expect(round.allowed).toEqual(['insurance', 'noInsurance']);
    expect(JSON.stringify(steps)).not.toContain('KD');
  });

  it('peeks straight away under an ace at a table without insurance', () => {
    const rules = { ...RULES, insurance: false };
    const { round } = play(stacked('9H', 'AS', '9C', 'KD'), [], { rules });
    expect(round.phase).toBe('SETTLED');
    expect(round.insurance).toBeNull();
  });

  it('refuses a deal it cannot cover, and one on an open round', () => {
    const shoe = stacked('9H', 'KS', '9C', '7D');
    const command = { type: 'deal', rules: RULES, seeds: SEEDS, stake: STAKE } as const;
    expect(deal({ ...command, balance: minor(499) }, shoe)).toEqual({
      ok: false,
      refusal: 'INSUFFICIENT_FUNDS',
    });
    const open = deal({ ...command, balance: BALANCE }, shoe);
    if (!open.ok) throw new Error('deal refused');
    expect(step(open.state, { ...command, balance: BALANCE }, shoe)).toEqual({
      ok: false,
      refusal: 'ROUND_OPEN',
    });
    const settled = play(stacked('AH', '9S', 'KC', '7D', '9H', 'KS', '9C', '7D'), []);
    expect(step(settled.state, { ...command, balance: BALANCE }, shoe).ok).toBe(true);
  });

  it('throws at the deal on a stake no payout of which is exact', () => {
    const shoe = stacked('9H', 'KS', '9C', '7D');
    const command = { type: 'deal', rules: RULES, seeds: SEEDS, balance: BALANCE } as const;
    expect(() => deal({ ...command, stake: minor(501) }, shoe)).toThrow(InexactAmountError);
  });

  it('marks a forced shoe on the snapshot', () => {
    const shoe = stacked('9H', 'KS', '9C', '7D');
    const forced = deal(
      {
        type: 'deal',
        rules: RULES,
        seeds: { ...SEEDS, forced: true },
        stake: STAKE,
        balance: BALANCE,
      },
      shoe,
    );
    if (!forced.ok) throw new Error('deal refused');
    expect(view(forced.state).forced).toBe(true);
    expect(view(play(shoe, []).state).forced).toBeUndefined();
  });
});

describe('insurance', () => {
  const dealerBlackjack = stacked('9H', 'AS', '9C', 'KD');
  const noBlackjack = stacked('9H', 'AS', '9C', '7D', '2C');

  it('taken against a dealer blackjack: the hand loses, insurance pays 2:1, money is even', () => {
    const { round, state, steps } = play(dealerBlackjack, ['insurance']);
    expect(types(steps[1] ?? [])).toEqual([
      'insuranceDecided',
      'dealerPeeked',
      'holeRevealed',
      'insuranceSettled',
      'handSettled',
      'roundSettled',
    ]);
    expect(round.insurance).toEqual({ stake: 250, payout: 750 });
    expect(round).toMatchObject({ totalStake: 750, totalPayout: 750, phase: 'SETTLED' });
    expect(state.balance).toBe(BALANCE);
  });

  it('declined against a dealer blackjack: the stake is lost and nothing else', () => {
    const { round, state, steps } = play(dealerBlackjack, ['noInsurance']);
    expect(types(steps[1] ?? [])).not.toContain('insuranceSettled');
    expect(round.insurance).toEqual({ stake: 0 });
    expect(state.balance).toBe(BALANCE - 500);
  });

  it('taken with no dealer blackjack: lost at the peek, and play goes on', () => {
    const { round, steps } = play(noBlackjack, ['insurance']);
    expect(steps[1]).toEqual([
      { type: 'insuranceDecided', stake: 250 },
      { type: 'dealerPeeked', blackjack: false },
      { type: 'insuranceSettled', payout: 0 },
      { type: 'activeHandChanged', hand: 0 },
    ]);
    expect(round).toMatchObject({ phase: 'PLAYER', totalStake: 750 });
    expect(JSON.stringify(round)).not.toContain('7D');
  });

  it('a player blackjack against an ace, insurance declined: 3:2 once the peek is clean', () => {
    const { round, state } = play(stacked('AH', 'AS', 'KC', '7D'), ['noInsurance']);
    expect(round.hands[0]).toMatchObject({ outcome: 'BLACKJACK', payout: 1250 });
    expect(state.balance).toBe(BALANCE + 750);
  });

  it('a player blackjack against an ace, insurance taken: even money either way', () => {
    const clean = play(stacked('AH', 'AS', 'KC', '7D'), ['insurance']);
    const dealerToo = play(stacked('AH', 'AS', 'KC', 'QD'), ['insurance']);
    expect(clean.state.balance).toBe(BALANCE + 500);
    expect(dealerToo.state.balance).toBe(BALANCE + 500);
    expect(dealerToo.round.hands[0]).toMatchObject({ outcome: 'PUSH' });
  });

  it('is not offered when the balance cannot cover half the stake', () => {
    const { round } = play(noBlackjack, [], { balance: minor(700) });
    expect(round.allowed).toEqual(['noInsurance']);
  });
});

describe('decisions', () => {
  it('hit, then stand: the dealer turns, draws to 17 and settles', () => {
    // 9+2, hit 5 = 16, stand. Dealer K+6 = 16, draws 3 = 19.
    const { round, steps } = play(stacked('9H', 'KS', '2C', '6D', '5S', '3H'), ['hit', 'stand']);
    expect(steps[1]).toEqual([{ type: 'cardDealt', to: 0, card: '5S' }]);
    expect(types(steps[2] ?? [])).toEqual([
      'handStood',
      'activeHandChanged',
      'holeRevealed',
      'cardDealt',
      'handSettled',
      'roundSettled',
    ]);
    expect(round.dealer.cards).toEqual(['KS', '6D', '3H']);
    expect(round.hands[0]).toMatchObject({ state: 'STOOD', outcome: 'LOSE', payout: 0 });
    expect(round.seq).toBe(2);
  });

  it('stands on soft 17, and hits it where the rules say so', () => {
    const shoe = stacked('TH', 'AS', '8C', '6D', 'AC');
    const insured = ['noInsurance', 'stand'] as const;
    expect(play(shoe, insured).round.dealer.cards).toEqual(['AS', '6D']);
    const h17 = play(shoe, insured, { rules: { ...RULES, dealerHitsSoft17: true } });
    expect(h17.round.dealer.cards).toEqual(['AS', '6D', 'AC']);
    expect(h17.round.hands[0]?.outcome).toBe('PUSH');
  });

  it('busts a hand over 21 and does not draw for a dealer with nothing to beat', () => {
    const { round, steps } = play(stacked('TH', '6S', '6C', 'TD', 'KS', '5H'), ['hit']);
    expect(types(steps[1] ?? [])).toEqual([
      'cardDealt',
      'handBusted',
      'activeHandChanged',
      'holeRevealed',
      'handSettled',
      'roundSettled',
    ]);
    expect(round.dealer.cards).toEqual(['6S', 'TD']);
    expect(round.hands[0]).toMatchObject({ state: 'BUST', outcome: 'LOSE' });
  });

  it('stands automatically on 21', () => {
    const { round, steps } = play(stacked('9H', '7S', '2C', 'TD', 'KS'), ['hit']);
    expect(steps[1]?.[1]).toEqual({ type: 'handStood', hand: 0, auto: true });
    expect(round.hands[0]).toMatchObject({ state: 'DONE', outcome: 'WIN', payout: 1000 });
  });

  it('lets the player choose on 21 where the rules do not stand for them', () => {
    const rules = { ...RULES, autoStandOn21: false };
    const { round } = play(stacked('9H', '7S', '2C', 'TD', 'KS'), ['hit'], { rules });
    expect(round.allowed).toEqual(['hit', 'stand']);
  });

  it('doubles: twice the stake, one card, done', () => {
    const { round, state, steps } = play(stacked('6H', '7S', '5C', 'TD', '9S'), ['double']);
    expect(steps[1]?.slice(0, 3)).toEqual([
      { type: 'handDoubled', hand: 0, stake: 500 },
      { type: 'cardDealt', to: 0, card: '9S' },
      { type: 'handStood', hand: 0, auto: true },
    ]);
    expect(round.hands[0]).toMatchObject({
      stake: 1000,
      doubled: true,
      state: 'DONE',
      outcome: 'WIN',
      payout: 2000,
    });
    expect(round.totalStake).toBe(1000);
    expect(state.balance).toBe(BALANCE + 1000);
  });

  it('busts a double', () => {
    const { round } = play(stacked('TH', '7S', '6C', 'TD', '9S'), ['double']);
    expect(round.hands[0]).toMatchObject({ state: 'BUST', doubled: true, payout: 0 });
  });

  it('offers double on two cards only, and only when the balance covers it', () => {
    const shoe = stacked('6H', '7S', '5C', 'TD', '2S');
    expect(play(shoe, ['hit']).round.allowed).toEqual(['hit', 'stand']);
    expect(play(shoe, [], { balance: minor(999) }).round.allowed).toEqual(['hit', 'stand']);
    expect(play(shoe, [], { balance: minor(1000) }).round.allowed).toContain('double');
  });

  it('splits by value: a king and a ten are a pair', () => {
    const { round } = play(stacked('KH', '7S', 'TC', 'TD'), []);
    expect(round.allowed).toContain('split');
    expect(play(stacked('KH', '7S', '9C', 'TD'), []).round.allowed).not.toContain('split');
  });

  it('splits: the second card moves, the first hand draws, the second waits its turn', () => {
    // 9 9 v 7: split; hand 0 gets T (19), stand; hand 1 gets 2 (11), double gets 8 (19).
    // Dealer 7+T = 17. Both win — the wire fixture's round, played.
    const shoe = stacked('9H', '7D', '9C', 'TS', 'TD', '2S', '8H');
    const { round, steps } = play(shoe, ['split', 'stand', 'double']);
    expect(steps[1]).toEqual([
      { type: 'handSplit', hand: 0, newHand: 1, stake: 500 },
      { type: 'cardDealt', to: 0, card: 'TD' },
    ]);
    expect(steps[2]).toEqual([
      { type: 'handStood', hand: 0, auto: false },
      { type: 'activeHandChanged', hand: 1 },
      { type: 'cardDealt', to: 1, card: '2S' },
    ]);
    expect(round.hands.map((h) => h.cards)).toEqual([
      ['9H', 'TD'],
      ['9C', '2S', '8H'],
    ]);
    expect(round).toMatchObject({ totalStake: 1500, totalPayout: 3000 });
  });

  it('a split hand that makes 21 in two cards is 21, not a blackjack', () => {
    const { round } = play(stacked('KH', '7S', 'KC', 'TD', 'AS', '2C', '8H'), ['split']);
    expect(round.hands[0]).toMatchObject({ state: 'DONE', cards: ['KH', 'AS'] });
  });

  it('split aces take one card each and cannot be split again, hit or doubled', () => {
    // A A v 6: split; hand 0 gets A (soft 12, done anyway), hand 1 gets K (21, not blackjack).
    // Dealer 6+T draws 2: 18.
    const shoe = stacked('AH', '6S', 'AC', 'TD', 'AS', 'KH', '2C');
    const { round, steps } = play(shoe, ['split']);
    expect(types(steps[1] ?? [])).toEqual([
      'handSplit',
      'cardDealt',
      'handStood',
      'activeHandChanged',
      'cardDealt',
      'handStood',
      'activeHandChanged',
      'holeRevealed',
      'cardDealt',
      'handSettled',
      'handSettled',
      'roundSettled',
    ]);
    expect(round.hands.map((h) => [h.state, h.outcome])).toEqual([
      ['DONE', 'LOSE'],
      ['DONE', 'WIN'],
    ]);

    const rules = { ...RULES, hitSplitAces: true };
    const open = play(shoe, ['split'], { rules }).round;
    expect(open.allowed).toEqual(['hit', 'stand', 'double']);
  });

  it('splits to four hands, doubles each, and the dealer busts', () => {
    const shoe = stacked(
      ...['8S', '6H', '8D', 'TC'], // the deal: 8 8 v 6, hole T
      ...['8H', '8C', '3S'], // split, split, split; hand 0 draws to 11
      'TS', // double hand 0: 21
      ...['2H', '9H'], // hand 1 draws 2 (10), doubles to 19
      ...['3D', '5C'], // hand 2 draws 3 (11), doubles to 16
      ...['2C', '7S'], // hand 3 draws 2 (10), doubles to 17
      'TD', // dealer 16 draws ten: bust
    );
    const actions = ['split', 'split', 'split', 'double', 'double', 'double', 'double'] as const;
    const { round, state } = play(shoe, actions);
    expect(round.hands.map((h) => h.cards)).toEqual([
      ['8S', '3S', 'TS'],
      ['8C', '2H', '9H'],
      ['8H', '3D', '5C'],
      ['8D', '2C', '7S'],
    ]);
    expect(round.hands.every((h) => h.doubled && h.stake === 1000 && h.outcome === 'WIN')).toBe(
      true,
    );
    expect(round).toMatchObject({ totalStake: 4000, totalPayout: 8000, seq: 7 });
    expect(round.dealer.cards).toEqual(['6H', 'TC', 'TD']);
    expect(state.balance).toBe(BALANCE + 4000);
    expect(dealt(state, shoe)).toEqual(shoe);
  });

  it('stops splitting at four hands', () => {
    const shoe = stacked('8S', '6H', '8D', 'TC', '8H', '8C', '8C');
    const { round } = play(shoe, ['split', 'split', 'split']);
    expect(round.hands).toHaveLength(4);
    expect(round.hands[0]?.cards).toEqual(['8S', '8C']);
    expect(round.allowed).toEqual(['hit', 'stand', 'double']);
  });

  it('offers split only when the balance covers another stake', () => {
    const shoe = stacked('8S', '6H', '8D', 'TC');
    expect(play(shoe, [], { balance: minor(999) }).round.allowed).toEqual(['hit', 'stand']);
  });
});

describe('refusals', () => {
  const shoe = stacked('9H', 'KS', '2C', '7D', '5S', '3H');

  it('refuses every action outside allowed, and changes nothing', () => {
    const { state } = play(shoe, ['hit']);
    for (const action of ['double', 'split', 'insurance', 'noInsurance'] as const) {
      expect(act(state, action, shoe)).toEqual({ ok: false, refusal: 'ACTION_NOT_ALLOWED' });
    }
  });

  it('refuses insurance decisions outside INSURANCE, and hand decisions inside it', () => {
    const insurance = play(stacked('9H', 'AS', '9C', '7D'), []).state;
    for (const action of ['hit', 'stand', 'double', 'split'] as const) {
      expect(act(insurance, action, shoe).ok).toBe(false);
    }
  });

  it('refuses to act on no round, or a settled one', () => {
    expect(act(null, 'hit', shoe)).toEqual({ ok: false, refusal: 'NO_OPEN_ROUND' });
    const settled = play(stacked('AH', '9S', 'KC', '7D'), []).state;
    expect(step(settled, { type: 'act', action: 'stand' }, shoe)).toEqual({
      ok: false,
      refusal: 'NO_OPEN_ROUND',
    });
  });

  it('throws on a shoe too short for the round rather than inventing a card', () => {
    const { state } = play(stacked('9H', 'KS', '2C', '7D'), []);
    expect(() => act(state, 'hit', stacked('9H', 'KS', '2C', '7D'))).toThrow(/ran out/);
  });

  it('leaves the state it was given untouched', () => {
    const { state } = play(shoe, []);
    const before = structuredClone(state);
    act(state, 'hit', shoe);
    act(state, 'stand', shoe);
    expect(state).toEqual(before);
  });
});

describe('replay', () => {
  const shoe = stacked('9H', '7D', '9C', 'TS', 'TD', '2S', '8H');
  const input = {
    rules: RULES,
    seeds: SEEDS,
    stake: STAKE,
    shoe,
    decisions: [
      { seq: 0, action: 'split' },
      { seq: 1, action: 'stand' },
      { seq: 2, action: 'double' },
    ],
  } as const;

  it('reproduces the round from its seeds and decisions, without knowing the balance', () => {
    const played = play(shoe, ['split', 'stand', 'double']);
    const replayed = replay(input);
    if (!replayed.ok) throw new Error(`replay refused: ${replayed.refusal}`);
    expect(view(replayed.state)).toEqual(played.round);
    expect(replayed.events).toEqual(played.steps);
  });

  it('refuses a decision on the wrong version, and one the rules refuse', () => {
    const stale = { ...input, decisions: [{ seq: 1, action: 'split' }] } as const;
    expect(replay(stale)).toEqual({ ok: false, at: 0, refusal: 'STALE_SEQ' });
    const illegal = { ...input, decisions: [{ seq: 0, action: 'insurance' }] } as const;
    expect(replay(illegal)).toEqual({ ok: false, at: 0, refusal: 'ACTION_NOT_ALLOWED' });
    const late = {
      ...input,
      decisions: [...input.decisions, { seq: 3, action: 'stand' }],
    } as const;
    expect(replay(late)).toEqual({ ok: false, at: 3, refusal: 'NO_OPEN_ROUND' });
  });

  it('replays with enough to afford any round at the stake', () => {
    expect(maxExposure(RULES, STAKE)).toBe(4250);
  });
});
