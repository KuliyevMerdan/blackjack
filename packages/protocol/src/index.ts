/**
 * @blackjack/protocol — the wire contract in docs/protocol.md, as zod schemas and the types they
 * infer. Parsed at the boundary on both sides (CLAUDE.md § Other rules): the server does not trust
 * the client, and the client does not trust the server either.
 *
 * The document leads and this package follows — they change together, in one commit, always.
 */
export * from './primitives.js';
export * from './config.js';
export * from './round.js';
export * from './events.js';
export * from './errors.js';
export * from './api.js';
export * from './fold.js';
