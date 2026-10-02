import { faultsReply, roundReply, sessionReply } from '@blackjack/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { Faults, NO_FAULTS } from './faults.js';
import {
  Player,
  actionId,
  build,
  clientSeed,
  fetcher,
  injector,
  testConfig,
} from './__fixtures__/harness.js';

/**
 * Fault injection (docs/protocol.md §9), over a real socket where it matters: a dropped reply is a
 * connection closed with nothing in it, which `inject` cannot show.
 */

const running: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.close();
});

async function up(env: Record<string, string> = { BJ_FAULTS: 'on' }) {
  const { server } = build(testConfig({ BJ_DEV: 'off', ...env }));
  running.push(server);
  const base = await server.listen();
  const call = fetcher(() => base);
  const player = new Player(call);
  await player.open();
  const set = async (patch: object) =>
    call('POST', '/api/faults', { body: patch, token: player.token });
  return { base, call, player, set };
}

describe('without BJ_FAULTS', () => {
  it('there is no lab: no route, no flag', async () => {
    const { server } = build(testConfig({ BJ_DEV: 'off' }));
    const call = injector(server.app);
    const opened = sessionReply.parse((await call('POST', '/api/session', { body: {} })).body);
    expect(opened.lab).toBeUndefined();
    const res = await call('POST', '/api/faults', { body: {}, token: opened.token });
    expect(res.status).toBe(404);
  });
});

describe('with BJ_FAULTS=on', () => {
  it('says so in the session reply, and merges what a session sets', async () => {
    const { call, set } = await up();
    const opened = sessionReply.parse((await call('POST', '/api/session', { body: {} })).body);
    expect(opened.lab).toBe(true);
    expect(faultsReply.parse((await set({ latencyMs: 50 })).body)).toEqual({
      ...NO_FAULTS,
      latencyMs: 50,
    });
    expect((await set({ dropRate: 0.2 })).body).toEqual({
      ...NO_FAULTS,
      latencyMs: 50,
      dropRate: 0.2,
    });
    expect((await set({ dropRate: 2 })).status).toBe(400);
  });

  it('refuses a session it does not know', async () => {
    const { call } = await up();
    const res = await call('POST', '/api/faults', { body: {}, token: 'ab'.repeat(32) });
    expect(res.status).toBe(401);
  });

  it('a dropped reply was applied: the retry under the same actionId gets the stored reply', async () => {
    const { call, player, set } = await up();
    await set({ dropNext: 1 });
    const id = actionId();
    const body = { actionId: id, stake: 500, clientSeed: clientSeed(), commit: player.commit };
    await expect(call('POST', '/api/deal', { body, token: player.token })).rejects.toThrow();
    // Applied: the round is open and the stake has left the wallet.
    const after = roundReply.parse((await call('GET', '/api/round', { token: player.token })).body);
    expect(after.round).not.toBeNull();
    expect(after.balance).toBe(player.balance - 500);
    // The retry is answered from the store — the same round, not a second deal.
    const retried = await call('POST', '/api/deal', { body, token: player.token });
    expect(retried.status).toBe(200);
    expect((retried.body as { round: { roundId: string } }).round.roundId).toBe(
      after.round?.roundId,
    );
  });

  it('a storm refuses requests unapplied, and ends', async () => {
    const { player, set } = await up();
    await set({ stormNext: 2 });
    for (let i = 0; i < 2; i += 1) {
      const out = await player.deal(500);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.error.code).toBe('UNAVAILABLE');
    }
    expect(player.round).toBeNull();
    expect((await player.deal(500)).ok).toBe(true);
  });

  it('holds a request for its latency', async () => {
    const { call, player, set } = await up();
    await set({ latencyMs: 250 });
    const started = Date.now();
    await call('GET', '/api/round', { token: player.token });
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
  });

  it('touches only the session that asked', async () => {
    const { call, player, set } = await up();
    await set({ stormNext: 5, latencyMs: 300 });
    const other = new Player(call);
    await other.open();
    const started = Date.now();
    expect((await other.deal(500)).ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(250);
    expect((await player.deal(500)).ok).toBe(false);
  });
});

describe('Faults', () => {
  it('rates follow the random source; counts count down; clearing everything forgets the session', () => {
    let next = 0.1;
    const f = new Faults(() => next);
    f.set('t', { dropRate: 0.5, unavailableRate: 0.05 });
    expect(f.drop('t')).toBe(true);
    expect(f.before('t').unavailable).toBe(false);
    next = 0.7;
    expect(f.drop('t')).toBe(false);
    f.set('t', { dropNext: 2 });
    expect([f.drop('t'), f.drop('t'), f.drop('t')]).toEqual([true, true, false]);
    f.set('t', { dropRate: 0, unavailableRate: 0 });
    expect(f.get('t')).toBe(NO_FAULTS);
    expect(f.get('someone else')).toBe(NO_FAULTS);
  });
});
