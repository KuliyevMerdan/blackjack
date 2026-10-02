// ROADMAP C1 "Done when", measured: `pnpm --filter @blackjack/web perf`.
//
// The server and the minified `--mode perf` build of the web app behind `vite preview`, in headless
// Chromium as a phone — 375×812, DPR 3, CPU throttled 4× — and:
//
//   1. boot: the card atlas' cost and the time to a usable Deal button;
//   2. frames: 15 rounds dealt, stood and settled at normal pace, every animation frame timed;
//   3. memory: 500 rounds, each skipped mid-flight — the heap after a forced GC, sprites and tweens;
//   4. skip: from a random point of each of 50 scripts, the skipped table against a fresh render of
//      the truth's picture, compared through `stage.describe()`.
//
// Needs Playwright's Chromium (PLAYWRIGHT_BROWSERS_PATH if it is not in the default place) and a
// built server (`pnpm build`).
import { chromium } from '@playwright/test';
import { startTable } from './harness.mjs';

const { url: PAGE, stop } = await startTable({ server: 8093, web: 5193 });

// Knobs for diagnosis: BJ_PERF_GPU=1 asks Chromium for the real GPU instead of SwiftShader;
// BJ_PERF_DPR and BJ_PERF_THROTTLE change the phone; BJ_PERF_FRAMES_ONLY=1 stops after step 2.
const env = process.env;
const gpuArgs = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
// The default headless shell has no GPU: WebGL falls back to SwiftShader, on the CPU. Full Chromium
// in the new headless mode (`channel: 'chromium'`) can use the machine's GPU, as a phone's browser does.
const browser = await chromium.launch({
  headless: true,
  ...(env.BJ_PERF_SHELL === '1' ? {} : { channel: 'chromium' }),
  args: env.BJ_PERF_GPU === '0' ? [] : gpuArgs,
});
const phone = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: Number(env.BJ_PERF_DPR ?? 3),
  isMobile: true,
  hasTouch: true,
});
const page = await phone.newPage();
const cdp = await phone.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(env.BJ_PERF_THROTTLE ?? 4) });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// ── 1. boot ──
const opened = Date.now();
await page.goto(PAGE);
await page.waitForFunction(() => document.querySelector('[data-deal]')?.disabled === false, null, {
  timeout: 30_000,
});
const bootMs = Date.now() - opened;
const atlasMs = await page.evaluate(() => window.__bj.atlasMs);

// ── 2. frames at normal pace ──
// Two clocks per frame. The interval between frames is the browser's to set — headless Chromium
// may run rAF at 120 Hz on one run and throttle it to 30 Hz on the next, idle or not — so it is
// recorded against the idle interval. The *work* is ours: a listener first on Pixi's ticker and one
// after its render (priorities 100 and −100), the main thread's cost of a frame, on a 4× slower CPU.
await page.evaluate(() => {
  const { app, stage } = window.__bj;
  const probe = { frames: [], work: [], long: [], last: 0, start: 0 };
  window.__probe = probe;
  // Main-thread tasks over 50 ms anywhere — a reply's parse and script included, not just the ticker.
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) probe.long.push(Math.round(entry.duration));
  }).observe({ type: 'longtask' });
  app.ticker.add(() => (probe.start = performance.now()), null, 100);
  app.ticker.add(
    () => {
      if (!stage.position.done) probe.work.push(performance.now() - probe.start);
    },
    null,
    -100,
  );
  const loop = (t) => {
    if (probe.last && !stage.position.done) probe.frames.push(t - probe.last);
    probe.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
if (env.BJ_PERF_PROFILE === '1') {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
for (let round = 0; round < 15; round += 1) {
  await page.evaluate(async () => {
    const { table, stage } = window.__bj;
    const settle = async () => {
      await new Promise((r) => setTimeout(r, 30));
      while (!stage.position.done) await new Promise((r) => setTimeout(r, 30));
      await new Promise((r) => setTimeout(r, 30));
    };
    await table.deal();
    await settle();
    for (let guard = 0; guard < 6; guard += 1) {
      const view = table.view();
      if (!view.round || view.round.phase === 'SETTLED') break;
      await table.act(view.actions.includes('noInsurance') ? 'noInsurance' : 'stand');
      await settle();
    }
  });
}
if (env.BJ_PERF_PROFILE === '1') {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const name = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
    self.set(name, (self.get(name) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.error(top.map(([n, ms]) => `${ms.toFixed(0).padStart(7)} ms  ${n}`).join('\n'));
}
const frames = await page.evaluate(() => window.__probe.frames);
const work = (await page.evaluate(() => window.__probe.work)).sort((a, b) => a - b);
const longTasks = await page.evaluate(() => window.__probe.long);
const wq = (p) => +work[Math.min(work.length - 1, Math.floor(p * work.length))].toFixed(2);
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c?.getExtension('WEBGL_debug_renderer_info');
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
// Idle: two seconds with nothing moving — what a frame costs when there is nothing to animate.
const idle = await page.evaluate(async () => {
  const deltas = [];
  let last = 0;
  await new Promise((done) => {
    const end = performance.now() + 2000;
    const loop = (t) => {
      if (last) deltas.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(loop);
      else done();
    };
    requestAnimationFrame(loop);
  });
  deltas.sort((a, b) => a - b);
  return { p50: deltas[Math.floor(deltas.length / 2)], frames: deltas.length };
});
if (env.BJ_PERF_FRAMES_ONLY === '1') {
  const sortedOnly = [...frames].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      gl,
      idle,
      p50: sortedOnly[Math.floor(sortedOnly.length / 2)],
      p95: sortedOnly[Math.floor(sortedOnly.length * 0.95)],
      over25ms: frames.filter((f) => f > 25).length,
      count: frames.length,
      work: {
        p50: wq(0.5),
        p99: wq(0.99),
        max: wq(1),
        over16_7: work.filter((w) => w > 16.7).length,
      },
    }),
  );
  await browser.close();
  stop();
  process.exit(0);
}
const sorted = [...frames].sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

// ── 3. memory over 500 rounds, every script skipped mid-flight ──
const heap = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 1e6;
};
const play = (n) =>
  page.evaluate(async (count) => {
    const { table } = window.__bj;
    const later = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < count; i += 1) {
      await table.deal();
      await new Promise((r) => setTimeout(r, 40));
      table.skip();
      await later();
      for (let guard = 0; guard < 6; guard += 1) {
        const view = table.view();
        if (!view.round || view.round.phase === 'SETTLED') break;
        await table.act(view.actions.includes('noInsurance') ? 'noInsurance' : 'stand');
        await new Promise((r) => setTimeout(r, 40));
        table.skip();
        await later();
      }
    }
  }, n);
await play(50);
const heapAt50 = await heap();
await play(450);
const heapAt500 = await heap();
const stats = await page.evaluate(() => {
  const count = (node) => 1 + (node.children ?? []).reduce((n, c) => n + count(c), 0);
  return { ...window.__bj.stage.stats(), displayObjects: count(window.__bj.app.stage) };
});

// ── 4. skip from anywhere lands on the truth's picture ──
const skips = await page.evaluate(async () => {
  const { table, stage, client, pictureOf } = window.__bj;
  const wrong = [];
  for (let i = 0; i < 50; i += 1) {
    const view = table.view();
    const open = view.round && view.round.phase !== 'SETTLED';
    const go = open
      ? table.act(view.actions.includes('noInsurance') ? 'noInsurance' : 'stand')
      : table.deal();
    await go;
    await new Promise((r) => setTimeout(r, Math.random() * 1500));
    table.skip();
    const skipped = JSON.stringify(stage.describe());
    stage.render(pictureOf(client.state.round));
    const snapped = JSON.stringify(stage.describe());
    if (skipped !== snapped) wrong.push({ i, skipped, snapped });
    await new Promise((r) => setTimeout(r, 0));
  }
  return wrong;
});

await browser.close();
stop();

const report = {
  gl,
  boot: { toDealMs: bootMs, atlasMs: Math.round(atlasMs) },
  idle,
  work: {
    frames: work.length,
    p50: wq(0.5),
    p95: wq(0.95),
    p99: wq(0.99),
    max: wq(1),
    over16_7ms: work.filter((w) => w > 16.7).length,
    longTasks,
  },
  frames: {
    count: frames.length,
    p50: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    max: +sorted.at(-1).toFixed(1),
    over25ms: frames.filter((f) => f > 25).length,
  },
  memory: { heapAt50: +heapAt50.toFixed(1), heapAt500: +heapAt500.toFixed(1), stage: stats },
  skip: { scripts: 50, mismatches: skips.length },
  errors,
};

// 60 fps is a budget: every frame's work under 16.7 ms on the throttled CPU, and the animation
// adding no dropped frames to what the browser does idle (none longer than twice its idle interval).
report.frames.overTwiceIdle = frames.filter((f) => f > 2 * idle.p50).length;
console.log(JSON.stringify(report, null, 2));
const ok =
  report.work.over16_7ms === 0 &&
  report.frames.overTwiceIdle === 0 &&
  heapAt500 - heapAt50 < 2 &&
  stats.tweens === 0 &&
  skips.length === 0 &&
  errors.length === 0;
process.exit(ok ? 0 : 1);
