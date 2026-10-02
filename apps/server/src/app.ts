import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { classOf, httpStatus, type ErrorReply } from '@blackjack/protocol';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { ServerConfig } from './config.js';
import { Faults } from './faults.js';
import { registerRoutes } from './http.js';
import type { Store } from './store/store.js';
import { Table } from './table.js';

export interface ServerDeps {
  readonly config: ServerConfig;
  readonly store: Store;
  readonly log: Logger;
  readonly now?: () => number;
}

export interface Server {
  readonly app: FastifyInstance;
  readonly table: Table;
  /** Listens; resolves with the bound address. */
  listen(): Promise<string>;
  /** Stops listening and closes the store. */
  close(): Promise<void>;
}

/** Everything wired, nothing listening — tests and `main.ts` both build the server through here. */
export function createServer(deps: ServerDeps): Server {
  const { config, store, log } = deps;
  const table = new Table({ config, store, log, ...(deps.now ? { now: deps.now } : {}) });
  const app = Fastify<HttpServer, IncomingMessage, ServerResponse, FastifyBaseLogger>({
    loggerInstance: log,
    // The log is about rounds, keyed by roundId — not a line per request.
    logController: new LogController({ disableRequestLogging: true }),
  });

  // Fastify's own refusals (bad JSON, a body too large) and anything thrown, in §6's shape. A
  // throw is a bug: logged with its stack, answered as INTERNAL, its message kept off the wire.
  app.setErrorHandler((error, _req, reply) => {
    const status = statusOf(error);
    const code = status >= 400 && status < 500 ? 'MALFORMED' : 'INTERNAL';
    if (code === 'INTERNAL') log.error({ err: error }, 'request failed');
    const body: ErrorReply = {
      error: {
        class: classOf(code),
        code,
        message:
          code === 'MALFORMED' && error instanceof Error
            ? error.message
            : 'Something went wrong at the table.',
      },
    };
    return reply.code(httpStatus(code)).send(body);
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'no such route' }));

  const faults = config.faults ? new Faults() : null;
  registerRoutes(app, { config, table, faults });

  return {
    app,
    table,
    async listen() {
      const address = await app.listen({ host: config.host, port: config.port });
      log.info({ address, env: config.env, dev: config.dev, faults: config.faults }, 'listening');
      return address;
    },
    async close() {
      await app.close();
      store.close();
    },
  };
}

function statusOf(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return 500;
  return typeof error.statusCode === 'number' ? error.statusCode : 500;
}
