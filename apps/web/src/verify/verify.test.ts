import { card, type Card } from '@blackjack/cards';
import type { Sent } from '@blackjack/client-core';
import { act, allowed, deal, dealt, view, type State } from '@blackjack/engine';
import { bytesToHex, commit, sha256, shoe, utf8 } from '@blackjack/fair';
import { minor } from '@blackjack/money';
import {
  PUBLISHED_RULES,
  fairRecord,
  rules as rulesSchema,
  type Action,
  type FairRecord,
} from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import { verify } from './verify.js';

/**
 * The verifier against a lying server (ROADMAP C3): every record here is built the way
 * `apps/server` builds one — the engine over the protocol shuffle — and then lied about in one way.
 * Each lie must turn the verdict to `failed`, at the step that catches it.
 */

const RULES = rulesSchema.parse(PUBLISHED_RULES);
const f = (m: number) => `€${m / 100}`;
const seedOf = (label: string) => bytesToHex(sha256(utf8(label)));

/** An honest record of a round played by `choose`, from `top` stacked on the shuffle if given. */
function played(
  label: string,
  clientSeed: string,
  choose: (state: State) => Action,
  top: readonly Card[] = [],
): FairRecord {
  const serverSeed = seedOf(label);
  const cards = [...top, ...shoe(serverSeed, clientSeed)];
  const seeds = {
    roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
    commit: commit(serverSeed),
    clientSeed,
    serverSeed,
    forced: top.length > 0,
  };
  const first = deal(
    { type: 'deal', rules: RULES, seeds, stake: minor(500), balance: minor(100_000) },
    cards,
  );
  if (!first.ok) throw new Error(first.refusal);
  let state = first.state;
  const decisions: { seq: number; action: Action }[] = [];
  while (state.phase !== 'SETTLED') {
    const action = choose(state);
    decisions.push({ seq: state.seq, action });
    const next = act(state, action, cards);
    if (!next.ok) throw new Error(next.refusal);
    state = next.state;
  }
  return fairRecord.parse({
    roundId: seeds.roundId,
    settledAt: 1_759_400_000_000,
    rules: RULES,
    commit: seeds.commit,
    serverSeed,
    clientSeed,
    stake: 500,
    decisions,
    dealt: dealt(state, cards),
    round: view(state),
  });
}

/** Split when it may, else double, else stand — a round with decisions worth replaying. */
const busy = (state: State): Action => {
  const offered = allowed(state);
  for (const a of ['noInsurance', 'split', 'double', 'stand'] as const) {
    if (offered.includes(a)) return a;
  }
  return offered[0] ?? 'stand';
};

const sentFor = (r: FairRecord): Sent => ({
  roundId: r.roundId,
  commit: r.commit,
  clientSeed: r.clientSeed,
});

const stacked = (...codes: string[]) => codes.map((c) => card(c));
/** 8-8 against a 6, then cards that let a split, a resplit and a double happen. */
const PAIRS = stacked('8S', '6H', '8D', 'TC', '8H', '3D', '2S', '9D', 'TH');

/** The first honest round of `n` with at least one decision in it. */
function honest(n = 0): FairRecord {
  for (let i = n; i < n + 50; i += 1) {
    const r = played(`verify:${i}`, `seed-${i}`, busy);
    if (r.decisions.length > 0) return r;
  }
  throw new Error('fifty rounds and no decision');
}

const statuses = (r: FairRecord, sent: Sent | null) =>
  Object.fromEntries(verify(r, sent, f).steps.map((s) => [s.id, s.status]));

describe('an honest record', () => {
  it('passes all four checks in the browser that played it', () => {
    const r = honest();
    const report = verify(r, sentFor(r), f);
    expect(report.verdict).toBe('verified');
    expect(statuses(r, sentFor(r))).toEqual({
      commit: 'pass',
      memory: 'pass',
      shuffle: 'pass',
      replay: 'pass',
    });
    expect(report.replayed[0]).toBe('Stake €5.');
    expect(report.replayed.at(-1)).toMatch(/^Round settled/);
  });

  it('passes in a stranger’s browser, which says it cannot vouch for the seeds', () => {
    const r = honest(3);
    const report = verify(r, null, f);
    expect(report.verdict).toBe('verified');
    expect(statuses(r, null).memory).toBe('unknown');
  });

  it('passes for a hundred rounds of every kind', () => {
    const wrong: unknown[] = [];
    for (let i = 0; i < 100; i += 1) {
      const r = played(`many:${i}`, `s${i}`, busy);
      const report = verify(r, sentFor(r), f);
      if (report.verdict !== 'verified') wrong.push({ i, steps: report.steps });
    }
    expect(wrong.slice(0, 1)).toEqual([]);
  }, 30_000);
});

describe('a lying server is caught', () => {
  it('a server seed that is not the committed one', () => {
    const r = honest();
    const lie = { ...r, serverSeed: seedOf('another') };
    expect(verify(lie, sentFor(r), f).verdict).toBe('failed');
    expect(statuses(lie, sentFor(r)).commit).toBe('fail');
  });

  it('a seed and commit swapped together after the fact — the browser remembers the commit', () => {
    const r = honest();
    const other = seedOf('picked after seeing the client seed');
    const lie = { ...r, serverSeed: other, commit: commit(other) };
    const s = statuses(lie, sentFor(r));
    expect(s.commit).toBe('pass'); // consistent with itself…
    expect(s.memory).toBe('fail'); // …but not with what this browser was shown before the bet
  });

  it('a swapped card in the record of what was dealt', () => {
    const r = honest();
    const dealtCards = [...r.dealt];
    const [a, b] = [dealtCards[0], dealtCards[2]];
    if (a === undefined || b === undefined || a === b) throw new Error('need two different cards');
    dealtCards[0] = b;
    dealtCards[2] = a;
    const lie = { ...r, dealt: dealtCards };
    expect(verify(lie, sentFor(r), f).verdict).toBe('failed');
    expect(statuses(lie, sentFor(r)).shuffle).toBe('fail');
  });

  it('a swapped card in the round the player was shown', () => {
    const r = honest();
    const [h] = r.round.hands;
    if (h === undefined) throw new Error('no hand');
    const swapped = h.cards[0] === card('KS') ? card('QS') : card('KS');
    const lie = {
      ...r,
      round: {
        ...r.round,
        hands: [{ ...h, cards: [swapped, ...h.cards.slice(1)] }, ...r.round.hands.slice(1)],
      },
    };
    expect(statuses(lie, sentFor(r)).replay).toBe('fail');
  });

  it('a changed decision', () => {
    const r = honest();
    const [first, ...rest] = r.decisions;
    if (first === undefined) throw new Error('no decision');
    const other: Action = first.action === 'stand' ? 'hit' : 'stand';
    const lie = { ...r, decisions: [{ ...first, action: other }, ...rest] };
    const s = statuses(lie, sentFor(r));
    expect(s).toMatchObject({ commit: 'pass', memory: 'pass', shuffle: 'pass', replay: 'fail' });
    // And a record with its decisions erased cannot reach the recorded result either.
    expect(statuses({ ...r, decisions: [] }, sentFor(r)).replay).toBe('fail');
  });

  it('a different client seed than the one this browser sent', () => {
    // The server dealt honestly — but from a client seed of its own choosing, not the player's.
    const mine = honest();
    const theirs = played('verify:0', 'the servers choice', busy);
    const s = statuses({ ...theirs, roundId: mine.roundId }, sentFor(mine));
    expect(s.shuffle).toBe('pass'); // the shuffle is consistent with the seed it names…
    expect(s.memory).toBe('fail'); // …which is not the seed this browser sent
  });
});

describe('a forced shoe', () => {
  it('is reported as not verifiable, never as verified', () => {
    const r = played('forced', 'f', busy, PAIRS);
    expect(r.round.forced).toBe(true);
    const report = verify(r, sentFor(r), f);
    expect(report.verdict).toBe('unverifiable');
    expect(statuses(r, sentFor(r)).shuffle).toBe('forced');
  });
});
