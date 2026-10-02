import { randomBytes, randomUUID } from 'node:crypto';
import {
  actionReply,
  errorReply,
  sessionReply,
  type Action,
  type ActionReply,
  type ErrorReply,
  type Round,
} from '@blackjack/protocol';
import type { FastifyInstance } from 'fastify';
import { pino, type Logger } from 'pino';
import { createServer, type Server } from '../app.js';
import { readConfig, type ServerConfig } from '../config.js';
import { memoryStore } from '../store/memory.js';
import type { Store } from '../store/store.js';

export function testConfig(env: Record<string, string> = {}): ServerConfig {
  return readConfig({ HOST: '127.0.0.1', PORT: '0', BJ_DEV: 'on', LOG_LEVEL: 'info', ...env });
}

/** A server whose log lines are kept, so a test can read every one of them. */
export function build(config: ServerConfig = testConfig(), store: Store = memoryStore()) {
  const lines: string[] = [];
  const log: Logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
  const server = createServer({ config, store, log });
  return { server, store, lines };
}

export interface Response {
  readonly status: number;
  readonly body: unknown;
  /** The body exactly as it crossed the wire — what a leak scan reads. */
  readonly raw: string;
}

export type Call = (
  method: 'GET' | 'POST',
  url: string,
  options?: { body?: unknown; token?: string | null },
) => Promise<Response>;

/** Requests through Fastify's `inject` — the whole HTTP stack, no socket. */
export function injector(app: FastifyInstance): Call {
  return async (method, url, options = {}) => {
    const res = await app.inject({
      method,
      url,
      ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
    });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  };
}

/** Requests over a real socket. `base` is read on every call, so a restarted server can move. */
export function fetcher(base: () => string): Call {
  return async (method, url, options = {}) => {
    const res = await fetch(`${base()}${url}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await res.text();
    return { status: res.status, body: JSON.parse(raw), raw };
  };
}

export const clientSeed = (): string => randomBytes(16).toString('hex');
export const actionId = (): string => randomUUID();

/** A player on the wire: a token, the last truth it was shown, and the calls a client makes. */
export class Player {
  token = '';
  commit = '';
  balance = 0;
  round: Round | null = null;

  constructor(readonly call: Call) {}

  async open(token?: string): Promise<void> {
    const res = await this.call('POST', '/api/session', { body: token ? { token } : {} });
    const reply = sessionReply.parse(res.body);
    this.token = reply.token;
    this.commit = reply.commit;
    this.balance = reply.balance;
    this.round = reply.round;
  }

  async deal(stake: number, extra: Record<string, unknown> = {}, id = actionId()) {
    const body = { actionId: id, stake, clientSeed: clientSeed(), commit: this.commit, ...extra };
    return this.send('/api/deal', body);
  }

  async act(action: Action, id = actionId(), seq = this.round?.seq ?? 0) {
    const roundId = this.round?.roundId ?? '01K6H3Z8Q4M2V7XKX0C9T5RB1N';
    return this.send('/api/act', { actionId: id, roundId, seq, action });
  }

  /** Sends a game request and takes whatever truth comes back — a reply's, or a conflict's. */
  async send(url: string, body: unknown): Promise<Outcome> {
    const res = await this.call('POST', url, { body, token: this.token });
    return this.take(res);
  }

  take(res: Response): Outcome {
    if (res.status === 200) {
      const reply = actionReply.parse(res.body);
      this.round = reply.round;
      this.balance = reply.balance;
      this.commit = reply.commit;
      return { ok: true, reply, res };
    }
    const error = errorReply.parse(res.body);
    if (error.round !== undefined) this.round = error.round;
    if (error.balance !== undefined) this.balance = error.balance;
    if (error.commit !== undefined) this.commit = error.commit;
    return { ok: false, error, res };
  }
}

export type Outcome =
  | { readonly ok: true; readonly reply: ActionReply; readonly res: Response }
  | { readonly ok: false; readonly error: ErrorReply; readonly res: Response };

export type { Server };
