import { z } from 'zod';
import {
  action,
  amount,
  card,
  clientSeed,
  hash,
  roundId,
  seq,
  stake,
  type Action,
} from './primitives.js';

export const PHASES = ['INSURANCE', 'PLAYER', 'SETTLED'] as const;
export const phase = z.enum(PHASES);

export const HAND_STATES = ['PLAYING', 'STOOD', 'BUST', 'BLACKJACK', 'DONE'] as const;
export const OUTCOMES = ['WIN', 'LOSE', 'PUSH', 'BLACKJACK'] as const;
export const outcome = z.enum(OUTCOMES);

/** One of the player's hands (docs/protocol.md §2.7). One card only between a split and its draw. */
export const hand = z.object({
  cards: z.array(card).min(1),
  stake,
  doubled: z.boolean(),
  fromSplit: z.boolean(),
  state: z.enum(HAND_STATES),
  outcome: outcome.optional(),
  payout: amount.optional(),
});
export type Hand = z.output<typeof hand>;

/** The dealer as the client may see them: the hole card's existence, never its value (D10). */
export const dealer = z.object({
  cards: z.array(card).min(1),
  holeHidden: z.boolean(),
});

/** `null` until decided; a stake of 0 is a decline; `payout` once settled. */
export const insurance = z.object({ stake: amount, payout: amount.optional() }).nullable();

const INSURANCE_ACTIONS: ReadonlySet<Action> = new Set(['insurance', 'noInsurance']);
const PLAYER_ACTIONS: ReadonlySet<Action> = new Set(['hit', 'stand', 'double', 'split']);

/**
 * The round snapshot — the truth (ADR-0002). The refinements are protocol invariants checked at the
 * boundary, so a reply that breaks one is malformed rather than rendered:
 *
 * - **Face-down never travels** (§1, invariant 2): before `SETTLED` the dealer shows exactly one
 *   card and the hole is hidden, and there is no `serverSeed`. A snapshot that leaks either fails
 *   to parse on the client, which turns a server bug into a loud one.
 * - **Settled means settled**: the seed is revealed, every hand has its outcome and payout, nothing
 *   is allowed and nothing is active.
 * - **`allowed` belongs to its phase**: insurance decisions in `INSURANCE`, hand decisions in
 *   `PLAYER` — always including `stand` — and the active hand is one still `PLAYING`.
 */
export const round = z
  .object({
    roundId,
    seq,
    phase,
    stake,
    commit: hash,
    clientSeed,
    dealer,
    hands: z.array(hand).min(1).max(4),
    activeHand: z.int().min(0).max(3).nullable(),
    allowed: z.array(action),
    insurance,
    totalStake: stake,
    totalPayout: amount.optional(),
    serverSeed: hash.optional(),
    forced: z.literal(true).optional(),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });

    if (new Set(r.allowed).size !== r.allowed.length)
      issue('allowed repeats an action', ['allowed']);

    if (r.phase === 'SETTLED') {
      if (r.serverSeed === undefined)
        issue('a settled round reveals its server seed', ['serverSeed']);
      if (r.totalPayout === undefined)
        issue('a settled round carries totalPayout', ['totalPayout']);
      if (r.dealer.holeHidden) issue('a settled round shows the hole card', ['dealer']);
      if (r.dealer.cards.length < 2) issue('a settled dealer has at least two cards', ['dealer']);
      if (r.activeHand !== null) issue('nothing is active in a settled round', ['activeHand']);
      if (r.allowed.length > 0) issue('nothing is allowed in a settled round', ['allowed']);
      r.hands.forEach((h, i) => {
        if (h.outcome === undefined || h.payout === undefined) {
          issue('a settled hand has an outcome and a payout', ['hands', i]);
        }
      });
      if (r.insurance !== null && r.insurance.stake > 0 && r.insurance.payout === undefined) {
        issue('settled insurance has a payout', ['insurance']);
      }
      return;
    }

    // Open: nothing face-down, nothing revealed, nothing settled.
    if (r.serverSeed !== undefined)
      issue('the server seed travels only at settlement', ['serverSeed']);
    if (r.totalPayout !== undefined) issue('an open round has no totalPayout', ['totalPayout']);
    if (!r.dealer.holeHidden || r.dealer.cards.length !== 1) {
      issue('an open round shows the dealer up card and nothing else', ['dealer']);
    }
    r.hands.forEach((h, i) => {
      if (h.outcome !== undefined || h.payout !== undefined) {
        issue('an open hand has no outcome or payout', ['hands', i]);
      }
    });

    if (r.phase === 'INSURANCE') {
      if (r.activeHand !== null) issue('no hand is active during insurance', ['activeHand']);
      if (r.insurance !== null) issue('insurance is undecided during INSURANCE', ['insurance']);
      if (r.allowed.length === 0 || !r.allowed.every((a) => INSURANCE_ACTIONS.has(a))) {
        issue('INSURANCE allows insurance decisions only', ['allowed']);
      }
      return;
    }

    // PLAYER
    if (r.activeHand === null || r.activeHand >= r.hands.length) {
      issue('PLAYER has an active hand', ['activeHand']);
    } else if (r.hands[r.activeHand]?.state !== 'PLAYING') {
      issue('the active hand is PLAYING', ['activeHand']);
    }
    if (!r.allowed.includes('stand') || !r.allowed.every((a) => PLAYER_ACTIONS.has(a))) {
      issue('PLAYER allows hand decisions, stand among them', ['allowed']);
    }
  });
export type Round = z.output<typeof round>;
