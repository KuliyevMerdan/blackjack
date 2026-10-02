import { z } from 'zod';
import { measureCell, type Cell } from './cells.js';
import { simulate } from './run.js';
import type { Tally } from './tally.js';

/** The work a worker thread is handed — parsed on arrival, like any message across a boundary. */
export const task = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rounds'), seed: z.string(), from: z.int(), to: z.int() }),
  z.object({
    kind: z.literal('cell'),
    hand: z.tuple([z.string(), z.string()]),
    up: z.string(),
    trials: z.int(),
    seed: z.string(),
  }),
]);
export type Task = z.output<typeof task>;

export type Result = { kind: 'rounds'; tally: Tally } | { kind: 'cell'; cell: Cell };

export function perform(t: Task): Result {
  return t.kind === 'rounds'
    ? { kind: 'rounds', tally: simulate(t.seed, t.from, t.to) }
    : { kind: 'cell', cell: measureCell(t.hand, t.up, t.trials, t.seed) };
}
