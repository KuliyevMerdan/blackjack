import { roundReply, type Action } from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import {
  Player,
  actionId,
  build,
  injector,
  testConfig,
  type Response,
} from './__fixtures__/harness.js';

/**
 * Invariant 2 — face-down never travels — scanned, not assumed. 10,000 hands of random legal play,
 * with resyncs, stale decisions and late ones mixed in so error replies are read too. Every body
 * that crosses the wire and every log line is searched for the two secrets of the moment: the
 * server seed the session currently commits to, and any card code outside the places a visible
 * card may sit.
 */

const CARD = /"([2-9TJQKA][SHDC])"/g;

/** Every card code in the raw text, as a sorted list. */
function codesIn(raw: string): string[] {
  return [...raw.matchAll(CARD)].map((m) => m[1] ?? '').sort();
}

/**
 * The card codes the parsed body shows where a face-up card belongs: a `cards` list (hands, the
 * dealer, history) or an event's `card`. A code anywhere else — a new field, a log of the shoe —
 * would be in `codesIn(raw)` and not here.
 */
function visible(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return key === 'card' || key === 'cards' ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((v) => visible(v, key));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => visible(v, k));
  }
  return [];
}

describe('face-down never travels', () => {
  it('in 10,000 hands, no reply and no log line carries the hole card or an unrevealed seed', async () => {
    const { server, store, lines } = build(
      testConfig({ BJ_DEV: 'off', BJ_STARTING_BALANCE: '100000000' }),
    );
    const call = injector(server.app);
    const player = new Player(call);
    await player.open();
    const seedsEverUsed = new Set<string>();
    let scanned = 0;
    let random = 12345;
    const next = () => {
      random = (random * 1103515245 + 12345) % 2 ** 31;
      return random / 2 ** 31;
    };

    const scan = (res: Response) => {
      scanned += 1;
      const secret = store.session(player.token)?.serverSeed ?? '';
      seedsEverUsed.add(secret);
      if (res.raw.includes(secret)) throw new Error(`the unrevealed seed left in ${res.raw}`);
      const leaked = codesIn(res.raw);
      const shown = visible(res.body).sort();
      if (leaked.join() !== shown.join()) {
        throw new Error(`a card outside a visible place: ${res.raw}`);
      }
    };

    for (let hand = 0; hand < 10_000; hand += 1) {
      let outcome = await player.deal(100 * (1 + Math.floor(next() * 10)));
      scan(outcome.res);
      while (player.round !== null && player.round.phase !== 'SETTLED') {
        const roll = next();
        if (roll < 0.05) {
          const res = await call('GET', '/api/round', { token: player.token });
          scan(res);
          player.round = roundReply.parse(res.body).round;
          continue;
        }
        if (roll < 0.1) {
          // A decision on an old version: a CONFLICT that carries the round.
          scan((await player.act('stand', actionId(), player.round.seq + 1)).res);
          continue;
        }
        const allowed: readonly Action[] = player.round.allowed;
        outcome = await player.act(allowed[Math.floor(next() * allowed.length)] ?? 'stand');
        scan(outcome.res);
      }
      if (hand % 10 === 0) scan((await player.act('hit')).res); // NO_OPEN_ROUND, after settling
    }

    expect(scanned).toBeGreaterThan(20_000);
    const log = lines.join('\n');
    expect(codesIn(log)).toEqual([]);
    for (const seed of seedsEverUsed) expect(log.includes(seed)).toBe(false);
  }, 180_000);
});
