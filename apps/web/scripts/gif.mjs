// The README's GIF: `pnpm --filter @blackjack/web gif` → docs/media/table.gif.
//
// A forced pair (a development server), played at the table's own pace in Chromium: three splits
// into four hands, a double, three stands, the dealer busting, every hand paid — recorded by
// Playwright and turned into a GIF by ffmpeg (needs `ffmpeg` on the PATH). The shoe is the E2E
// suite's (e2e/forced.spec.ts), added to the deal request on its way out.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { root, startTable } from './harness.mjs';

const SHOE = ['8H', '6S', '8C', 'TD', '8D', '8S', '3H', 'TC', 'TS', '9H', '7C', '9D'];
const SIZE = { width: 900, height: 560 };
const out = path.join(root, 'docs/media/table.gif');

const { url, stop } = await startTable({
  server: 8097,
  web: 5197,
  env: { BJ_DEV: 'on', BJ_FAULTS: 'on', BJ_STARTING_BALANCE: '100000' },
});
const dir = mkdtempSync(path.join(tmpdir(), 'bj-gif-'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  locale: 'en-US',
  recordVideo: { dir, size: SIZE },
});
const page = await context.newPage();
await page.route('**/api/deal', async (route) => {
  const body = route.request().postDataJSON();
  await route.continue({ postData: JSON.stringify({ ...body, forceShoe: SHOE }) });
});
const started = Date.now();
await page.goto(url);
const deal = page.locator('[data-deal]');
await deal.waitFor();
await page.waitForFunction(() => !document.querySelector('[data-deal]').disabled);
const ready = Date.now() - started;
await page.waitForTimeout(700);

const press = async (action) => {
  const button = page.locator(`[data-action="${action}"]`);
  await page.waitForFunction(
    (a) => {
      const b = document.querySelector(`[data-action="${a}"]`);
      return b !== null && !b.hidden && !b.disabled;
    },
    action,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(450); // a beat to read the table, as a player would
  await button.click();
};
await deal.click();
for (const action of ['split', 'split', 'split', 'double', 'stand', 'stand', 'stand']) {
  await press(action);
}
await page.waitForFunction(
  () => document.querySelector('[data-line]')?.dataset.kind === 'result',
  null,
  { timeout: 30_000 },
);
await page.waitForTimeout(2500);
await context.close();
await browser.close();
stop();

const [video] = readdirSync(dir).filter((f) => f.endsWith('.webm'));
if (video === undefined) throw new Error('no video was recorded');
mkdirSync(path.dirname(out), { recursive: true });
const start = (ready / 1000).toFixed(2);
const filters = `fps=15,scale=${SIZE.width * 0.8}:-1:flags=lanczos`;
const ffmpeg = (args) => {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`ffmpeg exited ${run.status}`);
};
const palette = path.join(dir, 'palette.png');
const source = path.join(dir, video);
ffmpeg(['-ss', start, '-i', source, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
ffmpeg([
  '-ss',
  start,
  '-i',
  source,
  '-i',
  palette,
  '-lavfi',
  `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  out,
]);
rmSync(dir, { recursive: true, force: true });
console.log(`${path.relative(root, out)}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
process.exit(0);
