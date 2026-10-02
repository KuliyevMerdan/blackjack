import { availableParallelism } from 'node:os';
import { judge, PAIRS, UPCARDS, type Cell, type Verdict } from './cells.js';
import { UNIT } from './play.js';
import { runPool } from './pool.js';
import { chartReport, edgeReport, verdict } from './report.js';
import { emptyTally, merge } from './tally.js';
import type { Task } from './tasks.js';

/**
 * `pnpm sim -- --hands 10000000` — the realised house edge of basic strategy through the engine,
 * against the published figure. `pnpm sim -- --chart` — every pair cell of the chart measured.
 * Exits 1 when the result does not hold, so it can gate a change.
 */
const args = new Map<string, string>();
const argv = process.argv.slice(2).filter((a) => a !== '--');
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i] ?? '';
  if (!key.startsWith('--')) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(key.slice(2), 'true');
  else args.set(key.slice(2), ((i += 1), next));
}
const number = (key: string, fallback: number) => {
  const raw = args.get(key);
  const n = raw === undefined ? fallback : Number(raw.replaceAll('_', ''));
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${key} must be a positive integer`);
  return n;
};

const seed = args.get('seed') ?? 'blackjack-sim';
const threads = number('threads', availableParallelism());
const started = performance.now();

if (args.has('chart')) {
  const trials = number('trials', 20_000);
  const tasks: Task[] = PAIRS.flatMap((hand) =>
    UPCARDS.map((up): Task => ({
      kind: 'cell',
      hand: [hand[0], hand[1]],
      up,
      trials,
      seed,
    })),
  );
  const cells: Cell[] = [];
  await runPool(tasks, (r) => r.kind === 'cell' && void cells.push(r.cell), threads);
  const order = (c: Cell) =>
    PAIRS.findIndex((p) => p[0] === c.hand[0] && p[1] === c.hand[1]) * 10 + UPCARDS.indexOf(c.up);
  const judged = cells
    .sort((a, b) => order(a) - order(b))
    .map((c): [Cell, Verdict] => [c, judge(c)]);
  process.stdout.write(
    `${chartReport(judged)}\n${((performance.now() - started) / 1000).toFixed(1)} s, ${trials} trials a cell\n`,
  );
  process.exit(judged.every(([, v]) => v.ok) ? 0 : 1);
}

const hands = number('hands', 1_000_000);
const chunk = 25_000;
const tasks: Task[] = [];
for (let from = 0; from < hands; from += chunk) {
  tasks.push({ kind: 'rounds', seed, from, to: Math.min(hands, from + chunk) });
}
let tally = emptyTally();
let done = 0;
await runPool(
  tasks,
  (r) => {
    if (r.kind !== 'rounds') return;
    tally = merge(tally, r.tally);
    done += 1;
    if (process.stderr.isTTY)
      process.stderr.write(`\r${Math.round((100 * done) / tasks.length)} %`);
  },
  threads,
);
if (process.stderr.isTTY) process.stderr.write('\r');
process.stdout.write(`${edgeReport(tally, UNIT, (performance.now() - started) / 1000)}\n`);
process.exit(verdict(tally, UNIT).within3Sigma ? 0 : 1);
