import type { Card } from '@blackjack/cards';
import type { Minor } from '@blackjack/money';
import type { Action, ErrorCode, GameEvent, Hand, Round, Rules } from '@blackjack/protocol';

/**
 * Everything about a round that the server chose and the engine only carries: its identity and its
 * seeds. The engine never derives one from another — it does not import `fair` (`engine-deps`) —
 * it holds the server seed face down and puts it on the table in `roundSettled`.
 */
export interface Seeds {
  readonly roundId: string;
  readonly commit: string;
  readonly clientSeed: string;
  readonly serverSeed: string;
  /** A dev-only forced shoe (docs/protocol.md §9). Carried to the snapshot; never verifiable. */
  readonly forced: boolean;
}

/**
 * The whole round, face-down cards included — the server's to persist, never the wire's. `view()`
 * is the only way out of it to a client. Plain JSON, so it persists as it is.
 */
export interface State {
  readonly rules: Rules;
  readonly seeds: Seeds;
  readonly seq: number;
  readonly phase: Round['phase'];
  readonly stake: Minor;
  /** Every dealer card in the order dealt: the up card, the hole card, then the draws. */
  readonly dealer: readonly Card[];
  readonly holeHidden: boolean;
  readonly hands: readonly Hand[];
  readonly activeHand: number | null;
  readonly insurance: Round['insurance'];
  /** The next shoe position to deal from (docs/protocol.md §3.3); `shoe.slice(0, cursor)` is `dealt`. */
  readonly cursor: number;
  /**
   * The player's balance with this round applied so far: stakes debited as they are placed,
   * payouts credited as they settle. The server's wallet is this number after the step.
   */
  readonly balance: Minor;
  readonly totalPayout: Minor | null;
}

export interface Deal {
  readonly type: 'deal';
  readonly rules: Rules;
  readonly seeds: Seeds;
  readonly stake: Minor;
  /** The balance before the stake is taken. */
  readonly balance: Minor;
}

export interface Act {
  readonly type: 'act';
  readonly action: Action;
}

export type Command = Deal | Act;

/** The refusals that are the engine's to make. Bet limits, sessions and versions are the server's. */
export type Refusal = Extract<
  ErrorCode,
  'ROUND_OPEN' | 'NO_OPEN_ROUND' | 'INSUFFICIENT_FUNDS' | 'ACTION_NOT_ALLOWED'
>;

/** A step either happened — a new state and the events that made it — or it did not, and why. */
export type Step =
  | { readonly ok: true; readonly state: State; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly refusal: Refusal };
