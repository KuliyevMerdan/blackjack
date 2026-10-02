import { isCard, type Card } from '@blackjack/cards';
import { minor } from '@blackjack/money';
import { z } from 'zod';

/**
 * The value types every request, reply and event is built from (docs/protocol.md §2). Each one is
 * the single definition of what that kind of value may be on the wire.
 */

/** A card: two characters, rank then suit (§2.7). Parses into the `Card` type. */
export const card = z.custom<Card>(isCard, 'not a card');

/** A balance, a stake or a payout: minor units, never negative. Parses into the `Minor` brand. */
export const amount = z.int().min(0).transform(minor);

/** A stake that puts something on the table: at least one minor unit. */
export const stake = z.int().min(1).transform(minor);

/** A commit or a server seed: 64 lowercase hex characters, no prefix. */
export const hash = z.string().regex(/^[0-9a-f]{64}$/, 'not 64 lowercase hex characters');

/** The session's bearer token: 32 random bytes as hex. */
export const token = z.string().regex(/^[0-9a-f]{64}$/, 'not a session token');

/** A client seed: 1–64 printable ASCII characters (§3.1). */
export const clientSeed = z.string().regex(/^[\x20-\x7e]{1,64}$/, 'not 1–64 printable ASCII');

/** ULID: 26 characters of Crockford base32 — `roundId`. */
export const roundId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'not a ULID');

/** UUID, lowercase — `actionId`, one per intent (§7). */
export const actionId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'not a UUID');

/** A round's version: 0 after the deal, +1 per accepted action (§7). */
export const seq = z.int().min(0);

/** A hand, by its index in `round.hands`. At most `maxHands`, which is at most 4. */
export const handIndex = z.int().min(0).max(3);

/** Server epoch milliseconds. */
export const timestamp = z.int().min(0);

export const ACTIONS = ['hit', 'stand', 'double', 'split', 'insurance', 'noInsurance'] as const;
export const action = z.enum(ACTIONS);
export type Action = z.infer<typeof action>;
