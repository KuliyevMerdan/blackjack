import {
  actionReply,
  errorReply,
  fairRecord,
  historyReply,
  roundReply,
  sessionReply,
} from '@blackjack/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { ServerConfig } from './config.js';
import type { Answer, Table } from './table.js';

/**
 * The routes of docs/protocol.md §2, each a line: pull the token and the body off the request, hand
 * them to the table, send what it answers. In development every answer is parsed against its wire
 * schema before it leaves — a reply the client would refuse fails here, as a 500, with a reason.
 */
export function registerRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; table: Table },
): void {
  const { config, table } = deps;

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

  app.post('/api/session', async (req, reply) =>
    send(reply, table.openSession(req.body), sessionReply),
  );
  app.post('/api/deal', async (req, reply) =>
    send(reply, table.deal(bearer(req), req.body), actionReply),
  );
  app.post('/api/act', async (req, reply) =>
    send(reply, table.act(bearer(req), req.body), actionReply),
  );
  app.get('/api/round', async (req, reply) => send(reply, table.round(bearer(req)), roundReply));
  app.get('/api/history', async (req, reply) =>
    send(reply, table.history(bearer(req), req.query), historyReply),
  );
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
