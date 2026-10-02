import type { Minor } from '@blackjack/money';
import {
  actionReply,
  errorReply,
  fold,
  roundReply,
  sessionReply,
  tableOf,
  type Action,
  type ErrorCode,
  type GameConfig,
  type GameEvent,
  type Round,
} from '@blackjack/protocol';
import { inMemory, SentRounds, type KeyValue } from './memory.js';
import { TransportError, type Request, type Response, type Transport } from './transport.js';

/** The truth (ADR-0002): exactly what the server last said, replaced wholesale by every reply. */
export interface Truth {
  readonly token: string;
  readonly config: GameConfig;
  readonly balance: Minor;
  readonly commit: string;
  readonly round: Round | null;
}

/**
 * One replacement of the truth. `events` are the reply's — the director's script from `previous`
 * to `next` — and empty when there is nothing to animate: a resume, a resync, a conflict. Those are
 * rendered as they stand.
 */
export interface Change {
  readonly cause: 'open' | 'reply' | 'conflict' | 'resync';
  readonly previous: Truth | null;
  readonly next: Truth;
  readonly events: readonly GameEvent[];
}

/** How an intent ended. The truth has already changed (or not) by the time this resolves. */
export type Outcome =
  | { readonly kind: 'ok' }
  /** Another request is in flight: a double tap is one request. Nothing was sent. */
  | { readonly kind: 'busy' }
  /** Not open to the player as the truth stands — not in `allowed`, no round. Nothing was sent. */
  | { readonly kind: 'unavailable' }
  /** `PLAYER`: the server refused; nothing changed. Say it in words. */
  | { readonly kind: 'refused'; readonly code: ErrorCode; readonly message: string }
  /** `CONFLICT`: the truth was behind and has been replaced with the attached state. */
  | { readonly kind: 'conflict'; readonly code: ErrorCode }
  /** A typed client seed met a commit that moved: the player confirms before it is re-sent (§3.1). */
  | { readonly kind: 'commitMoved' }
  /** The session was not known; a new one is open, with a new wallet. */
  | { readonly kind: 'sessionLost' }
  /** No usable reply after every retry. The truth is unchanged; `resync()` asks again. */
  | { readonly kind: 'failed'; readonly reason: string };

export interface ClientOptions {
  readonly transport: Transport;
  readonly sleep: (ms: number) => Promise<void>;
  /** In [0, 1): the jitter on backoff. */
  readonly random: () => number;
  /** A fresh lowercase UUID — an `actionId`. */
  readonly uuid: () => string;
  /** A fresh client seed — 16 random bytes as hex, by default (§3.1). */
  readonly clientSeed: () => string;
  /** Where the token, a typed seed and the sent rounds live between visits. */
  readonly storage?: KeyValue;
  /** Assert invariant 6 on every reply: the events fold from the previous round to the new one. */
  readonly dev?: boolean;
  readonly retry?: {
    readonly attempts?: number;
    readonly baseMs?: number;
    readonly maxMs?: number;
  };
}

/** A reply whose events do not prove its snapshot. In dev, a server bug or a client one: loud. */
export class InvariantError extends Error {
  override readonly name = 'InvariantError';
}

const TOKEN = 'bj:token';
const TYPED_SEED = 'bj:seed';

type Sent =
  | { readonly kind: 'reply'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'lost'; readonly reason: string };

/**
 * The client's whole relationship with the server (CLAUDE.md § The client: truth, script, stage):
 * the only thing that talks to it, and the only holder of what it said.
 *
 * - **One request in flight.** A second intent while one is out is `busy`, not queued: a queued Hit
 *   would be a decision on a card the player has not seen.
 * - **An `actionId` per intent**, kept across every retry of it, and the `seq` of the snapshot the
 *   decision was made on (§7). A lost reply is recovered by the retry — the server answers a known
 *   `actionId` with the reply it stored — never by guessing what probably happened.
 * - **`SYSTEM` and silence are retried** with exponential backoff and jitter; **`CONFLICT` never
 *   is**: it carries the state that resolves it, which becomes the truth.
 */
export class Client {
  private truth: Truth | null = null;
  private inFlight = false;
  private readonly listeners = new Set<(change: Change) => void>();
  private readonly storage: KeyValue;
  readonly sent: SentRounds;

  constructor(private readonly options: ClientOptions) {
    this.storage = options.storage ?? inMemory();
    this.sent = new SentRounds(this.storage);
  }

  /** The truth as it stands, or `null` before `open()`. */
  get state(): Truth | null {
    return this.truth;
  }

  get busy(): boolean {
    return this.inFlight;
  }

  /** Every replacement of the truth, in order. Returns the unsubscribe. */
  subscribe(listener: (change: Change) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** A client seed the player typed, kept until changed; `null` returns to a fresh one per round. */
  get typedSeed(): string | null {
    return read(this.storage, TYPED_SEED);
  }

  setTypedSeed(seed: string | null): void {
    write(this.storage, TYPED_SEED, seed ?? '');
  }

  // ── session ─────────────────────────────────────────────────────────────────────────────

  /**
   * Opens the stored session, or a new one. An open round comes back as it stands — the entire
   * resume story (§8): rendered directly, no replay.
   */
  async open(): Promise<Outcome> {
    return this.exclusive(() => this.openSession());
  }

  private async openSession(): Promise<Outcome> {
    const token = read(this.storage, TOKEN);
    const sent = await this.call({
      method: 'POST',
      path: '/api/session',
      body: token === null ? {} : { token },
    });
    if (sent.kind === 'lost') return { kind: 'failed', reason: sent.reason };
    const reply = sessionReply.safeParse(sent.body);
    if (!reply.success) return { kind: 'failed', reason: 'session reply did not parse' };
    write(this.storage, TOKEN, reply.data.token);
    const { token: t, config, balance, commit, round } = reply.data;
    this.replace('open', { token: t, config, balance, commit, round }, []);
    return { kind: 'ok' };
  }

  /** Asks the server for the round as it now is (§2.5) — after a failure, or a long sleep. */
  async resync(): Promise<Outcome> {
    return this.exclusive(async () => {
      const truth = this.truth;
      if (truth === null) return this.openSession();
      const sent = await this.call({ method: 'GET', path: '/api/round', token: truth.token });
      if (sent.kind === 'lost') return { kind: 'failed', reason: sent.reason };
      const reply = roundReply.safeParse(sent.body);
      if (!reply.success) return this.answerError(sent.body);
      this.replace('resync', { ...truth, ...reply.data }, []);
      return { kind: 'ok' };
    });
  }

  // ── intents ─────────────────────────────────────────────────────────────────────────────

  /**
   * Places a stake and deals. A fresh client seed per round unless the player typed one. When the
   * commit has moved (`COMMIT_MISMATCH`), a fresh seed is drawn and the deal re-sent once — never
   * the old seed under the new commit (invariant 8); a typed seed instead comes back as
   * `commitMoved`, for the player to confirm against the new commit.
   */
  async deal(stake: Minor): Promise<Outcome> {
    return this.exclusive(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const truth = this.truth;
        if (truth === null || (truth.round !== null && truth.round.phase !== 'SETTLED')) {
          return { kind: 'unavailable' };
        }
        const clientSeed = this.typedSeed ?? this.options.clientSeed();
        const body = { actionId: this.options.uuid(), stake, clientSeed, commit: truth.commit };
        const outcome = await this.game('/api/deal', body, truth);
        if (outcome.kind === 'ok') {
          const round = this.truth?.round;
          if (round) this.sent.add({ roundId: round.roundId, commit: body.commit, clientSeed });
          return outcome;
        }
        if (outcome.kind !== 'conflict' || outcome.code !== 'COMMIT_MISMATCH') return outcome;
        if (this.typedSeed !== null) return { kind: 'commitMoved' };
      }
      return { kind: 'failed', reason: 'the commit kept moving' };
    });
  }

  /** One decision on the open round, made on the snapshot the player is looking at. */
  async act(action: Action): Promise<Outcome> {
    return this.exclusive(async () => {
      const truth = this.truth;
      const round = truth?.round;
      if (truth === null || !round || !round.allowed.includes(action)) {
        return { kind: 'unavailable' };
      }
      const body = {
        actionId: this.options.uuid(),
        roundId: round.roundId,
        seq: round.seq,
        action,
      };
      return this.game('/api/act', body, truth);
    });
  }

  // ── the request path ────────────────────────────────────────────────────────────────────

  /** A game request: retried under one body (one `actionId`), its answer applied to the truth. */
  private async game(path: string, body: unknown, decidedOn: Truth): Promise<Outcome> {
    const sent = await this.call({ method: 'POST', path, body, token: decidedOn.token });
    if (sent.kind === 'lost') return { kind: 'failed', reason: sent.reason };
    if (sent.status === 200) {
      const reply = actionReply.safeParse(sent.body);
      if (!reply.success) return { kind: 'failed', reason: 'reply did not parse' };
      const { round, events, balance, commit } = reply.data;
      if (this.options.dev === true) proves(decidedOn.round, events, round);
      this.replace('reply', { ...decidedOn, round, balance, commit }, events);
      return { kind: 'ok' };
    }
    return this.answerError(sent.body);
  }

  private async answerError(body: unknown): Promise<Outcome> {
    const reply = errorReply.safeParse(body);
    if (!reply.success) return { kind: 'failed', reason: 'error reply did not parse' };
    const { error } = reply.data;
    switch (error.class) {
      case 'PLAYER':
        return { kind: 'refused', code: error.code, message: error.message };
      case 'CONFLICT': {
        const truth = this.truth;
        if (truth !== null) {
          this.replace(
            'conflict',
            {
              ...truth,
              round: reply.data.round === undefined ? truth.round : reply.data.round,
              balance: reply.data.balance ?? truth.balance,
              commit: reply.data.commit ?? truth.commit,
            },
            [],
          );
        }
        return { kind: 'conflict', code: error.code };
      }
      case 'SESSION': {
        write(this.storage, TOKEN, '');
        const reopened = await this.openSession();
        return reopened.kind === 'ok' ? { kind: 'sessionLost' } : reopened;
      }
      case 'SYSTEM':
        return { kind: 'failed', reason: error.message };
      default: {
        const unhandled: never = error.class;
        return { kind: 'failed', reason: `unknown error class ${String(unhandled)}` };
      }
    }
  }

  /**
   * Sends one request until something other than silence or `SYSTEM` comes back, or the attempts
   * run out — with the same body every time, so a retry of a game request is the same intent.
   */
  private async call(request: Request): Promise<Sent> {
    const attempts = this.options.retry?.attempts ?? 6;
    const baseMs = this.options.retry?.baseMs ?? 250;
    const maxMs = this.options.retry?.maxMs ?? 4000;
    let last = 'no attempt made';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        // Equal jitter: half the backoff fixed, half random — retries from many clients spread out.
        const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
        await this.options.sleep(backoff / 2 + (backoff / 2) * this.options.random());
      }
      let response: Response;
      try {
        response = await this.options.transport(request);
      } catch (error) {
        if (!(error instanceof TransportError)) throw error;
        last = error.message;
        continue;
      }
      if (!retryable(response))
        return { kind: 'reply', status: response.status, body: response.body };
      last = `HTTP ${response.status}`;
    }
    return { kind: 'lost', reason: last };
  }

  // ── the truth ───────────────────────────────────────────────────────────────────────────

  private replace(cause: Change['cause'], next: Truth, events: readonly GameEvent[]): void {
    const previous = this.truth;
    this.truth = next;
    for (const listener of this.listeners) listener({ cause, previous, next, events });
  }

  private async exclusive(run: () => Promise<Outcome>): Promise<Outcome> {
    if (this.inFlight) return { kind: 'busy' };
    this.inFlight = true;
    try {
      return await run();
    } finally {
      this.inFlight = false;
    }
  }
}

/** `SYSTEM`, or a 5xx that is not even our error shape (a proxy's page): worth another try. */
function retryable(response: Response): boolean {
  if (response.status < 500) return false;
  const parsed = errorReply.safeParse(response.body);
  return !parsed.success || parsed.data.error.class === 'SYSTEM';
}

/**
 * Invariant 6, asserted: the reply's events, applied to the round it was decided on, give the
 * reply's round. A deal's events start from nothing, so `previous` does not matter there.
 */
function proves(previous: Round | null, events: readonly GameEvent[], next: Round): void {
  const folded = canonical(fold(previous, events));
  const shown = canonical(tableOf(next));
  if (folded !== shown) {
    throw new InvariantError(`the events do not fold to the snapshot:\n${folded}\n${shown}`);
  }
}

/** JSON with sorted keys and no `undefined` — structural equality as a string compare. */
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

function read(storage: KeyValue, key: string): string | null {
  try {
    const value = storage.get(key);
    return value === null || value === '' ? null : value;
  } catch {
    return null;
  }
}

function write(storage: KeyValue, key: string, value: string): void {
  try {
    storage.set(key, value);
  } catch {
    // blocked storage: this visit still plays; the next one starts a new session
  }
}
