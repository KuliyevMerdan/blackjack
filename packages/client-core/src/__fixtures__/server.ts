import type { Card } from '@blackjack/cards';
import { act, deal, view, type State } from '@blackjack/engine';
import { bytesToHex, commit as commitOf, sha256, shoe, utf8 } from '@blackjack/fair';
import { minor, type Minor } from '@blackjack/money';
import {
  PUBLISHED_RULES,
  actRequest,
  classOf,
  dealRequest,
  gameConfig,
  httpStatus,
  sessionRequest,
  type ErrorCode,
  type GameConfig,
  type GameEvent,
  type Round,
} from '@blackjack/protocol';
import { TransportError, type Request, type Response, type Transport } from '../transport.js';

/**
 * A server for `client-core`'s tests: the protocol's routes and its order of checks
 * (docs/protocol.md §7) over the real engine and the real shuffle, in memory, with faults on a dial.
 * Not `apps/server` — a package may not import an app — but held to the same document, and small
 * enough to read in one sitting.
 */

export const CONFIG: GameConfig = gameConfig.parse({
  currency: 'EUR',
  betUnit: 100,
  minBet: 100,
  maxBet: 10_000,
  rules: PUBLISHED_RULES,
});

interface Stored {
  readonly roundId: string;
  readonly fingerprint: string;
  readonly response: Response;
}

interface Session {
  readonly token: string;
  balance: Minor;
  serverSeed: string;
  open: { state: State; shoe: Card[] } | null;
  last: State | null;
  replies: Map<string, Stored>;
}

export interface Faults {
  /** The server applies the request, and the reply never arrives. */
  dropReply?: number;
  /** The request arrives twice; the client sees the second answer. */
  duplicate?: number;
  /** The next N requests find the server down — no connection at all. */
  down?: number;
  /** The next N requests get `503 UNAVAILABLE`. */
  unavailable?: number;
  /** Rewrites a reply on its way out — for a lying server. */
  tamper?: (body: unknown) => unknown;
}

export class FakeServer {
  private readonly sessions = new Map<string, Session>();
  private counter = 0;
  faults: Faults = {};
  /** Every request that reached the server, in order. */
  readonly log: Request[] = [];
  /** Every client-side drop, so a test can count recoveries. */
  dropped = 0;

  constructor(private readonly random: () => number = () => 0.5) {}

  /** A restart: the process goes away for a few requests; everything it committed survives. */
  restart(downFor = 2): void {
    this.faults = { ...this.faults, down: downFor };
  }

  /** Forgets every session — a wiped database, which a client meets as `UNKNOWN_SESSION`. */
  wipe(): void {
    this.sessions.clear();
  }

  /** What the server holds for a session — the truth a client should converge to. */
  truthOf(token: string): { round: Round | null; balance: Minor; commit: string } {
    const s = this.session(token);
    const state = s.open?.state ?? s.last;
    return {
      round: state === null ? null : view(state),
      balance: s.balance,
      commit: commitOf(s.serverSeed),
    };
  }

  /** The client's view of the network: faults first, then the server. */
  readonly transport: Transport = async (request) => {
    const f = this.faults;
    if ((f.down ?? 0) > 0) {
      this.faults = { ...f, down: (f.down ?? 0) - 1 };
      throw new TransportError('connection refused');
    }
    if ((f.unavailable ?? 0) > 0) {
      this.faults = { ...f, unavailable: (f.unavailable ?? 0) - 1 };
      this.log.push(request);
      return error('UNAVAILABLE', 'Restarting.');
    }
    let response = this.handle(request);
    if (this.random() < (f.duplicate ?? 0)) response = this.handle(request);
    if (this.random() < (f.dropReply ?? 0)) {
      this.dropped += 1;
      throw new TransportError('reply lost');
    }
    return f.tamper ? { ...response, body: f.tamper(response.body) } : response;
  };

  handle(request: Request): Response {
    this.log.push(request);
    const route = `${request.method} ${request.path}`;
    if (route === 'POST /api/session') return this.openSession(request.body);
    const session = request.token === undefined ? undefined : this.sessions.get(request.token);
    if (session === undefined) return error('UNKNOWN_SESSION', 'Session not known.');
    switch (route) {
      case 'POST /api/deal':
        return this.deal(session, request.body);
      case 'POST /api/act':
        return this.act(session, request.body);
      case 'GET /api/round':
        return ok({
          round: session.open === null ? null : view(session.open.state),
          balance: session.balance,
          commit: commitOf(session.serverSeed),
        });
      default:
        return { status: 404, body: { error: 'no such route' } };
    }
  }

  private openSession(body: unknown): Response {
    const request = sessionRequest.safeParse(body ?? {});
    if (!request.success) return error('MALFORMED', request.error.message);
    const known =
      request.data.token === undefined ? undefined : this.sessions.get(request.data.token);
    const s = known ?? this.newSession();
    return ok({
      token: s.token,
      balance: s.balance,
      config: CONFIG,
      commit: commitOf(s.serverSeed),
      round: s.open === null ? null : view(s.open.state),
    });
  }

  private newSession(): Session {
    const token = this.hex('token');
    const s: Session = {
      token,
      balance: minor(100_000),
      serverSeed: this.hex('seed'),
      open: null,
      last: null,
      replies: new Map(),
    };
    this.sessions.set(token, s);
    return s;
  }

  private deal(s: Session, body: unknown): Response {
    const request = dealRequest.safeParse(body);
    if (!request.success) return error('MALFORMED', request.error.message);
    const { actionId, stake, clientSeed, commit } = request.data;
    const fingerprint = JSON.stringify(request.data);
    const replayed = this.replayed(s, actionId, fingerprint);
    if (replayed !== null) return replayed;
    if (s.open !== null) return this.conflict(s, 'ROUND_OPEN');
    if (commit !== commitOf(s.serverSeed)) return this.conflict(s, 'COMMIT_MISMATCH');
    if (stake % CONFIG.betUnit !== 0) return error('BET_NOT_A_UNIT_MULTIPLE', 'Off the unit.');
    if (stake < CONFIG.minBet || stake > CONFIG.maxBet) return error('BET_OUT_OF_RANGE', 'No.');

    const cards = shoe(s.serverSeed, clientSeed);
    const seeds = {
      roundId: this.roundId(),
      commit,
      clientSeed,
      serverSeed: s.serverSeed,
      forced: false,
    };
    const step = deal(
      { type: 'deal', rules: CONFIG.rules, seeds, stake, balance: s.balance },
      cards,
    );
    if (!step.ok) return error(step.refusal, 'Not enough.');
    return this.accept(s, step.state, cards, step.events, actionId, fingerprint);
  }

  private act(s: Session, body: unknown): Response {
    const request = actRequest.safeParse(body);
    if (!request.success) return error('MALFORMED', request.error.message);
    const { actionId, roundId, seq, action } = request.data;
    const fingerprint = JSON.stringify(request.data);
    const replayed = this.replayed(s, actionId, fingerprint);
    if (replayed !== null) return replayed;
    if (s.open === null) return this.conflict(s, 'NO_OPEN_ROUND');
    const { state, shoe: cards } = s.open;
    if (roundId !== state.seeds.roundId || seq !== state.seq) return this.conflict(s, 'STALE_SEQ');
    const step = act(state, action, cards);
    if (!step.ok) return error(step.refusal, 'Not allowed.');
    return this.accept(s, step.state, cards, step.events, actionId, fingerprint);
  }

  private accept(
    s: Session,
    state: State,
    cards: Card[],
    events: readonly GameEvent[],
    actionId: string,
    fingerprint: string,
  ): Response {
    const settled = state.phase === 'SETTLED';
    s.balance = state.balance;
    if (settled) {
      s.open = null;
      s.last = state;
      s.serverSeed = this.hex('seed');
    } else {
      s.open = { state, shoe: cards };
    }
    const response = ok({
      round: view(state),
      events,
      balance: state.balance,
      commit: commitOf(s.serverSeed),
    });
    s.replies.set(actionId, { roundId: state.seeds.roundId, fingerprint, response });
    const keep = new Set([s.open?.state.seeds.roundId, s.last?.seeds.roundId]);
    for (const [id, stored] of s.replies) if (!keep.has(stored.roundId)) s.replies.delete(id);
    return response;
  }

  private replayed(s: Session, actionId: string, fingerprint: string): Response | null {
    const stored = s.replies.get(actionId);
    if (stored === undefined) return null;
    return stored.fingerprint === fingerprint
      ? stored.response
      : this.conflict(s, 'ACTION_ID_REUSED');
  }

  private conflict(s: Session, code: ErrorCode): Response {
    const state = s.open?.state ?? s.last;
    return {
      status: httpStatus(code),
      body: {
        error: { class: classOf(code), code, message: code },
        round: state === null ? null : view(state),
        balance: s.balance,
        commit: commitOf(s.serverSeed),
      },
    };
  }

  private session(token: string): Session {
    const s = this.sessions.get(token);
    if (s === undefined) throw new Error('no such session');
    return s;
  }

  private hex(label: string): string {
    this.counter += 1;
    return bytesToHex(sha256(utf8(`fake:${label}:${this.counter}`)));
  }

  private roundId(): string {
    this.counter += 1;
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let id = '';
    for (let n = this.counter, i = 0; i < 26; i += 1, n = Math.floor(n / 32)) {
      id = alphabet.charAt(n % 32) + id;
    }
    return id;
  }
}

function ok(body: unknown): Response {
  return { status: 200, body: JSON.parse(JSON.stringify(body)) };
}

function error(code: ErrorCode, message: string): Response {
  return { status: httpStatus(code), body: { error: { class: classOf(code), code, message } } };
}
