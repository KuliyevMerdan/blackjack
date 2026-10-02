import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { card } from '@blackjack/cards';
import { replay, view } from '@blackjack/engine';
import { shoe, verifyCommit } from '@blackjack/fair';
import { fairRecord, historyReply, roundReply, sessionReply } from '@blackjack/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { Player, actionId, build, injector, testConfig } from './__fixtures__/harness.js';
import { sqliteStore } from './store/sqlite.js';

/** Nines against a king with a seven in the hole, then a ten and an eight to draw. */
const NINES = ['9H', 'KS', '9C', '7D', 'TD', '2S', '8H'].map((c) => card(c));

async function table(env: Record<string, string> = {}) {
  const built = build(testConfig(env));
  const player = new Player(injector(built.server.app));
  await player.open();
  return { ...built, player, call: injector(built.server.app) };
}

describe('sessions', () => {
  it('opens a fresh wallet, and resumes it by token', async () => {
    const { player, call } = await table();
    expect(player.balance).toBe(100_000);
    expect(player.token).toMatch(/^[0-9a-f]{64}$/);
    const again = sessionReply.parse(
      (await call('POST', '/api/session', { body: { token: player.token } })).body,
    );
    expect(again).toMatchObject({ token: player.token, commit: player.commit, round: null });
  });

  it('opens a new session for a token it does not know', async () => {
    const { call } = await table();
    const reply = sessionReply.parse(
      (await call('POST', '/api/session', { body: { token: 'ab'.repeat(32) } })).body,
    );
    expect(reply.token).not.toBe('ab'.repeat(32));
  });

  it('refuses game calls without a known session', async () => {
    const { call } = await table();
    const res = await call('GET', '/api/round', { token: 'cd'.repeat(32) });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { class: 'SESSION', code: 'UNKNOWN_SESSION' } });
    expect((await call('POST', '/api/deal', { body: {} })).status).toBe(401);
  });
});

describe('the deal', () => {
  it('deals, debits the stake and keeps the commit until the round settles', async () => {
    const { player } = await table();
    const commit = player.commit;
    const outcome = await player.deal(500, { forceShoe: NINES });
    if (!outcome.ok) throw new Error(outcome.error.error.code);
    expect(outcome.reply.round).toMatchObject({ phase: 'PLAYER', seq: 0, forced: true });
    expect(outcome.reply.round.dealer).toEqual({ cards: ['KS'], holeHidden: true });
    expect(outcome.reply.balance).toBe(99_500);
    expect(outcome.reply.commit).toBe(commit);
    expect(outcome.res.raw).not.toContain('7D');
  });

  it('refuses a stake off the unit, out of range, or over the balance', async () => {
    const { player } = await table({ BJ_STARTING_BALANCE: '300' });
    const codes = [];
    for (const stake of [150, 20_000, 400]) {
      const outcome = await player.deal(stake);
      codes.push(outcome.ok ? 'ok' : `${outcome.res.status} ${outcome.error.error.code}`);
    }
    expect(codes).toEqual([
      '422 BET_NOT_A_UNIT_MULTIPLE',
      '422 BET_OUT_OF_RANGE',
      '422 INSUFFICIENT_FUNDS',
    ]);
  });

  it('refuses a malformed client seed, and malformed JSON, as MALFORMED', async () => {
    const { player, server } = await table();
    const outcome = await player.deal(500, { clientSeed: 'é' });
    expect(outcome.ok ? 0 : outcome.res.status).toBe(400);
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/deal',
      payload: '{nope',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${player.token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { class: 'PLAYER', code: 'MALFORMED' } });
  });

  it('refuses a deal under any commit but the current one, and names the current one', async () => {
    const { player } = await table();
    const current = player.commit;
    player.commit = 'ee'.repeat(32);
    const outcome = await player.deal(500);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.res.status).toBe(409);
    expect(outcome.error).toMatchObject({ error: { code: 'COMMIT_MISMATCH' }, commit: current });
    expect((await player.deal(500)).ok).toBe(true);
  });

  it('refuses a second deal while a hand is open, with the open hand', async () => {
    const { player } = await table();
    await player.deal(500, { forceShoe: NINES });
    const outcome = await player.deal(500);
    expect(outcome.ok ? '' : outcome.error.error.code).toBe('ROUND_OPEN');
    expect(outcome.ok ? null : outcome.error.round?.hands[0]?.cards).toEqual(['9H', '9C']);
  });

  it('drops forceShoe like any unknown field outside dev mode', async () => {
    const { player } = await table({ BJ_DEV: 'off' });
    const outcome = await player.deal(500, { forceShoe: ['AS', 'AH', 'KS', 'KH'] });
    if (!outcome.ok) throw new Error(outcome.error.error.code);
    expect(outcome.reply.round.forced).toBeUndefined();
  });
});

describe('idempotency and versions (§7)', () => {
  it('answers a replayed actionId with the stored reply, whatever happened since', async () => {
    const { player } = await table();
    await player.deal(500, { forceShoe: NINES });
    const hit = actionId();
    const first = await player.act('split', hit);
    await player.act('stand');
    const retry = await player.send('/api/act', {
      actionId: hit,
      roundId: player.round?.roundId,
      seq: 0,
      action: 'split',
    });
    expect(retry.res.raw).toBe(first.res.raw);
  });

  it('refuses a known actionId with a different body', async () => {
    const { player } = await table();
    await player.deal(500, { forceShoe: NINES });
    const id = actionId();
    await player.act('split', id);
    const outcome = await player.act('stand', id);
    expect(outcome.ok ? '' : outcome.error.error.code).toBe('ACTION_ID_REUSED');
  });

  it('refuses a decision made on an old version, with the round as it is now', async () => {
    const { player } = await table();
    await player.deal(500, { forceShoe: NINES });
    await player.act('split');
    const outcome = await player.act('hit', actionId(), 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.res.status).toBe(409);
    expect(outcome.error.error).toMatchObject({ class: 'CONFLICT', code: 'STALE_SEQ' });
    expect(outcome.error.round?.seq).toBe(1);
  });

  it('refuses an action the rules do not allow, and an action with no open hand', async () => {
    const { player } = await table();
    await player.deal(500, { forceShoe: NINES });
    const insurance = await player.act('insurance');
    expect(insurance.ok ? 0 : insurance.res.status).toBe(422);
    await player.act('stand');
    const late = await player.act('hit');
    expect(late.ok ? '' : late.error.error.code).toBe('NO_OPEN_ROUND');
    expect(late.ok ? null : late.error.round?.phase).toBe('SETTLED');
  });

  it('keeps replies for the open round and the last settled one only', async () => {
    const { player, store } = await table();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = actionId();
      ids.push(id);
      await player.deal(500, { forceShoe: ['AH', '9S', 'KC', '7D'] }, id);
    }
    expect(ids.map((id) => store.reply(player.token, id) !== null)).toEqual([false, false, true]);
  });
});

describe('settlement, history and /fair', () => {
  it('reveals the seed, moves the commit, pays, and serves a record the engine reproduces', async () => {
    const { player, call } = await table();
    const commit = player.commit;
    await player.deal(500, { forceShoe: NINES });
    await player.act('split');
    await player.act('stand');
    const last = await player.act('double');
    if (!last.ok) throw new Error(last.error.error.code);
    const { round } = last.reply;
    expect(round).toMatchObject({ phase: 'SETTLED', totalStake: 1500, totalPayout: 3000 });
    expect(last.reply.balance).toBe(101_500);
    expect(last.reply.commit).not.toBe(commit);
    expect(last.reply.events.at(-1)).toMatchObject({ type: 'roundSettled' });

    const record = fairRecord.parse((await call('GET', `/fair/rounds/${round.roundId}`)).body);
    expect(record.decisions).toEqual([
      { seq: 0, action: 'split' },
      { seq: 1, action: 'stand' },
      { seq: 2, action: 'double' },
    ]);
    expect(record.dealt).toEqual(NINES);
    expect(verifyCommit(record.serverSeed, record.commit)).toBe(true);
    expect(record.commit).toBe(commit);
    const replayed = replay({
      rules: record.rules,
      seeds: {
        roundId: record.roundId,
        commit: record.commit,
        clientSeed: record.clientSeed,
        serverSeed: record.serverSeed,
        forced: true,
      },
      stake: record.stake,
      decisions: record.decisions,
      shoe: [...NINES, ...shoe(record.serverSeed, record.clientSeed)],
    });
    expect(replayed.ok && view(replayed.state)).toEqual(record.round);
  });

  it('a shuffled round verifies from the seeds alone', async () => {
    const { player, call } = await table();
    let outcome = await player.deal(500);
    while (outcome.ok && outcome.reply.round.phase !== 'SETTLED') {
      outcome = await player.act(
        outcome.reply.round.phase === 'INSURANCE' ? 'noInsurance' : 'stand',
      );
    }
    const id = player.round?.roundId ?? '';
    const record = fairRecord.parse((await call('GET', `/fair/rounds/${id}`)).body);
    const deck = shoe(record.serverSeed, record.clientSeed);
    expect(deck.slice(0, record.dealt.length)).toEqual(record.dealt);
    expect(record.round.forced).toBeUndefined();
  });

  it('serves no record for an open round, an unknown one, or a malformed id', async () => {
    const { player, call } = await table();
    await player.deal(500, { forceShoe: NINES });
    const open = await call('GET', `/fair/rounds/${player.round?.roundId}`);
    expect(open.status).toBe(404);
    expect(open.raw).not.toContain('7D');
    expect((await call('GET', '/fair/rounds/01K6H3Z8Q4M2V7XKX0C9T5RB1N')).status).toBe(404);
    expect((await call('GET', '/fair/rounds/nope')).status).toBe(400);
  });

  it('lists settled rounds newest first, a page at a time', async () => {
    const { player, call } = await table();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await player.deal(500, { forceShoe: ['AH', '9S', 'KC', '7D'] });
      ids.push(player.round?.roundId ?? '');
    }
    const page = historyReply.parse(
      (await call('GET', '/api/history?limit=2', { token: player.token })).body,
    );
    expect(page.rounds.map((r) => r.roundId)).toEqual([ids[4], ids[3]]);
    expect(page.rounds[0]).toMatchObject({ stake: 500, totalPayout: 1250, hands: [['AH', 'KC']] });
    const next = historyReply.parse(
      (await call('GET', `/api/history?limit=2&before=${ids[3]}`, { token: player.token })).body,
    );
    expect(next.rounds.map((r) => r.roundId)).toEqual([ids[2], ids[1]]);
  });

  it('GET /api/round resyncs: the open hand, the wallet, the commit', async () => {
    const { player, call } = await table();
    await player.deal(500, { forceShoe: NINES });
    const reply = roundReply.parse((await call('GET', '/api/round', { token: player.token })).body);
    expect(reply).toMatchObject({ balance: 99_500, commit: player.commit });
    expect(reply.round).toEqual(player.round);
  });
});

describe('persistence', () => {
  let dir = '';
  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('resumes an open hand after a restart, exactly', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'bj-'));
    const file = path.join(dir, 'table.db');
    const first = build(testConfig(), sqliteStore(file));
    const player = new Player(injector(first.server.app));
    await player.open();
    await player.deal(500, { forceShoe: NINES });
    await player.act('split');
    const before = player.round;
    await first.server.close();

    const second = build(testConfig(), sqliteStore(file));
    const resumed = new Player(injector(second.server.app));
    await resumed.open(player.token);
    expect(resumed.round).toEqual(before);
    expect(resumed.balance).toBe(99_000);
    await resumed.act('stand');
    const last = await resumed.act('double');
    expect(last.ok && last.reply.round.totalPayout).toBe(3000);
    await second.server.close();
  });
});

describe('probes', () => {
  it('/health and /ready', async () => {
    const { call } = await table();
    expect((await call('GET', '/health')).body).toEqual({ ok: true });
    expect((await call('GET', '/ready')).body).toEqual({ ready: true });
  });
});

describe('round ids', () => {
  it('sort in the order they were issued, within one millisecond and across a clock step back', async () => {
    const { ulidFactory } = await import('./ids.js');
    const next = ulidFactory();
    const ids = [5, 5, 5, 5, 4, 6].map((t) => next(1_759_400_000_000 + t));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
