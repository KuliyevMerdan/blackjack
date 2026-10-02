import { type Card } from '@blackjack/cards';
import { act, deal, dealt, replay, view, type Seeds, type State } from '@blackjack/engine';
import { commit as commitOf, shoe as shuffle } from '@blackjack/fair';
import {
  actRequest,
  classOf,
  dealRequest,
  devDealRequest,
  historyQuery,
  httpStatus,
  roundId as roundIdSchema,
  sessionRequest,
  type ActionReply,
  type ErrorCode,
  type ErrorReply,
  type FairRecord,
  type GameEvent,
  type HistoryReply,
  type Round,
  type RoundReply,
  type SessionReply,
} from '@blackjack/protocol';
import type { Logger } from 'pino';
import type { ServerConfig } from './config.js';
import { newServerSeed, newToken, ulidFactory } from './ids.js';
import type { RoundRow, SessionRow, Store } from './store/store.js';

/** What a handler answers: an HTTP status and a body already in its wire shape. */
export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

export interface TableDeps {
  readonly config: ServerConfig;
  readonly store: Store;
  readonly log: Logger;
  readonly now?: () => number;
}

/**
 * The table: sessions, wallets, seeds, idempotency and versions around the engine
 * (CLAUDE.md § The round lives in the engine, the table lives in the server). No HTTP in it — the
 * routes in `http.ts` hand it a token and a body and send back what it answers.
 *
 * **Synchronous from the first read to the commit.** A request loads its session and round, steps
 * the engine and commits, with no `await` anywhere: two tabs' requests are serialised by the event
 * loop itself, and the second always reads what the first wrote.
 *
 * **A round is replayed, never restored.** Its row holds inputs — seeds, stake, opening balance,
 * decisions — and every request rebuilds the state through `engine.replay`, the verifier's own
 * function, from a shoe regenerated from the seeds. A restart has nothing to resume: the next
 * request does what every request does.
 */
export class Table {
  private readonly config: ServerConfig;
  private readonly store: Store;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly ulid = ulidFactory();

  constructor(deps: TableDeps) {
    this.config = deps.config;
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
  }

  // ── §2.1 ────────────────────────────────────────────────────────────────────────────────

  /** Resumes the session the token names, or opens a fresh one with a fresh wallet. */
  openSession(body: unknown): Answer {
    const request = sessionRequest.safeParse(body ?? {});
    if (!request.success) return malformed(request.error);
    const known = request.data.token === undefined ? null : this.store.session(request.data.token);
    const session = known ?? this.newSession();
    const reply: SessionReply = {
      token: session.token,
      balance: session.balance,
      config: this.config.game,
      commit: commitOf(session.serverSeed),
      round: session.openRound === null ? null : this.openRoundView(session),
    };
    return ok(reply);
  }

  private newSession(): SessionRow {
    const session: SessionRow = {
      token: newToken(),
      balance: this.config.startingBalance,
      serverSeed: newServerSeed(),
      openRound: null,
      lastSettled: null,
    };
    this.store.commit({ session });
    this.log.info({ event: 'session-opened' }, 'session opened');
    return session;
  }

  // ── §2.3 ────────────────────────────────────────────────────────────────────────────────

  deal(token: string | null, body: unknown): Answer {
    const session = this.authorise(token);
    if (session === null) return unknownSession();
    // A production server parses with the schema that has no `forceShoe`, so the field is dropped
    // like any unknown one (invariant 9) and a forced shoe cannot reach a real round (§9).
    const request = (this.config.dev ? devDealRequest : dealRequest).safeParse(body);
    if (!request.success) return malformed(request.error);
    const { actionId, stake, clientSeed, commit } = request.data;
    const dev = this.config.dev ? devDealRequest.safeParse(body) : null;
    const forceShoe = dev?.success === true ? (dev.data.forceShoe ?? null) : null;

    const fingerprint = canonical(request.data);
    const replayed = this.replayed(session, actionId, fingerprint);
    if (replayed !== null) return replayed;

    if (session.openRound !== null) {
      return this.conflict('ROUND_OPEN', 'A hand is already open.', session);
    }
    const current = commitOf(session.serverSeed);
    if (commit !== current) {
      return this.conflict('COMMIT_MISMATCH', 'The commit has moved on; draw a new seed.', session);
    }
    const { betUnit, minBet, maxBet, rules } = this.config.game;
    if (stake % betUnit !== 0) {
      return fail('BET_NOT_A_UNIT_MULTIPLE', `Stakes are multiples of ${betUnit}.`);
    }
    if (stake < minBet || stake > maxBet) {
      return fail('BET_OUT_OF_RANGE', `Stakes run from ${minBet} to ${maxBet}.`);
    }

    const row: RoundRow = {
      roundId: this.ulid(this.now()),
      token: session.token,
      rules,
      commit: current,
      clientSeed,
      serverSeed: session.serverSeed,
      stake,
      openingBalance: session.balance,
      forceShoe,
      decisions: [],
      settledAt: null,
    };
    const shoe = shoeOf(row);
    const step = deal(
      { type: 'deal', rules, seeds: seedsOf(row), stake, balance: session.balance },
      shoe,
    );
    if (!step.ok) return fail(step.refusal, 'The balance does not cover the stake.');

    return this.accept(session, row, step.state, step.events, actionId, fingerprint, 'deal');
  }

  // ── §2.4 ────────────────────────────────────────────────────────────────────────────────

  act(token: string | null, body: unknown): Answer {
    const session = this.authorise(token);
    if (session === null) return unknownSession();
    const request = actRequest.safeParse(body);
    if (!request.success) return malformed(request.error);
    const { actionId, roundId, seq, action } = request.data;

    // §7: session → actionId replay → seq → rules. A retry of an action that succeeded is
    // answered by its own reply, not by a conflict with the version it created.
    const fingerprint = canonical(request.data);
    const replayed = this.replayed(session, actionId, fingerprint);
    if (replayed !== null) return replayed;

    const row = session.openRound === null ? null : this.store.round(session.openRound);
    if (row === null) return this.conflict('NO_OPEN_ROUND', 'No hand is open.', session);
    const state = this.stateOf(row, session);
    if (roundId !== row.roundId || seq !== state.seq) {
      return this.conflict('STALE_SEQ', 'The hand has moved on.', session);
    }

    const step = act(state, action, shoeOf(row));
    if (!step.ok) return fail(step.refusal, `${action} is not open to this hand.`);
    const next: RoundRow = { ...row, decisions: [...row.decisions, { seq, action }] };
    return this.accept(session, next, step.state, step.events, actionId, fingerprint, action);
  }

  // ── §2.5, §2.6, §3.4 ───────────────────────────────────────────────────────────────────

  round(token: string | null): Answer {
    const session = this.authorise(token);
    if (session === null) return unknownSession();
    const reply: RoundReply = {
      round: session.openRound === null ? null : this.openRoundView(session),
      balance: session.balance,
      commit: commitOf(session.serverSeed),
    };
    return ok(reply);
  }

  history(token: string | null, query: unknown): Answer {
    const session = this.authorise(token);
    if (session === null) return unknownSession();
    const parsed = historyQuery.safeParse(query);
    if (!parsed.success) return malformed(parsed.error);
    const rows = this.store.history(session.token, parsed.data.limit, parsed.data.before ?? null);
    const reply: HistoryReply = {
      rounds: rows.map((row) => {
        const round = view(this.settledState(row));
        return {
          roundId: row.roundId,
          settledAt: settledAtOf(row),
          stake: row.stake,
          totalStake: round.totalStake,
          totalPayout: settledPayout(round),
          dealer: round.dealer.cards,
          hands: round.hands.map((h) => h.cards),
        };
      }),
    };
    return ok(reply);
  }

  /** Public: a settled round's full record. An open round is as unknown as one that never was. */
  fair(id: string): Answer {
    const parsed = roundIdSchema.safeParse(id);
    if (!parsed.success) return malformed(parsed.error);
    const row = this.store.round(parsed.data);
    if (row === null || row.settledAt === null) {
      return fail('UNKNOWN_ROUND', 'No settled round has that id.');
    }
    const state = this.settledState(row);
    const record: FairRecord = {
      roundId: row.roundId,
      settledAt: row.settledAt,
      rules: row.rules,
      commit: row.commit,
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      stake: row.stake,
      decisions: [...row.decisions],
      dealt: dealt(state, shoeOf(row)),
      round: view(state),
    };
    return ok(record);
  }

  /** `/ready`: the store answers. */
  ready(): boolean {
    try {
      this.store.ping();
      return true;
    } catch {
      return false;
    }
  }

  // ── the write path ─────────────────────────────────────────────────────────────────────

  /**
   * Commits an accepted step — the round's inputs, the wallet, the next seed if it settled, and the
   * reply — in one transaction, and only then answers (docs/protocol.md §8).
   */
  private accept(
    session: SessionRow,
    row: RoundRow,
    state: State,
    events: readonly GameEvent[],
    actionId: string,
    fingerprint: string,
    action: string,
  ): Answer {
    const settled = state.phase === 'SETTLED';
    const settledRow: RoundRow = settled ? { ...row, settledAt: this.now() } : row;
    const nextSession: SessionRow = {
      ...session,
      balance: state.balance,
      // The seed changes only at settlement: a fresh one is drawn for the next round (§3.1).
      serverSeed: settled ? newServerSeed() : session.serverSeed,
      openRound: settled ? null : row.roundId,
      lastSettled: settled ? row.roundId : session.lastSettled,
    };
    const reply: ActionReply = {
      round: view(state),
      events: [...events],
      balance: state.balance,
      commit: commitOf(nextSession.serverSeed),
    };
    const body = JSON.stringify(reply);
    this.store.commit({
      session: nextSession,
      round: settledRow,
      reply: { token: session.token, actionId, roundId: row.roundId, fingerprint, body },
    });
    // Ids, versions and outcomes only: never a card, never a seed (CLAUDE.md § Other rules).
    this.log.info(
      { event: 'step', roundId: row.roundId, seq: state.seq, action, phase: state.phase },
      settled ? 'round settled' : 'round stepped',
    );
    return { status: 200, body: reply };
  }

  /** A known `actionId`: the stored reply, or `ACTION_ID_REUSED` for a different body. */
  private replayed(session: SessionRow, actionId: string, fingerprint: string): Answer | null {
    const stored = this.store.reply(session.token, actionId);
    if (stored === null) return null;
    if (stored.fingerprint !== fingerprint) {
      return this.conflict(
        'ACTION_ID_REUSED',
        'That actionId was used for another request.',
        session,
      );
    }
    const body: unknown = JSON.parse(stored.body);
    return { status: 200, body };
  }

  // ── reading rounds ─────────────────────────────────────────────────────────────────────

  private authorise(token: string | null): SessionRow | null {
    return token === null ? null : this.store.session(token);
  }

  private openRoundView(session: SessionRow): Round | null {
    const row = session.openRound === null ? null : this.store.round(session.openRound);
    return row === null ? null : view(this.stateOf(row, session));
  }

  /** The round a conflict should show: the open one, else the one that just settled. */
  private conflict(code: ErrorCode, message: string, session: SessionRow): Answer {
    const id = session.openRound ?? session.lastSettled;
    const row = id === null ? null : this.store.round(id);
    const round = row === null ? null : view(this.stateOf(row, session));
    const body: ErrorReply = {
      error: { class: classOf(code), code, message },
      round,
      balance: session.balance,
      commit: commitOf(session.serverSeed),
    };
    return { status: httpStatus(code), body };
  }

  /**
   * The round's state, rebuilt by `replay` from its inputs. For the open round the replayed
   * balance must be the wallet's — they are two records of one number, and a disagreement is a
   * bug that must stop the request rather than be dealt on.
   */
  private stateOf(row: RoundRow, session: SessionRow): State {
    const state = this.replayRow(row);
    if (row.roundId === session.openRound && state.balance !== session.balance) {
      throw new Error(`round ${row.roundId} replays to a balance its wallet does not hold`);
    }
    return state;
  }

  private settledState(row: RoundRow): State {
    const state = this.replayRow(row);
    if (state.phase !== 'SETTLED') throw new Error(`round ${row.roundId} does not replay settled`);
    return state;
  }

  private replayRow(row: RoundRow): State {
    const result = replay({
      rules: row.rules,
      seeds: seedsOf(row),
      stake: row.stake,
      decisions: row.decisions,
      shoe: shoeOf(row),
      balance: row.openingBalance,
    });
    if (!result.ok) {
      throw new Error(`round ${row.roundId} does not replay: ${result.refusal} at ${result.at}`);
    }
    return result.state;
  }
}

/** The shoe a round is dealt from: a dev-forced top, then the shuffle of its two seeds (§3.2, §9). */
function shoeOf(row: RoundRow): Card[] {
  const shuffled = shuffle(row.serverSeed, row.clientSeed, row.rules.decks);
  return row.forceShoe === null ? shuffled : [...row.forceShoe, ...shuffled];
}

function seedsOf(row: RoundRow): Seeds {
  return {
    roundId: row.roundId,
    commit: row.commit,
    clientSeed: row.clientSeed,
    serverSeed: row.serverSeed,
    forced: row.forceShoe !== null,
  };
}

function settledPayout(round: Round): NonNullable<Round['totalPayout']> {
  if (round.totalPayout === undefined) throw new Error(`round ${round.roundId} has no payout`);
  return round.totalPayout;
}

function settledAtOf(row: RoundRow): number {
  if (row.settledAt === null) throw new Error(`round ${row.roundId} is not settled`);
  return row.settledAt;
}

/** A request body as one string, keys sorted — what an `actionId` is held to (§7). */
export function canonical(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, x]) => [k, sorted(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(sorted(value));
}

function ok(body: unknown): Answer {
  return { status: 200, body };
}

function fail(code: ErrorCode, message: string): Answer {
  const body: ErrorReply = { error: { class: classOf(code), code, message } };
  return { status: httpStatus(code), body };
}

function malformed(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): Answer {
  const message = error.issues
    .map((i) => `${i.path.map(String).join('.') || '(body)'}: ${i.message}`)
    .join('; ');
  return fail('MALFORMED', message);
}

function unknownSession(): Answer {
  return fail('UNKNOWN_SESSION', 'Session not known; open one with POST /api/session.');
}
