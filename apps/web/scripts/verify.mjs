// ROADMAP C3 "Done when", measured: `pnpm --filter @blackjack/web verify`.
//
// A stranger — a fresh browser with nothing stored — opens the table, plays until a hand is lost,
// opens the history, follows that hand's Verify link, and the page in the new tab must arrive at
// "Verified" with all four checks holding, the round replayed card by card. Then:
//
//   - a second stranger opens the same link: still verified, but step 2 says this browser cannot
//     vouch for the seeds (it did not send them);
//   - the first stranger opens it again through a lying server — each of four lies rewritten into
//     the public record on its way to the page — and every one must come out "Not verified", at the
//     step that catches it.
//
// Needs Playwright's Chromium and a built server (`pnpm build`). A production-mode server: no
// forced shoes, so the hand is a real shuffle.
import { chromium } from '@playwright/test';
import { startTable } from './harness.mjs';

const { url, stop } = await startTable({ server: 8095, web: 5195 });
const browser = await chromium.launch({ headless: true });
const phone = {
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const errors = [];
const watch = (page) => page.on('pageerror', (e) => errors.push(e.message));

// ── a stranger loses a hand ──
const stranger = await browser.newContext(phone);
const table = await stranger.newPage();
watch(table);
await table.goto(`${url}?turbo`);
let lost = null;
for (let hand = 0; hand < 40 && lost === null; hand += 1) {
  await table.waitForFunction(() => !document.querySelector('[data-deal]').disabled, null, {
    timeout: 30_000,
  });
  await table.click('[data-deal]');
  for (;;) {
    const next = await table
      .waitForFunction(
        () => {
          const lit = [...document.querySelectorAll('[data-action]')].filter(
            (b) => !b.hidden && !b.disabled,
          );
          if (lit.length > 0) return lit.map((b) => b.dataset.action);
          return document.querySelector('[data-deal]').disabled ? null : 'settled';
        },
        null,
        { timeout: 30_000, polling: 'raf' },
      )
      .then((h) => h.jsonValue());
    if (next === 'settled') break;
    await table.click(
      `[data-action="${next.includes('noInsurance') ? 'noInsurance' : next.includes('hit') && hand % 2 ? 'hit' : 'stand'}"]`,
    );
  }
  const round = await table.evaluate(() => window.__bj.client.state.round);
  if ((round.totalPayout ?? 0) === 0) lost = round.roundId;
}
if (lost === null) throw new Error('forty hands and none lost');

await table.click('[data-open="history"]');
const link = table.locator(`[data-history-list] a[href="#/verify/${lost}"]`);
await link.waitFor({ timeout: 10_000 });
const [verifyTab] = await Promise.all([stranger.waitForEvent('page'), link.click()]);
watch(verifyTab);

const read = async (page) => {
  await page.waitForSelector('.verdict', { timeout: 30_000 });
  return page.evaluate(() => ({
    verdict: document.querySelector('.verdict').className.replace('verdict ', ''),
    steps: [...document.querySelectorAll('.step')].map((s) => s.className.replace('step ', '')),
    replayed: document.querySelectorAll('.replay li').length,
    shuffled: document.querySelector('.step:nth-child(3) .detail')?.textContent ?? '',
  }));
};
const own = await read(verifyTab);

// ── a second stranger, the same link ──
const other = await browser.newContext(phone);
const otherTab = await other.newPage();
watch(otherTab);
await otherTab.goto(`${url}#/verify/${lost}`);
const theirs = await read(otherTab);

// ── the first stranger again, through a lying server ──
const LIES = {
  'a server seed that is not the committed one': (r) => ({ ...r, serverSeed: 'ab'.repeat(32) }),
  'a swapped card': (r) => {
    const dealt = [...r.dealt];
    [dealt[0], dealt[1]] = [dealt[1], dealt[0]];
    return { ...r, dealt };
  },
  'a changed decision': (r) => ({ ...r, decisions: r.decisions.slice(0, -1) }),
  'another client seed than the one sent': (r) => ({ ...r, clientSeed: `${r.clientSeed}x` }),
};
const lies = {};
for (const [lie, rewrite] of Object.entries(LIES)) {
  const page = await stranger.newPage();
  watch(page);
  await page.route('**/fair/rounds/**', async (route) => {
    const response = await route.fetch();
    const record = await response.json();
    await route.fulfill({ response, json: rewrite(record) });
  });
  await page.goto(`${url}#/verify/${lost}`);
  lies[lie] = await read(page);
  await page.close();
}

await browser.close();
stop();

const report = { lost, own, stranger: theirs, lies, errors };
console.log(JSON.stringify(report, null, 2));
const all = (r, s) => r.steps.length === 4 && r.steps.every((x, i) => x === s[i]);
const failures = [
  !(own.verdict === 'verified' && all(own, ['pass', 'pass', 'pass', 'pass'])) &&
    'the player’s own link did not verify',
  own.replayed < 6 && 'the round was not replayed card by card',
  !(theirs.verdict === 'verified' && all(theirs, ['pass', 'unknown', 'pass', 'pass'])) &&
    'a stranger’s link did not verify',
  ...Object.entries(lies)
    .filter(([, r]) => r.verdict !== 'failed')
    .map(([lie]) => `the lie “${lie}” was not caught`),
  errors.length > 0 && 'a page threw',
].filter(Boolean);
if (failures.length > 0) {
  console.error(`C3 done-when NOT met:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('C3 done-when met.');
process.exit(0);
