import type { Card } from '@blackjack/cards';
import type { Minor } from '@blackjack/money';
import type { Decision, Rules } from '@blackjack/protocol';

/**
 * Persistence behind one port, two implementations held to one contract (`store.test.ts`): in
 * memory for tests and a throwaway dev server, SQLite for anything that must survive a restart.
 *
 * What is stored is what a restart needs and nothing the engine can recompute. A round is its
 * **inputs** — rules, seeds, stake, the balance it opened on, the decisions — never its state: the
 * engine is pure, so `replay` rebuilds the state exactly, shoe and all, on every request. The
 * resume path and the request path are one path, and a restart has nothing to restore.
 */

export interface SessionRow {
  readonly token: string;
  /** The wallet, with the open round's stakes debited. Equal to the open round's replayed balance. */
  readonly balance: Minor;
  /**
   * The server seed whose commit the session currently publishes: the next round's before a deal,
   * the open round's during it, and a fresh one from the settlement on (docs/protocol.md §3.1).
   */
  readonly serverSeed: string;
  readonly openRound: string | null;
  readonly lastSettled: string | null;
}

export interface RoundRow {
  readonly roundId: string;
  readonly token: string;
  readonly rules: Rules;
  readonly commit: string;
  readonly clientSeed: string;
  /** Secret while the round is open: never logged, never served before `settledAt`. */
  readonly serverSeed: string;
  readonly stake: Minor;
  /** The balance before the stake — all that affordability depends on, so `replay` needs it. */
  readonly openingBalance: Minor;
  /** Dev only: cards dealt from the top before the shuffled shoe (docs/protocol.md §9). */
  readonly forceShoe: readonly Card[] | null;
  readonly decisions: readonly Decision[];
  readonly settledAt: number | null;
}

/** A reply as it was sent, kept so a retry of the same `actionId` gets it back (§7). */
export interface ReplyRow {
  readonly token: string;
  readonly actionId: string;
  readonly roundId: string;
  /** The request body that produced it, canonicalised — a different body is `ACTION_ID_REUSED`. */
  readonly fingerprint: string;
  readonly body: string;
}

/** Everything one accepted request writes. `commit` applies it whole, or not at all. */
export interface Change {
  readonly session: SessionRow;
  readonly round?: RoundRow;
  readonly reply?: ReplyRow;
}

export interface Store {
  session(token: string): SessionRow | null;
  round(roundId: string): RoundRow | null;
  reply(token: string, actionId: string): ReplyRow | null;
  /** Settled rounds of a session, newest first, strictly older than `before` when given. */
  history(token: string, limit: number, before: string | null): RoundRow[];

  /**
   * Writes a change atomically, then forgets the session's stored replies for every round but its
   * open one and its last settled one (§7) — the replies a retry can still need.
   */
  commit(change: Change): void;

  /** A cheap round trip, for `/ready`. */
  ping(): void;
  close(): void;
}

/** The rounds whose replies a session keeps. */
export function keptRounds(session: SessionRow): Set<string> {
  return new Set([session.openRound, session.lastSettled].filter((id) => id !== null));
}
