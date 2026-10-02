import {
  actionReply,
  classOf,
  errorReply,
  fairRecord,
  faultsReply,
  faultsRequest,
  historyReply,
  httpStatus,
  roundReply,
  sessionReply,
} from '@blackjack/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { ServerConfig } from './config.js';
import type { Faults } from './faults.js';
import type { Answer, Table } from './table.js';

/**
 * The routes of docs/protocol.md §2, each a line: pull the token and the body off the request, hand
 * them to the table, send what it answers. In development every answer is parsed against its wire
 * schema before it leaves — a reply the client would refuse fails here, as a 500, with a reason.
 */
export function registerRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; table: Table; faults: Faults | null },
): void {
  const { config, table, faults } = deps;

  const send = (reply: FastifyReply, answer: Answer, schema: z.ZodType) => {
    if (config.env === 'development') {
      const wire = answer.status === 200 ? schema : errorReply;
      const parsed = wire.safeParse(answer.body);
      if (!parsed.success) {
        throw new Error(`reply breaks its schema: ${parsed.error.issues[0]?.message ?? ''}`);
      }
    }
    return reply.code(answer.status).send(answer.body);
  };

  /**
   * A game request with the session's faults around it (§9): held, refused unapplied, or — for a
   * deal or an act that applied — its reply thrown away and the connection closed. The table call
   * itself stays synchronous: the wait comes before it, never in the middle of it.
   */
  const game = async (
    req: FastifyRequest,
    reply: FastifyReply,
    run: (token: string | null) => Answer,
    schema: z.ZodType,
    droppable: boolean,
  ) => {
    const token = bearer(req);
    if (faults === null || token === null) return send(reply, run(token), schema);
    const { delayMs, unavailable } = faults.before(token);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (unavailable) return send(reply, UNAVAILABLE, schema);
    const answer = run(token);
    if (droppable && answer.status === 200 && faults.drop(token)) {
      reply.hijack();
      reply.raw.destroy(); // applied and stored; the reply never leaves
      return reply;
    }
    return send(reply, answer, schema);
  };

  app.post('/api/session', async (req, reply) =>
    send(reply, table.openSession(req.body), sessionReply),
  );
  app.post('/api/deal', async (req, reply) =>
    game(req, reply, (token) => table.deal(token, req.body), actionReply, true),
  );
  app.post('/api/act', async (req, reply) =>
    game(req, reply, (token) => table.act(token, req.body), actionReply, true),
  );
  app.get('/api/round', async (req, reply) =>
    game(req, reply, (token) => table.round(token), roundReply, false),
  );
  app.get('/api/history', async (req, reply) =>
    game(req, reply, (token) => table.history(token, req.query), historyReply, false),
  );
  if (faults !== null) {
    app.post('/api/faults', async (req, reply) => {
      const token = bearer(req);
      if (token === null || !table.knows(token)) return send(reply, UNKNOWN_SESSION, faultsReply);
      const patch = faultsRequest.safeParse(req.body ?? {});
      if (!patch.success) {
        const message = patch.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        return send(reply, refusal('MALFORMED', message), faultsReply);
      }
      return send(reply, { status: 200, body: faults.set(token, patch.data) }, faultsReply);
    });
  }
  app.get<{ Params: { roundId: string } }>('/fair/rounds/:roundId', async (req, reply) =>
    send(reply, table.fair(req.params.roundId), fairRecord),
  );

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_req, reply) =>
    table.ready() ? { ready: true } : reply.code(503).send({ ready: false, failed: ['store'] }),
  );
}

/** `Authorization: Bearer <token>` — or `null`, which the table answers as `UNKNOWN_SESSION`. */
function bearer(req: FastifyRequest): string | null {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '');
  return match?.[1] ?? null;
}

function refusal(code: 'MALFORMED' | 'UNKNOWN_SESSION' | 'UNAVAILABLE', message: string): Answer {
  return { status: httpStatus(code), body: { error: { class: classOf(code), code, message } } };
}

const UNAVAILABLE = refusal('UNAVAILABLE', 'The table is busy (an injected fault). Try again.');
const UNKNOWN_SESSION = refusal('UNKNOWN_SESSION', 'Session not known; open one first.');
