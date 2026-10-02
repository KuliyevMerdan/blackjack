import { z } from 'zod';
import { gameConfig, rules } from './config.js';
import { gameEvent } from './events.js';
import {
  action,
  actionId,
  amount,
  card,
  clientSeed,
  hash,
  roundId,
  seq,
  stake,
  timestamp,
  token,
} from './primitives.js';
import { round } from './round.js';

/** The §2 endpoint table, as data — `tests/protocol-doc.test.ts` holds the document to it. */
export const ENDPOINTS = [
  { method: 'POST', path: '/api/session' },
  { method: 'POST', path: '/api/deal' },
  { method: 'POST', path: '/api/act' },
  { method: 'GET', path: '/api/round' },
  { method: 'GET', path: '/api/history' },
  { method: 'GET', path: '/fair/rounds/:roundId' },
  { method: 'POST', path: '/api/faults' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/ready' },
] as const;

// §2.1
export const sessionRequest = z.object({ token: token.optional() });
export const sessionReply = z.object({
  token,
  balance: amount,
  config: gameConfig,
  commit: hash,
  round: round.nullable(),
  /** §9: present, and `true`, when the server injects faults on request — the network lab may show. */
  lab: z.literal(true).optional(),
});

// §2.3
export const dealRequest = z.object({ actionId, stake, clientSeed, commit: hash });
/**
 * §9 — the deal a server in dev mode parses. A production server parses `dealRequest`, which does
 * not have the field, so `forceShoe` is dropped like any unknown field (invariant 9).
 */
export const devDealRequest = dealRequest.extend({ forceShoe: z.array(card).min(1).optional() });

// §2.4
export const actRequest = z.object({ actionId, roundId, seq, action });

// §2.7
export const actionReply = z.object({
  round,
  events: z.array(gameEvent).min(1),
  balance: amount,
  commit: hash,
});

// §2.5
export const roundReply = z.object({ round: round.nullable(), balance: amount, commit: hash });

// §2.6
export const historyQuery = z.object({
  limit: z.coerce.number().pipe(z.int().min(1).max(100)).default(30),
  before: roundId.optional(),
});
export const roundSummary = z.object({
  roundId,
  settledAt: timestamp,
  stake,
  totalStake: stake,
  totalPayout: amount,
  dealer: z.array(card).min(2),
  hands: z.array(z.array(card).min(2)).min(1).max(4),
});
export const historyReply = z.object({ rounds: z.array(roundSummary).max(100) });

// §9 — fault injection, per session, on a server started with BJ_FAULTS=on
export const faults = z.object({
  /** Held before every game request is handled. */
  latencyMs: z.int().min(0).max(10_000),
  /** The chance a deal's or act's reply is dropped — after the action was applied and stored. */
  dropRate: z.number().min(0).max(0.9),
  /** The chance a game request is answered `503 UNAVAILABLE`, unapplied. */
  unavailableRate: z.number().min(0).max(0.9),
  /** Drop the next N deal or act replies, whatever the rate. */
  dropNext: z.int().min(0).max(20),
  /** Answer the next N game requests `UNAVAILABLE` — a storm. */
  stormNext: z.int().min(0).max(50),
});
/** Fields given replace the session's; fields left out keep theirs. The reply is all of them. */
export const faultsRequest = faults.partial();
export const faultsReply = faults;

// §3.4
export const decision = z.object({ seq, action });
export const fairRecord = z.object({
  roundId,
  settledAt: timestamp,
  rules,
  commit: hash,
  serverSeed: hash,
  clientSeed,
  stake,
  decisions: z.array(decision),
  dealt: z.array(card).min(4),
  round,
});

export type SessionRequest = z.output<typeof sessionRequest>;
export type SessionReply = z.output<typeof sessionReply>;
export type DealRequest = z.output<typeof dealRequest>;
export type DevDealRequest = z.output<typeof devDealRequest>;
export type ActRequest = z.output<typeof actRequest>;
export type ActionReply = z.output<typeof actionReply>;
export type RoundReply = z.output<typeof roundReply>;
export type HistoryQuery = z.output<typeof historyQuery>;
export type RoundSummary = z.output<typeof roundSummary>;
export type HistoryReply = z.output<typeof historyReply>;
export type Decision = z.output<typeof decision>;
export type FairRecord = z.output<typeof fairRecord>;
export type Faults = z.output<typeof faults>;
export type FaultsRequest = z.output<typeof faultsRequest>;
