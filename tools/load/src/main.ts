import { soak } from './soak.js';

/**
 * `pnpm load -- --sessions 200 --minutes 30` (ROADMAP P0). Knobs: `--twins` (sessions with a second
 * tab), `--faulted` (share of sessions with faults, 0–1), `--kill-every` (minutes between SIGKILLs),
 * `--think` (ms, `low-high`), `--port`, `--report <file>`. Exits 1 if the audit finds anything.
 */
const args = new Map<string, string>();
const argv = process.argv.slice(2).filter((a) => a !== '--');
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i] ?? '';
  const next = argv[i + 1];
  if (key.startsWith('--') && next !== undefined && !next.startsWith('--')) {
    args.set(key.slice(2), next);
    i += 1;
  }
}
const num = (key: string, fallback: number) => {
  const n = Number(args.get(key) ?? fallback);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${key} must be a number ≥ 0`);
  return n;
};
const [low, high] = (args.get('think') ?? '400-1500').split('-').map(Number);

const { audit, report } = await soak({
  sessions: num('sessions', 200),
  twins: num('twins', 20),
  minutes: num('minutes', 30),
  faulted: num('faulted', 0.6),
  killEveryMinutes: num('kill-every', 5),
  port: num('port', 8096),
  think: [low ?? 400, high ?? 1500],
  report: args.get('report') ?? null,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (audit.findings.length > 0) {
  process.stderr.write(`P0 soak: ${audit.findings.length} finding(s)\n`);
  process.exit(1);
}
process.stderr.write(
  `P0 soak: ${audit.sessions} sessions, ${audit.rounds} rounds, ${audit.decisions} decisions — nothing created, destroyed, dealt twice or shown that the server does not have.\n`,
);
process.exit(0);
