import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { replay, view } from '@blackjack/engine';
import { shoe, verifyCommit } from '@blackjack/fair';
import {
  fairRecord,
  historyReply,
  roundReply,
  type Action,
  type FairRecord,
} from '@blackjack/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { Player, actionId, build, fetcher, testConfig } from './__fixtures__/harness.js';
import { sqliteStore } from './store/sqlite.js';

/**
 * S3's done-when, end to end: 1,000 hands over real HTTP against SQLite, two clients on one session
 * (two tabs), replies lost and retried, and the server restarted twice with a hand open. Afterwards
 * the wallet must equal the sum of its rounds, and every round must verify from its seeds — dealt
 * from the top of its shoe, each card once, replayed to the snapshot the player was shown.
 */

const HANDS = 1_000;
const STARTING = 10_000_000;
const RESTART_AT = new Set([333, 666]);

const dir = mkdtempSync(path.join(tmpdir(), 'bj-integration-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('two tabs, lost replies and restarts, over HTTP', () => {
  it(`plays ${HANDS} hands and accounts for every unit and every card`, async () => {
    const file = path.join(dir, 'table.db');
    const config = testConfig({ BJ_DEV: 'off', BJ_STARTING_BALANCE: String(STARTING) });
    let running = build(config, sqliteStore(file));
    let base = await running.server.listen();
    const call = fetcher(() => base);

    const a = new Player(call);
    await a.open();
    const b = new Player(call);
    await b.open(a.token);
    const tabs = [a, b];

    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const stats = { lost: 0, conflicts: 0, restarts: 0, dealt: 0 };

    for (let hand = 0; hand < HANDS; hand += 1) {
      // Either tab deals; the other finds out when it next acts or resyncs.
      const dealer = tabs[Math.floor(random() * 2)] ?? a;
      let dealt = await dealer.deal(100 * (1 + Math.floor(random() * 20)));
      while (!dealt.ok) {
        stats.conflicts += 1;
        if (dealt.error.error.code === 'ROUND_OPEN') break;
        dealt = await dealer.deal(100); // COMMIT_MISMATCH: a fresh client seed, the new commit
      }
      if (dealt.ok) stats.dealt += 1;
      const roundId = dealer.round?.roundId ?? '';

      if (RESTART_AT.has(hand) && dealer.round?.phase !== 'SETTLED') {
        await running.server.close();
        running = build(config, sqliteStore(file));
        base = await running.server.listen();
        stats.restarts += 1;
      }

      for (let guard = 0; ; guard += 1) {
        if (guard > 200) throw new Error(`hand ${hand} never settled`);
        const tab = tabs[Math.floor(random() * 2)] ?? a;
        if (tab.round?.roundId !== roundId) {
          const res = await call('GET', '/api/round', { token: tab.token });
          tab.round = roundReply.parse(res.body).round ?? tab.round;
        }
        const round = tab.round;
        if (round === null || round.roundId !== roundId) break; // settled while this tab looked away
        if (round.phase === 'SETTLED') break;

        const allowed: readonly Action[] = round.allowed;
        const body = {
          actionId: actionId(),
          roundId,
          seq: round.seq,
          action: allowed[Math.floor(random() * allowed.length)] ?? 'stand',
        };
        const first = await tab.call('POST', '/api/act', { body, token: tab.token });
        if (random() < 0.15) {
          // The reply is lost. Sometimes the other tab moves the hand on before the retry; the
          // retry, under the same actionId, must still get exactly the reply that was lost.
          stats.lost += 1;
          const other = tab === a ? b : a;
          if (random() < 0.5 && other.round?.roundId === roundId) {
            const moved = await other.act(other.round.allowed[0] ?? 'stand');
            if (!moved.ok) stats.conflicts += 1;
          }
          const retry = await tab.call('POST', '/api/act', { body, token: tab.token });
          // Only a reply that did something is stored; a refusal changed nothing and is answered
          // afresh, so it may differ once the other tab has moved.
          if (first.status === 200) expect(retry.raw).toBe(first.raw);
        }
        if (!tab.take(first).ok) stats.conflicts += 1;
      }
    }

    // Every settled round, through the public API, a page at a time.
    const records: FairRecord[] = [];
    let before: string | null = null;
    for (;;) {
      const query: string = before === null ? '' : `&before=${before}`;
      const page = historyReply.parse(
        (await call('GET', `/api/history?limit=100${query}`, { token: a.token })).body,
      );
      if (page.rounds.length === 0) break;
      for (const summary of page.rounds) {
        records.push(fairRecord.parse((await call('GET', `/fair/rounds/${summary.roundId}`)).body));
      }
      before = page.rounds.at(-1)?.roundId ?? null;
    }
    const wallet = roundReply.parse((await call('GET', '/api/round', { token: a.token })).body);
    await running.server.close();

    expect(stats.restarts).toBe(2);
    expect(stats.lost).toBeGreaterThan(50);
    expect(stats.conflicts).toBeGreaterThan(50);
    expect(wallet.round).toBeNull();
    expect(records).toHaveLength(stats.dealt);
    expect(new Set(records.map((r) => r.roundId)).size).toBe(records.length);

    // The wallet is the sum of its rounds.
    const net = records.reduce(
      (sum, r) => sum + (r.round.totalPayout ?? 0) - r.round.totalStake,
      0,
    );
    expect(wallet.balance).toBe(STARTING + net);

    // Every round verifies, and no card was dealt twice.
    for (const record of records) {
      expect(verifyCommit(record.serverSeed, record.commit)).toBe(true);
      const deck = shoe(record.serverSeed, record.clientSeed);
      expect(record.dealt).toEqual(deck.slice(0, record.dealt.length));
      const onTable = [
        ...record.round.dealer.cards,
        ...record.round.hands.flatMap((h) => h.cards),
      ].sort();
      expect(onTable).toEqual([...record.dealt].sort());
      const replayed = replay({
        rules: record.rules,
        seeds: {
          roundId: record.roundId,
          commit: record.commit,
          clientSeed: record.clientSeed,
          serverSeed: record.serverSeed,
          forced: false,
        },
        stake: record.stake,
        decisions: record.decisions,
        shoe: deck,
      });
      expect(replayed.ok && view(replayed.state)).toEqual(record.round);
    }
  }, 180_000);
});
