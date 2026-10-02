import { Client, canonical, httpTransport, inMemory, type Read } from '@blackjack/client-core';
import type { Card } from '@blackjack/cards';
import type { FairRecord, RoundSummary } from '@blackjack/protocol';
import { versionOf, type Bot } from './bot.js';

/**
 * The audit after a soak (ROADMAP P0 "Done when"), done the way any client could do it — over the
 * wire, through the protocol, with no look into the server's database:
 *
 * 1. **No money created or destroyed.** Each wallet is its starting balance, less every stake the
 *    session's rounds put at risk, plus every payout — settled rounds from the history, the open
 *    round's stakes from the round itself.
 * 2. **Every action landed at most once.** The server holds every deal and decision a tab was told
 *    was accepted, and nothing beyond them but — at most — the ones whose fate a tab was never told
 *    (its retries ran out, or a `CONFLICT` answered a retry whose stored reply had been superseded,
 *    §7). A lost reply retried must not become a second card. And a session with one tab is never
 *    answered with a `CONFLICT` at all: there is no one else to move its round, so a conflict there
 *    is a retry the server failed to recognise.
 * 3. **No card dealt twice.** Each round's public record names the cards it used; the table shows
 *    each of them once, and nothing else.
 * 4. **No client shows a round the server does not have.** Every settled round any tab was shown is
 *    the server's record of it, byte for byte; every tab ends on the server's open round and wallet.
 */

export interface Finding {
  readonly token: string;
  readonly what: string;
}

export interface Audit {
  readonly sessions: number;
  readonly rounds: number;
  readonly decisions: number;
  /** Deals and decisions that landed though their tab was not told — each exactly once. */
  readonly landedUntold: number;
  readonly findings: readonly Finding[];
}

export interface Session {
  readonly token: string;
  readonly bots: readonly Bot[];
}

export async function audit(
  base: string,
  sessions: readonly Session[],
  starting: number,
): Promise<Audit> {
  const findings: Finding[] = [];
  let rounds = 0;
  let decisions = 0;
  let landedUntold = 0;
  for (const session of sessions) {
    const say = (what: string) => findings.push({ token: session.token.slice(0, 8), what });
    const bots = session.bots;
    for (const bot of bots) {
      if (bot.counts.refused > 0) say(`a tab was refused ${bot.counts.refused} time(s)`);
      if (bot.counts.sessionLost > 0) say('a tab lost its session');
    }
    const conflicts = bots.reduce((n, b) => n + b.counts.conflicts, 0);
    if (bots.length === 1 && conflicts > 0) {
      say(`one tab, and ${conflicts} conflict(s): a retry the server did not recognise`);
    }

    const reader = await openAs(base, session.token);
    const truth = reader?.state ?? null;
    if (reader === null || truth === null || truth.token !== session.token) {
      say('the server did not resume the session');
      continue;
    }
    const settled = await allHistory(reader);
    if (settled === null) {
      say('the history could not be read');
      continue;
    }
    const held = settled.length + (truth.round !== null ? 1 : 0);
    rounds += held;

    // 1. money
    const expected = expectedBalance(starting, settled, truth.round);
    if (expected !== truth.balance) say(`wallet ${truth.balance}, its rounds say ${expected}`);

    // 2a. every accepted deal is a round; beyond them, at most the deals no tab was told about
    const deals = bots.reduce((n, b) => n + b.counts.deals, 0);
    const untoldDeals = bots.reduce((n, b) => n + b.counts.unresolvedDeals, 0);
    const extra = within(held, deals, untoldDeals);
    if (extra === null)
      say(`${deals} deals accepted (+${untoldDeals} untold), ${held} rounds held`);
    else landedUntold += extra;

    // 2b, 3, 4a — round by round, from the public record
    for (const summary of settled) {
      const read = await retried(() => reader.fairRecord(summary.roundId));
      if (read.kind !== 'ok') {
        say(`round ${summary.roundId}: no public record`);
        continue;
      }
      const record = read.value;
      const accepted = bots.reduce((n, b) => n + (b.acted.get(record.roundId) ?? 0), 0);
      const untold = bots.reduce((n, b) => n + (b.unresolved.get(record.roundId) ?? 0), 0);
      decisions += record.decisions.length;
      const over = within(record.decisions.length, accepted, untold);
      if (over === null) {
        say(
          `round ${record.roundId}: ${record.decisions.length} decisions recorded, ${accepted} accepted (+${untold} untold)`,
        );
      } else landedUntold += over;
      const cards = sameCards(record);
      if (cards !== null) say(`round ${record.roundId}: ${cards}`);
      const recorded = canonical(record.round);
      for (const bot of bots) {
        for (const shown of bot.shown.get(record.roundId) ?? []) {
          if (shown !== recorded) {
            say(`round ${record.roundId}: a tab was shown a round the server does not have`);
          }
        }
      }
    }
    // A tab shown a settled round the history does not list at all.
    const listed = new Set(settled.map((s) => s.roundId));
    for (const bot of bots) {
      for (const id of bot.shown.keys()) {
        if (!listed.has(id)) say(`round ${id}: shown settled, not in the history`);
      }
    }

    // 4b. every tab ends where the server is
    const server = versionOf(truth);
    for (const bot of bots) {
      const mine = bot.client.state;
      if (versionOf(mine) !== server) {
        say(`a tab ends on ${versionOf(mine)}, the server on ${server}`);
      } else if (truth.round !== null && canonical(mine?.round) !== canonical(truth.round)) {
        say('a tab ends on an open round that differs from the server’s');
      }
    }
  }
  return { sessions: sessions.length, rounds, decisions, landedUntold, findings };
}

/**
 * `held` against what the tabs were told: at least every accepted one, at most those plus the ones
 * whose fate no tab learned. The number of the latter that landed — or `null` outside the bounds.
 */
export function within(held: number, accepted: number, untold: number): number | null {
  return held >= accepted && held <= accepted + untold ? held - accepted : null;
}

/** Starting balance, less every stake at risk, plus every payout. */
export function expectedBalance(
  starting: number,
  settled: readonly { readonly totalStake: number; readonly totalPayout: number }[],
  open: { readonly totalStake: number } | null,
): number {
  const staked = settled.reduce((n, r) => n + r.totalStake, 0) + (open?.totalStake ?? 0);
  const paid = settled.reduce((n, r) => n + r.totalPayout, 0);
  return starting - staked + paid;
}

/** `null` when the table shows every card the round used exactly once, and nothing else. */
export function sameCards(record: Pick<FairRecord, 'dealt' | 'round'>): string | null {
  const shown: Card[] = [
    ...record.round.dealer.cards,
    ...record.round.hands.flatMap((h) => h.cards),
  ];
  const count = (cards: readonly Card[]) => {
    const m = new Map<Card, number>();
    for (const c of cards) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  const a = count(shown);
  const b = count(record.dealt);
  if (shown.length !== record.dealt.length) {
    return `${shown.length} cards on the table, ${record.dealt.length} dealt`;
  }
  for (const [card, n] of a)
    if (b.get(card) !== n) return `${card} shown ${n}×, dealt ${b.get(card) ?? 0}×`;
  return null;
}

async function allHistory(client: Client): Promise<RoundSummary[] | null> {
  const all: RoundSummary[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await retried(() => client.history(100, before));
    if (page.kind !== 'ok') return null;
    all.push(...page.value);
    const last = page.value.at(-1);
    if (page.value.length < 100 || last === undefined) return all;
    before = last.roundId;
  }
}

/** A client resuming `token` — the audit reads as the session, and changes nothing. */
async function openAs(base: string, token: string): Promise<Client | null> {
  const storage = inMemory();
  storage.set('bj:token', token);
  const client = new Client({
    transport: httpTransport({
      baseUrl: base,
      fetch: (url, init) => fetch(url, init),
      sleep: pause,
    }),
    sleep: pause,
    random: Math.random,
    uuid: () => crypto.randomUUID(),
    clientSeed: () => 'audit',
    storage,
  });
  for (let i = 0; i < 5; i += 1) {
    if ((await client.open()).kind === 'ok') return client;
    await pause(300);
  }
  return null;
}

/** A read, tried a few times — the audit runs with the faults off, but a server may lag. */
async function retried<T>(read: () => Promise<Read<T>>): Promise<Read<T>> {
  let last: Read<T> = { kind: 'failed', reason: 'not tried' };
  for (let i = 0; i < 5; i += 1) {
    last = await read();
    if (last.kind !== 'failed') return last;
    await pause(300);
  }
  return last;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
