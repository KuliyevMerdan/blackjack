import { keptRounds, type ReplyRow, type RoundRow, type SessionRow, type Store } from './store.js';

/**
 * The store in three maps. A `commit` cannot fail half way — every write is a map assignment of a
 * value already built — so atomicity needs no undo log.
 */
export function memoryStore(): Store {
  const sessions = new Map<string, SessionRow>();
  const rounds = new Map<string, RoundRow>();
  const replies = new Map<string, Map<string, ReplyRow>>();

  return {
    session: (token) => sessions.get(token) ?? null,
    round: (roundId) => rounds.get(roundId) ?? null,
    reply: (token, actionId) => replies.get(token)?.get(actionId) ?? null,
    history(token, limit, before) {
      return [...rounds.values()]
        .filter(
          (r) =>
            r.token === token && r.settledAt !== null && (before === null || r.roundId < before),
        )
        .sort((a, b) => (a.roundId < b.roundId ? 1 : -1))
        .slice(0, limit);
    },
    commit({ session, round, reply }) {
      sessions.set(session.token, session);
      if (round !== undefined) rounds.set(round.roundId, round);
      const mine = replies.get(session.token) ?? new Map<string, ReplyRow>();
      replies.set(session.token, mine);
      if (reply !== undefined) mine.set(reply.actionId, reply);
      const kept = keptRounds(session);
      for (const [actionId, stored] of mine) if (!kept.has(stored.roundId)) mine.delete(actionId);
    },
    ping() {},
    close() {},
  };
}
