import {
  amount,
  card,
  clientSeed,
  decision,
  hash,
  roundId,
  rules,
  token,
} from '@blackjack/protocol';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { keptRounds, type ReplyRow, type RoundRow, type SessionRow, type Store } from './store.js';

/**
 * Migrations, in order. `PRAGMA user_version` records how many have run; each runs once, in a
 * transaction. Append only — an edited migration is a database that disagrees with its history.
 */
const MIGRATIONS = [
  `
  CREATE TABLE sessions (
    token        TEXT PRIMARY KEY,
    balance      INTEGER NOT NULL CHECK (balance >= 0),
    server_seed  TEXT    NOT NULL,
    open_round   TEXT,
    last_settled TEXT
  );
  CREATE TABLE rounds (
    round_id         TEXT PRIMARY KEY,
    token            TEXT    NOT NULL REFERENCES sessions (token),
    rules            TEXT    NOT NULL,
    commit_hash      TEXT    NOT NULL,
    client_seed      TEXT    NOT NULL,
    server_seed      TEXT    NOT NULL,
    stake            INTEGER NOT NULL,
    opening_balance  INTEGER NOT NULL,
    force_shoe       TEXT,
    decisions        TEXT    NOT NULL,
    settled_at       INTEGER
  );
  CREATE INDEX rounds_history ON rounds (token, round_id) WHERE settled_at IS NOT NULL;
  CREATE TABLE replies (
    token       TEXT NOT NULL,
    action_id   TEXT NOT NULL,
    round_id    TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    body        TEXT NOT NULL,
    PRIMARY KEY (token, action_id)
  );
  `,
];

/** Rows are parsed on the way out like any other boundary: a corrupt row fails loudly, here. */
const json = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((text, ctx) => {
      try {
        return JSON.parse(text);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'not JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);

const sessionRow = z.object({
  token,
  balance: amount,
  server_seed: hash,
  open_round: roundId.nullable(),
  last_settled: roundId.nullable(),
});

const roundRow = z.object({
  round_id: roundId,
  token,
  rules: json(rules),
  commit_hash: hash,
  client_seed: clientSeed,
  server_seed: hash,
  stake: amount,
  opening_balance: amount,
  force_shoe: json(z.array(card)).nullable(),
  decisions: json(z.array(decision)),
  settled_at: z.int().nullable(),
});

const replyRow = z.object({
  token,
  action_id: z.string(),
  round_id: roundId,
  fingerprint: z.string(),
  body: z.string(),
});

const toSession = (row: unknown): SessionRow => {
  const r = sessionRow.parse(row);
  return {
    token: r.token,
    balance: r.balance,
    serverSeed: r.server_seed,
    openRound: r.open_round,
    lastSettled: r.last_settled,
  };
};

const toRound = (row: unknown): RoundRow => {
  const r = roundRow.parse(row);
  return {
    roundId: r.round_id,
    token: r.token,
    rules: r.rules,
    commit: r.commit_hash,
    clientSeed: r.client_seed,
    serverSeed: r.server_seed,
    stake: r.stake,
    openingBalance: r.opening_balance,
    forceShoe: r.force_shoe,
    decisions: r.decisions,
    settledAt: r.settled_at,
  };
};

const toReply = (row: unknown): ReplyRow => {
  const r = replyRow.parse(row);
  return {
    token: r.token,
    actionId: r.action_id,
    roundId: r.round_id,
    fingerprint: r.fingerprint,
    body: r.body,
  };
};

/**
 * SQLite through better-sqlite3 — synchronous, which is the point: a request loads its round,
 * steps the engine and commits, with no `await` for a second tab's request to slip into. WAL with
 * `synchronous = FULL`: a committed step is on disk before its reply leaves (docs/protocol.md §8).
 */
export function sqliteStore(path: string): Store {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  const version = z.int().parse(db.pragma('user_version', { simple: true }));
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i] ?? '');
      db.pragma(`user_version = ${i + 1}`);
    })();
  }

  const q = {
    session: db.prepare('SELECT * FROM sessions WHERE token = ?'),
    round: db.prepare('SELECT * FROM rounds WHERE round_id = ?'),
    reply: db.prepare('SELECT * FROM replies WHERE token = ? AND action_id = ?'),
    history: db.prepare(
      `SELECT * FROM rounds
       WHERE token = @token AND settled_at IS NOT NULL AND (@before IS NULL OR round_id < @before)
       ORDER BY round_id DESC LIMIT @limit`,
    ),
    putSession: db.prepare(
      `INSERT INTO sessions (token, balance, server_seed, open_round, last_settled)
       VALUES (@token, @balance, @serverSeed, @openRound, @lastSettled)
       ON CONFLICT (token) DO UPDATE SET balance = excluded.balance,
         server_seed = excluded.server_seed, open_round = excluded.open_round,
         last_settled = excluded.last_settled`,
    ),
    putRound: db.prepare(
      `INSERT INTO rounds (round_id, token, rules, commit_hash, client_seed, server_seed, stake,
         opening_balance, force_shoe, decisions, settled_at)
       VALUES (@roundId, @token, @rules, @commit, @clientSeed, @serverSeed, @stake,
         @openingBalance, @forceShoe, @decisions, @settledAt)
       ON CONFLICT (round_id) DO UPDATE SET decisions = excluded.decisions,
         settled_at = excluded.settled_at`,
    ),
    putReply: db.prepare(
      `INSERT INTO replies (token, action_id, round_id, fingerprint, body)
       VALUES (@token, @actionId, @roundId, @fingerprint, @body)`,
    ),
    pruneReplies: db.prepare(
      `DELETE FROM replies WHERE token = @token
       AND round_id NOT IN (COALESCE(@open, ''), COALESCE(@last, ''))`,
    ),
    ping: db.prepare('SELECT 1'),
  };

  const commit = db.transaction((change: Parameters<Store['commit']>[0]) => {
    const { session, round, reply } = change;
    q.putSession.run(session);
    if (round !== undefined) {
      q.putRound.run({
        ...round,
        rules: JSON.stringify(round.rules),
        forceShoe: round.forceShoe === null ? null : JSON.stringify(round.forceShoe),
        decisions: JSON.stringify(round.decisions),
      });
    }
    if (reply !== undefined) q.putReply.run(reply);
    const kept = [...keptRounds(session)];
    q.pruneReplies.run({ token: session.token, open: kept[0] ?? null, last: kept[1] ?? null });
  });

  return {
    session(token) {
      const row = q.session.get(token);
      return row === undefined ? null : toSession(row);
    },
    round(id) {
      const row = q.round.get(id);
      return row === undefined ? null : toRound(row);
    },
    reply(token, actionId) {
      const row = q.reply.get(token, actionId);
      return row === undefined ? null : toReply(row);
    },
    history: (token, limit, before) => q.history.all({ token, limit, before }).map(toRound),
    commit: (change) => commit(change),
    ping() {
      q.ping.get();
    },
    close() {
      db.close();
    },
  };
}
