import { minor } from '@blackjack/money';
import { describe, expect, it } from 'vitest';
import { CONFIG, FakeServer } from './__fixtures__/server.js';
import { Client, InvariantError, canonical, type Change, type ClientOptions } from './client.js';
import { inMemory, type KeyValue } from './memory.js';
import { httpTransport, TransportError, type Response, type Transport } from './transport.js';

/** A seeded LCG: the same faults and choices every run. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

let ids = 0;
function client(transport: Transport, extra: Partial<ClientOptions> = {}): Client {
  return new Client({
    transport,
    sleep: async () => {},
    random: () => 0.5,
    uuid: () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
    },
    clientSeed: () => `seed-${(ids += 1)}`,
    dev: true,
    ...extra,
  });
}

/** The truth a client holds, next to what the server holds for its session. */
function converged(c: Client, server: FakeServer): boolean {
  const truth = c.state;
  if (truth === null) return false;
  const held = server.truthOf(truth.token);
  // A client that has seen its round settle keeps showing it; the server's `round` is the last one.
  return (
    canonical({ round: truth.round, balance: truth.balance, commit: truth.commit }) ===
    canonical(held)
  );
}

const STAKE = minor(500);

describe('session and resume', () => {
  it('opens a session and keeps its token', async () => {
    const server = new FakeServer();
    const storage = inMemory();
    const c = client(server.transport, { storage });
    expect(await c.open()).toEqual({ kind: 'ok' });
    expect(c.state?.balance).toBe(100_000);
    expect(storage.get('bj:token')).toBe(c.state?.token);
  });

  it('resumes an open hand as it stands — no replay, no events', async () => {
    const server = new FakeServer();
    const storage = inMemory();
    const first = client(server.transport, { storage });
    await first.open();
    await first.deal(STAKE);
    const second = client(server.transport, { storage });
    const changes: Change[] = [];
    second.subscribe((change) => changes.push(change));
    await second.open();
    expect(second.state?.round).toEqual(first.state?.round);
    expect(changes).toMatchObject([{ cause: 'open', events: [] }]);
  });
});

describe('intents', () => {
  it('deals and acts, each change carrying (previous, events, next)', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    const changes: Change[] = [];
    c.subscribe((change) => changes.push(change));
    await c.deal(STAKE);
    while (c.state?.round?.phase !== 'SETTLED') {
      await c.act(c.state?.round?.allowed.includes('noInsurance') ? 'noInsurance' : 'stand');
    }
    expect(changes[0]?.events[0]).toEqual({ type: 'roundStarted', stake: 500 });
    expect(changes.at(-1)?.events.at(-1)?.type).toBe('roundSettled');
    for (const [i, change] of changes.entries()) {
      if (i > 0) expect(change.previous).toBe(changes[i - 1]?.next);
    }
    expect(converged(c, server)).toBe(true);
  });

  it('sends one request for a double tap', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    await c.deal(STAKE);
    if (c.state?.round?.phase !== 'PLAYER') return; // a blackjack settled it; nothing to tap
    const before = server.log.length;
    const [a, b] = await Promise.all([c.act('stand'), c.act('stand')]);
    expect([a.kind, b.kind]).toEqual(['ok', 'busy']);
    expect(server.log.length).toBe(before + 1);
  });

  it('sends nothing for a decision the truth does not allow', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    const before = server.log.length;
    expect(await c.act('hit')).toEqual({ kind: 'unavailable' });
    expect(server.log.length).toBe(before);
  });

  it('remembers the commit and client seed it dealt under, for the verifier', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    const commit = c.state?.commit;
    await c.deal(STAKE);
    const roundId = c.state?.round?.roundId ?? '';
    expect(c.sent.find(roundId)).toMatchObject({ roundId, commit });
  });
});

describe('the four error classes', () => {
  it('PLAYER: refused, truth unchanged', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    const before = c.state;
    expect(await c.deal(minor(20_000))).toMatchObject({
      kind: 'refused',
      code: 'BET_OUT_OF_RANGE',
    });
    expect(c.state).toBe(before);
  });

  it('SESSION: a new session is opened, and the outcome says so', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    const old = c.state?.token;
    server.wipe();
    expect(await c.deal(STAKE)).toEqual({ kind: 'sessionLost' });
    expect(c.state?.token).not.toBe(old);
  });

  it('CONFLICT: two tabs on one hand — the stale one takes the round as it is, and does not retry', async () => {
    const server = new FakeServer();
    const storage: KeyValue = inMemory();
    const a = client(server.transport, { storage });
    const b = client(server.transport, { storage });
    await a.open();
    await b.open();
    for (let tries = 0; tries < 20 && a.state?.round?.phase !== 'PLAYER'; tries += 1) {
      await a.deal(STAKE);
      if (a.state?.round?.phase === 'INSURANCE') await a.act('noInsurance');
    }
    await b.resync();
    expect(b.state?.round).toEqual(a.state?.round);
    await a.act('stand');
    const before = server.log.length;
    const outcome = await b.act('stand');
    expect(outcome.kind).toBe('conflict');
    expect(server.log.length).toBe(before + 1);
    expect(b.state?.round).toEqual(a.state?.round);
    expect(converged(b, server)).toBe(true);
  });

  it('SYSTEM: retried under the same actionId until it answers', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    server.faults = { unavailable: 3 };
    expect(await c.deal(STAKE)).toEqual({ kind: 'ok' });
    const deals = server.log.filter((r) => r.path === '/api/deal');
    expect(deals).toHaveLength(4);
    expect(new Set(deals.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it('SYSTEM for longer than the retries last: failed, truth unchanged', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    const before = c.state;
    server.faults = { unavailable: 100 };
    expect((await c.deal(STAKE)).kind).toBe('failed');
    expect(c.state).toBe(before);
  });
});

describe('connection status', () => {
  it('connecting → online, retrying while it re-sends, offline when it gives up', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    const seen: string[] = [c.status];
    c.onStatus((s) => seen.push(s));
    await c.open();
    server.faults = { unavailable: 2 };
    await c.deal(STAKE);
    server.faults = { unavailable: 100 };
    await c.resync();
    expect(seen).toEqual(['connecting', 'online', 'retrying', 'online', 'retrying', 'offline']);
  });

  it('outdated when the server answers with something this client cannot read', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    server.faults = {
      tamper: (body) => ({ ...(body as object), round: { roundId: 'from-the-future' } }),
    };
    await c.deal(STAKE);
    expect(c.status).toBe('outdated');
  });
});

describe('lost replies, restarts and moved commits', () => {
  it('a reply lost after the server applied it is recovered by the retry, not guessed', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    server.faults = { dropReply: 1 };
    const pending = c.deal(STAKE);
    server.faults = {}; // the retry goes through
    expect(await pending).toEqual({ kind: 'ok' });
    expect(server.dropped).toBe(1);
    const deals = server.log.filter((r) => r.path === '/api/deal');
    expect(deals).toHaveLength(2);
    expect(deals[0]?.body).toEqual(deals[1]?.body); // the same intent, twice
    expect(converged(c, server)).toBe(true);
  });

  it('a server restart between the commit and the deal: the commit survives it', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    server.restart(3);
    expect(await c.deal(STAKE)).toEqual({ kind: 'ok' });
    expect(converged(c, server)).toBe(true);
  });

  it('a commit that moved: a fresh seed, re-sent once — never the old seed under the new commit', async () => {
    const server = new FakeServer();
    const storage = inMemory();
    const a = client(server.transport, { storage });
    const b = client(server.transport, { storage });
    await a.open();
    await b.open();
    // Tab A plays a round out; tab B's commit is now the old one.
    await a.deal(STAKE);
    while (a.state?.round?.phase !== 'SETTLED') {
      await a.act(a.state?.round?.allowed.includes('noInsurance') ? 'noInsurance' : 'stand');
    }
    expect(await b.deal(STAKE)).toEqual({ kind: 'ok' });
    const deals = server.log.filter((r) => r.path === '/api/deal').slice(-2);
    const seeds = deals.map((r) => JSON.stringify(r.body).match(/"clientSeed":"([^"]+)"/)?.[1]);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it('a typed seed meets a moved commit: the player is asked, nothing is re-sent', async () => {
    const server = new FakeServer();
    const storage = inMemory();
    const a = client(server.transport, { storage });
    const b = client(server.transport, { storage });
    await a.open();
    await b.open();
    b.setTypedSeed('my lucky seed');
    await a.deal(STAKE);
    while (a.state?.round?.phase !== 'SETTLED') {
      await a.act(a.state?.round?.allowed.includes('noInsurance') ? 'noInsurance' : 'stand');
    }
    expect(await b.deal(STAKE)).toEqual({ kind: 'commitMoved' });
    expect(b.state?.commit).toBe(a.state?.commit);
    expect(await b.deal(STAKE)).toEqual({ kind: 'ok' }); // confirmed: sent under the new commit
  });
});

describe('invariant 6 in dev', () => {
  it('throws on a reply whose events do not prove its snapshot', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    await c.open();
    server.faults = {
      tamper: (body) =>
        typeof body === 'object' && body !== null && 'events' in body && Array.isArray(body.events)
          ? {
              ...body,
              events: body.events.filter((e: { type?: string }) => e.type !== 'holeDealt'),
            }
          : body,
    };
    await expect(c.deal(STAKE)).rejects.toThrow(InvariantError);
  });
});

describe('httpTransport', () => {
  const never = () => new Promise<never>(() => {});

  it('treats a reply that does not come in time as lost', async () => {
    const transport = httpTransport({
      baseUrl: 'http://table',
      fetch: never,
      sleep: async () => {},
      timeoutMs: 10,
    });
    await expect(transport({ method: 'GET', path: '/health' })).rejects.toThrow(TransportError);
  });

  it('sends JSON with the bearer token, and reads a non-JSON body as null', async () => {
    const seen: unknown[] = [];
    const transport = httpTransport({
      baseUrl: 'http://table',
      fetch: async (url, init) => {
        seen.push({ url, init });
        return { status: 502, text: async () => '<html>Bad gateway</html>' };
      },
      sleep: never,
    });
    expect(
      await transport({ method: 'POST', path: '/api/act', body: { a: 1 }, token: 't' }),
    ).toEqual({
      status: 502,
      body: null,
    });
    expect(seen).toEqual([
      {
        url: 'http://table/api/act',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
          body: '{"a":1}',
        },
      },
    ]);
  });
});

describe('1,000 hands through a hostile network', () => {
  it('drops one reply in ten, duplicates one request in twenty, restarts every hundred — and converges every hand', async () => {
    const random = lcg(42);
    const server = new FakeServer(random);
    server.faults = { dropReply: 0.1, duplicate: 0.05 };
    const c = client(server.transport, { random });
    expect((await c.open()).kind).toBe('ok');
    const tally = { failed: 0, hands: 0 };

    for (let hand = 0; hand < 1000; hand += 1) {
      if (hand % 100 === 99) server.restart(3);
      let outcome = await c.deal(STAKE);
      for (let guard = 0; c.state?.round?.phase !== 'SETTLED'; guard += 1) {
        if (guard > 50) throw new Error(`hand ${hand} never settled`);
        if (outcome.kind === 'failed') {
          tally.failed += 1;
          await c.resync();
          if (c.state?.round === null) break;
        }
        const allowed = c.state?.round?.allowed ?? [];
        outcome = await c.act(allowed[Math.floor(random() * allowed.length)] ?? 'stand');
      }
      tally.hands += 1;
      if (!converged(c, server)) {
        expect({ hand, client: c.state, server: server.truthOf(c.state?.token ?? '') }).toBe(
          'converged',
        );
      }
    }
    expect(tally.hands).toBe(1000);
    expect(server.dropped).toBeGreaterThan(100);
  }, 60_000);
});

describe('reads', () => {
  const summary = {
    roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
    settledAt: 1_759_400_000_000,
    stake: 500,
    totalStake: 500,
    totalPayout: 0,
    dealer: ['KS', '7D'],
    hands: [['9H', '8C']],
  };
  const reader = (answers: Record<string, Response>) => {
    const seen: string[] = [];
    const transport: Transport = async (request) => {
      seen.push(`${request.method} ${request.path} ${request.token ?? '-'}`);
      const key = Object.keys(answers).find((k) => request.path.startsWith(k));
      if (key === undefined) throw new TransportError('nothing there');
      return answers[key] ?? { status: 500, body: null };
    };
    return { transport, seen };
  };
  const session = {
    status: 200,
    body: {
      token: 'a1'.repeat(32),
      balance: 100_000,
      config: CONFIG,
      commit: 'ab'.repeat(32),
      round: null,
    },
  };

  it('history asks with the session’s token and parses the rounds', async () => {
    const { transport, seen } = reader({
      '/api/session': session,
      '/api/history': { status: 200, body: { rounds: [summary] } },
    });
    const c = client(transport, { retry: { attempts: 1 } });
    await c.open();
    const read = await c.history();
    expect(read.kind).toBe('ok');
    expect(seen.at(-1)).toBe(`GET /api/history?limit=30 ${'a1'.repeat(32)}`);
  });

  it('a fair record is public, unknown on a 404, and parsed like any reply', async () => {
    const { transport, seen } = reader({
      '/fair/rounds/01K6H3Z8Q4M2V7XKX0C9T5RB1N': { status: 200, body: { roundId: 'not a record' } },
      '/fair/rounds/01K6H3Z8Q4M2V7XKX0C9T5RB1Z': {
        status: 404,
        body: { error: { class: 'PLAYER', code: 'UNKNOWN_ROUND', message: 'none' } },
      },
    });
    const c = client(transport, { retry: { attempts: 1 } });
    expect((await c.fairRecord('01K6H3Z8Q4M2V7XKX0C9T5RB1Z')).kind).toBe('unknown');
    expect((await c.fairRecord('01K6H3Z8Q4M2V7XKX0C9T5RB1N')).kind).toBe('failed');
    expect(seen.every((s) => s.endsWith(' -'))).toBe(true); // no token on a public read
  });
});

describe('the network lab', () => {
  const opened = (lab: boolean): Response => ({
    status: 200,
    body: {
      token: 'a1'.repeat(32),
      balance: 100_000,
      config: CONFIG,
      commit: 'ab'.repeat(32),
      round: null,
      ...(lab ? { lab: true } : {}),
    },
  });
  const set = { latencyMs: 300, dropRate: 0, unavailableRate: 0, dropNext: 1, stormNext: 0 };

  it('is there only when the server says so, and sets faults once, unretried', async () => {
    let calls = 0;
    const c = client(async (request) => {
      if (request.path === '/api/session') return opened(true);
      calls += 1;
      return { status: 200, body: set };
    });
    await c.open();
    expect(c.lab).toBe(true);
    expect(await c.faults({ latencyMs: 300, dropNext: 1 })).toEqual({ kind: 'ok', value: set });
    expect(calls).toBe(1);
  });

  it('a server without it: nothing is sent', async () => {
    let calls = 0;
    const c = client(async (request) => {
      if (request.path === '/api/session') return opened(false);
      calls += 1;
      return { status: 404, body: null };
    });
    await c.open();
    expect(c.lab).toBe(false);
    expect((await c.faults({ dropNext: 1 })).kind).toBe('unknown');
    expect(calls).toBe(0);
  });
});

describe('busy', () => {
  it('is announced as it starts and ends, whoever made the call', async () => {
    const server = new FakeServer();
    const c = client(server.transport);
    const heard: boolean[] = [];
    c.onBusy((b) => heard.push(b));
    await c.open();
    await c.resync();
    expect(heard).toEqual([true, false, true, false]);
  });
});
