/**
 * @blackjack/sim — basic strategy played through the engine, many millions of times, against the
 * published house edge for these rules; and every pair cell of the chart measured on common shoes.
 *
 * `main.ts` is the CLI (`pnpm sim`); the rest is importable so a test can pin a small run.
 */
export { simulate } from './run.js';
export { playRound, playOut, dealFrom, shoeFor, netOf, RULES, UNIT } from './play.js';
export { emptyTally, add, merge, edge, type Tally } from './tally.js';
export { measureCell, judge, stack, PAIRS, UPCARDS, type Cell, type Verdict } from './cells.js';
export { PUBLISHED } from './published.js';
export { verdict, edgeReport, chartReport } from './report.js';
