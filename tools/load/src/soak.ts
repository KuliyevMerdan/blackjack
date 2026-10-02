import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inMemory } from '@blackjack/client-core';
import { audit, type Audit } from './audit.js';
import { Bot, type Timing } from './bot.js';
import { percentiles } from './stats.js';

/**
 * `pnpm load -- --sessions 200 --minutes 30` — ROADMAP P0's soak. A production-mode server on SQLite
 * with `BJ_FAULTS=on`; `sessions` players on basic strategy, `twins` of them with a second tab on the
 * same session; most sessions with faults injected into their own requests (latency, replies lost
 * after the move applied, `UNAVAILABLE` refusals, storms); and the server killed with `SIGKILL` every
 * `kill-every` minutes and started again on the same file. Then the audit (`audit.ts`) — and an exit
 * code of 1 if it found anything.
 */
export interface SoakOptions {
  readonly sessions: number;
  readonly twins: number;
  readonly minutes: number;
  /** The share of sessions with faults. */
  readonly faulted: number;
  readonly killEveryMinutes: number;
  readonly port: number;
  readonly think: readonly [number, number];
  readonly report: string | null;
}

const STARTING = 10_000_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

export async function soak(options: SoakOptions): Promise<{ audit: Audit; report: object }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'bj-soak-'));
  const base = `http://127.0.0.1:${options.port}`;
  const env = {
    ...process.env,
    BJ_ENV: 'production',
    BJ_DB: path.join(dir, 'table.db'),
    BJ_FAULTS: 'on',
    BJ_STARTING_BALANCE: String(STARTING),
    PORT: String(options.port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
  };
  const started = Date.now();
  const log = (line: string) => process.stderr.write(`[soak ${clock(started)}] ${line}\n`);
  let server = await start(env, base);

  // Players: one bot per session, two for the twins — the second opens the first's token.
  const timings: Timing[] = [];
  let seed = 20_261_002;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const sessions: { token: string; bots: Bot[]; faulted: boolean }[] = [];
  for (let i = 0; i < options.sessions; i += 1) {
    const storage = inMemory();
    const faulted = random() < options.faulted;
    const make = () => new Bot({ base, storage, random, faulted, timings, think: options.think });
    const first = make();
    await first.open();
    const bots = [first];
    if (i < options.twins) {
      const second = make();
      await second.open();
      first.twin = second;
      second.twin = first;
      bots.push(second);
    }
    sessions.push({ token: first.token, bots, faulted });
  }
  log(`${sessions.length} sessions open, ${options.twins} with two tabs`);
  const until = Date.now() + options.minutes * 60_000;

  // Faults — set, and set again after every restart (they live in the server's memory).
  const applyFaults = async () => {
    for (const s of sessions) {
      if (!s.faulted) continue;
      const bot = s.bots[0];
      await bot?.client.faults({
        latencyMs: Math.round(random() * 600),
        dropRate: 0.05 + random() * 0.1,
        unavailableRate: 0.03,
      });
    }
  };
  await applyFaults();
  const storms = setInterval(() => {
    for (const s of sessions.filter((x) => x.faulted)) {
      if (random() < 0.05) void s.bots[0]?.client.faults({ stormNext: 3 });
    }
  }, 20_000);

  // Kills — SIGKILL, not a clean stop: whatever was in flight is lost mid-request.
  let kills = 0;
  const killer = setInterval(() => {
    if (Date.now() > until - 30_000) return;
    kills += 1;
    log(`SIGKILL #${kills}`);
    server.kill('SIGKILL');
    setTimeout(
      () =>
        void start(env, base).then(async (next) => {
          server = next;
          await applyFaults();
          log('restarted');
        }),
      500 + random() * 1000,
    );
  }, options.killEveryMinutes * 60_000);
  const progress = setInterval(() => {
    const deals = sessions.reduce((n, s) => n + s.bots.reduce((m, b) => m + b.counts.deals, 0), 0);
    log(`${deals} hands dealt, ${timings.length} requests`);
  }, 60_000);

  await Promise.all(sessions.flatMap((s) => s.bots.map((b) => b.run(until))));
  clearInterval(killer);
  clearInterval(storms);
  clearInterval(progress);
  await until_(() => fetch(`${base}/ready`).then((r) => r.ok), 30_000);
  for (const s of sessions) {
    await s.bots[0]?.client.faults({
      latencyMs: 0,
      dropRate: 0,
      unavailableRate: 0,
      dropNext: 0,
      stormNext: 0,
    });
  }
  for (const s of sessions) for (const b of s.bots) await b.finish();
  log('played; auditing');

  const result = await audit(base, sessions, STARTING);
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });

  const counts: Record<string, number> = {};
  for (const bot of sessions.flatMap((s) => s.bots)) {
    for (const [k, v] of Object.entries(bot.counts)) counts[k] = (counts[k] ?? 0) + v;
  }
  const byPath = (faulted: boolean) => {
    const groups = new Map<string, number[]>();
    for (const t of timings) {
      if (t.faulted !== faulted || t.lost) continue;
      const g = groups.get(t.path) ?? [];
      g.push(t.ms);
      groups.set(t.path, g);
    }
    return Object.fromEntries([...groups].map(([p, ms]) => [p, percentiles(ms)]));
  };
  const report = {
    options: { ...options, report: undefined },
    minutes: (Date.now() - started) / 60_000,
    kills,
    requests: timings.length,
    lost: timings.filter((t) => t.lost).length,
    counts,
    latencyMs: { clean: byPath(false), faulted: byPath(true) },
    audit: result,
  };
  if (options.report !== null)
    writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  return { audit: result, report };
}

async function start(env: NodeJS.ProcessEnv, base: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [path.join(root, 'apps/server/dist/main.js')], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await until_(() => fetch(`${base}/ready`).then((r) => r.ok), 20_000);
  return child;
}

async function until_(check: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error('the server did not come up');
    await new Promise((r) => setTimeout(r, 50));
  }
}

function clock(started: number): string {
  const s = Math.round((Date.now() - started) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
