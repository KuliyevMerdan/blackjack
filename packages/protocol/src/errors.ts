import { z } from 'zod';
import { amount, hash } from './primitives.js';
import { round } from './round.js';

/**
 * The four-class taxonomy (docs/protocol.md §6). **The class is a function of the code**: this table
 * is the one place that says which, and an error whose class disagrees with its code fails to
 * parse. The client branches on the class, never on a message string.
 */
export const ERROR_CODES = {
  PLAYER: [
    'INSUFFICIENT_FUNDS',
    'BET_OUT_OF_RANGE',
    'BET_NOT_A_UNIT_MULTIPLE',
    'ACTION_NOT_ALLOWED',
    'MALFORMED',
    'UNKNOWN_ROUND',
  ],
  SESSION: ['UNKNOWN_SESSION'],
  CONFLICT: ['STALE_SEQ', 'ROUND_OPEN', 'NO_OPEN_ROUND', 'COMMIT_MISMATCH', 'ACTION_ID_REUSED'],
  SYSTEM: ['INTERNAL', 'UNAVAILABLE'],
} as const;

export type ErrorClass = keyof typeof ERROR_CODES;
export type ErrorCode = (typeof ERROR_CODES)[ErrorClass][number];

export const ERROR_CLASSES = ['PLAYER', 'SESSION', 'CONFLICT', 'SYSTEM'] as const;

const CLASS_OF = new Map<string, ErrorClass>(
  ERROR_CLASSES.flatMap((cls) => ERROR_CODES[cls].map((code) => [code, cls] as const)),
);

export function classOf(code: ErrorCode): ErrorClass {
  const cls = CLASS_OF.get(code);
  if (cls === undefined) throw new RangeError(`unknown error code ${code}`);
  return cls;
}

/** The HTTP status each code travels with (§6). */
export function httpStatus(code: ErrorCode): number {
  switch (code) {
    case 'MALFORMED':
      return 400;
    case 'UNKNOWN_ROUND':
      return 404;
    case 'UNKNOWN_SESSION':
      return 401;
    case 'INTERNAL':
      return 500;
    case 'UNAVAILABLE':
      return 503;
    default:
      return classOf(code) === 'CONFLICT' ? 409 : 422;
  }
}

const ALL_CODES = ERROR_CLASSES.flatMap((cls) => ERROR_CODES[cls]);

/**
 * `{ error, round?, balance?, commit? }`. Every `CONFLICT` carries the state that resolves it
 * (§6): a round, or — for `COMMIT_MISMATCH` — the current commit.
 */
export const errorReply = z
  .object({
    error: z.object({
      class: z.enum(ERROR_CLASSES),
      code: z.enum(ALL_CODES),
      message: z.string(),
    }),
    round: round.nullable().optional(),
    balance: amount.optional(),
    commit: hash.optional(),
  })
  .superRefine((reply, ctx) => {
    const { class: cls, code } = reply.error;
    if (CLASS_OF.get(code) !== cls) {
      ctx.addIssue({ code: 'custom', path: ['error', 'class'], message: `${code} is not ${cls}` });
    }
    if (code === 'COMMIT_MISMATCH' && reply.commit === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['commit'],
        message: 'COMMIT_MISMATCH carries the commit',
      });
    } else if (cls === 'CONFLICT' && code !== 'COMMIT_MISMATCH' && reply.round === undefined) {
      ctx.addIssue({ code: 'custom', path: ['round'], message: `${code} carries the round` });
    }
  });
export type ErrorReply = z.output<typeof errorReply>;
