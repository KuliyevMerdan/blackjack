import { z } from 'zod';
import { stake } from './primitives.js';

/**
 * `GameConfig.rules` (docs/protocol.md §2.2) — published, not negotiated. A field the engine plays
 * one way only is a literal here, so a config that asks for surrender or a no-peek table fails to
 * parse instead of being dealt by an engine that ignores it.
 */
export const rules = z.object({
  decks: z.int().min(1).max(8),
  dealerHitsSoft17: z.boolean(),
  blackjackPays: z.tuple([z.int().min(1), z.int().min(1)]),
  peek: z.literal(true),
  insurance: z.boolean(),
  doubleOn: z.literal('ANY_TWO'),
  doubleAfterSplit: z.boolean(),
  maxHands: z.int().min(1).max(4),
  splitBy: z.literal('VALUE'),
  resplitAces: z.boolean(),
  hitSplitAces: z.boolean(),
  surrender: z.literal(false),
  autoStandOn21: z.boolean(),
});
export type Rules = z.output<typeof rules>;

export const gameConfig = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, 'not an ISO 4217 code'),
    betUnit: stake,
    minBet: stake,
    maxBet: stake,
    rules,
  })
  .superRefine((config, ctx) => {
    // §1 invariant 4: every payout is exact because every stake is a multiple of an even unit.
    if (config.betUnit % 2 !== 0) {
      ctx.addIssue({ code: 'custom', path: ['betUnit'], message: 'betUnit must be even' });
    }
    for (const key of ['minBet', 'maxBet'] as const) {
      if (config[key] % config.betUnit !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be a multiple of betUnit`,
        });
      }
    }
    if (config.minBet > config.maxBet) {
      ctx.addIssue({ code: 'custom', path: ['minBet'], message: 'minBet is above maxBet' });
    }
  });
export type GameConfig = z.output<typeof gameConfig>;

/** The rules this project ships, as docs/protocol.md §2.2 reads them out. */
export const PUBLISHED_RULES: z.input<typeof rules> = {
  decks: 6,
  dealerHitsSoft17: false,
  blackjackPays: [3, 2],
  peek: true,
  insurance: true,
  doubleOn: 'ANY_TWO',
  doubleAfterSplit: true,
  maxHands: 4,
  splitBy: 'VALUE',
  resplitAces: false,
  hitSplitAces: false,
  surrender: false,
  autoStandOn21: true,
};
