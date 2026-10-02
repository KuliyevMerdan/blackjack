// @vitest-environment happy-dom
import { inMemory, SentRounds, type Client, type Read } from '@blackjack/client-core';
import { act, allowed, deal, dealt, view } from '@blackjack/engine';
import { bytesToHex, commit, sha256, shoe, utf8 } from '@blackjack/fair';
import { minor } from '@blackjack/money';
import { PUBLISHED_RULES, fairRecord, rules, type FairRecord } from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import { mountVerify } from './page.js';

/** A settled round's honest record, played by standing, from a client seed of the test's choosing. */
function record(clientSeed: string): FairRecord {
  const serverSeed = bytesToHex(sha256(utf8('page')));
  const cards = shoe(serverSeed, clientSeed);
  const seeds = {
    roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
    commit: commit(serverSeed),
    clientSeed,
    serverSeed,
    forced: false,
  };
  const r = rules.parse(PUBLISHED_RULES);
  const first = deal(
    { type: 'deal', rules: r, seeds, stake: minor(500), balance: minor(100_000) },
    cards,
  );
  if (!first.ok) throw new Error(first.refusal);
  let state = first.state;
  const decisions = [];
  while (state.phase !== 'SETTLED') {
    const action = allowed(state).includes('noInsurance') ? 'noInsurance' : 'stand';
    decisions.push({ seq: state.seq, action });
    const next = act(state, action, cards);
    if (!next.ok) throw new Error(next.refusal);
    state = next.state;
  }
  return fairRecord.parse({
    roundId: seeds.roundId,
    settledAt: 1_759_400_000_000,
    rules: r,
    commit: seeds.commit,
    serverSeed,
    clientSeed,
    stake: 500,
    decisions,
    dealt: dealt(state, cards),
    round: view(state),
  });
}

/** Just the slice of a client the page uses: the record, and this browser's memory. */
function clientWith(answer: Read<FairRecord>, remembered: FairRecord | null): Client {
  const sent = new SentRounds(inMemory());
  if (remembered)
    sent.add({
      roundId: remembered.roundId,
      commit: remembered.commit,
      clientSeed: remembered.clientSeed,
    });
  const fake = { fairRecord: async () => answer, sent };
  return fake as unknown as Client;
}

const deps = (client: Client) => ({
  client,
  format: (m: number) => `€${m / 100}`,
  instant: true,
  sleep: async () => {},
});

describe('the verification page', () => {
  it('shows each check, the verdict, the round replayed, and the rules', async () => {
    const r = record('my seed');
    const root = document.createElement('div');
    const report = await mountVerify(
      root,
      r.roundId,
      deps(clientWith({ kind: 'ok', value: r }, r)),
    );
    expect(report?.verdict).toBe('verified');
    const steps = [...root.querySelectorAll('.step')];
    expect(steps.map((s) => s.className)).toEqual([
      'step pass',
      'step pass',
      'step pass',
      'step pass',
    ]);
    expect(root.querySelector('.verdict')?.textContent).toMatch(/^Verified/);
    expect(root.querySelectorAll('.replay li').length).toBeGreaterThan(5);
    expect(root.querySelector('.rules')?.textContent).toContain('Blackjack pays 3 to 2');
  });

  it('prints a client seed as text, whatever it contains', async () => {
    const r = record('<img src=x onerror="alert(1)">');
    const root = document.createElement('div');
    await mountVerify(root, r.roundId, deps(clientWith({ kind: 'ok', value: r }, r)));
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('says plainly when there is no such settled round', async () => {
    const root = document.createElement('div');
    const report = await mountVerify(
      root,
      '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
      deps(clientWith({ kind: 'unknown' }, null)),
    );
    expect(report).toBeNull();
    expect(root.textContent).toMatch(/No settled round has that id/);
  });

  it('a record whose client seed is not the one this browser sent fails, at step 2', async () => {
    const mine = record('mine');
    const theirs = record('theirs');
    const root = document.createElement('div');
    const report = await mountVerify(
      root,
      mine.roundId,
      deps(clientWith({ kind: 'ok', value: theirs }, mine)),
    );
    expect(report?.verdict).toBe('failed');
    expect([...root.querySelectorAll('.step')][1]?.className).toBe('step fail');
  });
});
