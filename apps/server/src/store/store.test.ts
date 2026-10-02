import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { minor } from '@blackjack/money';
import { PUBLISHED_RULES, rules } from '@blackjack/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { memoryStore } from './memory.js';
import { sqliteStore } from './sqlite.js';
import type { RoundRow, SessionRow, Store } from './store.js';

const dir = mkdtempSync(path.join(tmpdir(), 'bj-store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN = 'a1'.repeat(32);
const session: SessionRow = {
  token: TOKEN,
  balance: minor(100_000),
  serverSeed: '5e'.repeat(32),
  openRound: null,
  lastSettled: null,
};
const id = (n: number) => `01K6H3Z8Q4M2V7XKX0C9T5RB${String(n).padStart(2, '0')}`;
const round = (n: number, settledAt: number | null): RoundRow => ({
  roundId: id(n),
  token: TOKEN,
  rules: rules.parse(PUBLISHED_RULES),
  commit: '3c'.repeat(32),
  clientSeed: 'seed',
  serverSeed: '4d'.repeat(32),
  stake: minor(500),
  openingBalance: minor(100_000),
  forceShoe: null,
  decisions: [{ seq: 0, action: 'stand' }],
  settledAt,
});
const reply = (actionId: string, roundId: string) => ({
  token: TOKEN,
  actionId,
  roundId,
  fingerprint: '{}',
  body: '{"ok":true}',
});

/** One contract, both stores: the memory one the tests lean on must behave as the real one does. */
describe.each([
  ['memory', () => memoryStore()],
  ['sqlite', () => sqliteStore(path.join(dir, `${Math.random()}.db`))],
] as const)('%s store', (_name, open: () => Store) => {
  it('writes a session, a round and a reply together, and reads them back as written', () => {
    const store = open();
    const playing = { ...session, openRound: id(1) };
    store.commit({ session: playing, round: round(1, null), reply: reply('x', id(1)) });
    expect(store.session(TOKEN)).toEqual(playing);
    expect(store.round(id(1))).toEqual(round(1, null));
    expect(store.reply(TOKEN, 'x')).toEqual(reply('x', id(1)));
    expect(store.session('b2'.repeat(32))).toBeNull();
    store.close();
  });

  it('lists settled rounds only, newest first, before a cursor', () => {
    const store = open();
    store.commit({ session });
    for (const n of [1, 2, 3, 4]) store.commit({ session, round: round(n, n === 4 ? null : n) });
    expect(store.history(TOKEN, 10, null).map((r) => r.roundId)).toEqual([id(3), id(2), id(1)]);
    expect(store.history(TOKEN, 1, id(3)).map((r) => r.roundId)).toEqual([id(2)]);
    store.close();
  });

  it('keeps replies for the open round and the last settled one, and forgets the rest', () => {
    const store = open();
    store.commit({
      session: { ...session, lastSettled: id(1) },
      round: round(1, 1),
      reply: reply('a', id(1)),
    });
    store.commit({
      session: { ...session, lastSettled: id(2) },
      round: round(2, 2),
      reply: reply('b', id(2)),
    });
    const open3 = { ...session, openRound: id(3), lastSettled: id(2) };
    store.commit({ session: open3, round: round(3, null), reply: reply('c', id(3)) });
    expect(['a', 'b', 'c'].map((a) => store.reply(TOKEN, a) !== null)).toEqual([false, true, true]);
    store.close();
  });
});

describe('sqlite store', () => {
  it('commits all or nothing', () => {
    const file = path.join(dir, 'atomic.db');
    const store = sqliteStore(file);
    const playing = { ...session, openRound: id(1) };
    store.commit({ session: playing, round: round(1, null), reply: reply('x', id(1)) });
    const richer = { ...playing, balance: minor(1) };
    // The same actionId twice violates the replies key: the session write before it must not land.
    expect(() => store.commit({ session: richer, reply: reply('x', id(1)) })).toThrow();
    expect(store.session(TOKEN)?.balance).toBe(100_000);
    store.close();
    expect(sqliteStore(file).session(TOKEN)).toEqual(playing);
  });

  it('refuses a row it cannot parse rather than serving it', () => {
    const file = path.join(dir, 'corrupt.db');
    const store = sqliteStore(file);
    store.commit({ session: { ...session, serverSeed: 'not a seed' } });
    expect(() => store.session(TOKEN)).toThrow();
    store.close();
  });
});
