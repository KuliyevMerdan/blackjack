import { z } from 'zod';
import { amount, card, handIndex, hash, stake } from './primitives.js';
import { outcome } from './round.js';

/**
 * The events in an `ActionReply` (docs/protocol.md §2.8) — the presentation's script and the
 * snapshot's proof (invariant 6). One schema per row of the §2.8 table.
 */
const event = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape });

export const roundStarted = event('roundStarted', { stake });
export const cardDealt = event('cardDealt', {
  to: z.union([z.literal('dealer'), handIndex]),
  card,
});
/**
 * The face-down card: no `card`, by name. A `holeDealt` that carries one is malformed, not merely
 * stripped — invariant 2 is the one leak with no recovery, so the client fails loudly on it.
 */
export const holeDealt = event('holeDealt', { card: z.never().optional() });
export const insuranceOffered = event('insuranceOffered', {});
export const insuranceDecided = event('insuranceDecided', { stake: amount });
export const dealerPeeked = event('dealerPeeked', { blackjack: z.boolean() });
export const handSplit = event('handSplit', { hand: handIndex, newHand: handIndex, stake });
export const handDoubled = event('handDoubled', { hand: handIndex, stake });
/** `auto: false` is the player's stand (`STOOD`); `true` a hand that stopped on its own (`DONE`). */
export const handStood = event('handStood', { hand: handIndex, auto: z.boolean() });
export const handBusted = event('handBusted', { hand: handIndex });
export const activeHandChanged = event('activeHandChanged', { hand: handIndex.nullable() });
export const holeRevealed = event('holeRevealed', { card });
export const handSettled = event('handSettled', { hand: handIndex, outcome, payout: amount });
export const insuranceSettled = event('insuranceSettled', { payout: amount });
export const roundSettled = event('roundSettled', { totalPayout: amount, serverSeed: hash });

export const gameEvent = z.discriminatedUnion('type', [
  roundStarted,
  cardDealt,
  holeDealt,
  insuranceOffered,
  insuranceDecided,
  dealerPeeked,
  handSplit,
  handDoubled,
  handStood,
  handBusted,
  activeHandChanged,
  holeRevealed,
  handSettled,
  insuranceSettled,
  roundSettled,
]);
export type GameEvent = z.output<typeof gameEvent>;
export type GameEventType = GameEvent['type'];

export const EVENT_TYPES: readonly GameEventType[] = gameEvent.options.map(
  (option) => option.shape.type.value,
);
