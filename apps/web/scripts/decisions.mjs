// ROADMAP C2 "Done when", measured: `pnpm --filter @blackjack/web decisions`.
//
// Thirty hands in Chromium as a phone, every request held 300 ms by the browser's own network
// throttling — a split, a double and insurance offers among them, forced through the server's dev
// shoe — and, on every animation frame of all thirty:
//
//   - no card on the felt that no reply has dealt yet (every card shown is in the truth the client
//     holds now, or the one it held before — the screen may lag the truth, never lead it);
//   - no lit button the truth would refuse: an action outside `allowed`, or anything while a request
//     is out or the script is still playing; Deal only between rounds;
//
// and over the run: every decision pressed twice — a double click, or the key struck twice — and
// exactly one request per decision reaching the server, with no refusal and no conflict back.
//
// Needs Playwright's Chromium and a built server (`pnpm build`).
import { chromium } from '@playwright/test';
import { recommend } from '@blackjack/strategy';
import { startTable } from './harness.mjs';
import { seen as monitored, watch } from './monitor.mjs';

const HANDS = Number(process.env.BJ_HANDS ?? 30); // fewer for a quick look; the done-when is 30
const LATENCY = 300;
const { url, stop } = await startTable({ server: 8094, web: 5194, env: { BJ_DEV: 'on' } });

/**
 * Stacked tops for the hands the run must contain (§9 `forceShoe`, dev only); every other hand is
 * a real shuffle. Dealing order: player, dealer up, player, hole, then draws (§3.3).
 */
const FORCED = new Map([
  // 8-8 against a 6: split, and split again — three hands, one doubled after the split.
  [1, ['8S', '6H', '8D', 'TC', '8H', '3D', '8C', '2S', '9D', 'TH', 'TS', '7C', 'KD']],
  // 6-5 against a 6: eleven, a double.
  [2, ['6S', '6H', '5D', 'TC', 'TD', '9C']],
  // 9-7 against an ace, no blackjack underneath: insurance offered, taken, lost.
  [3, ['9S', 'AH', '7D', '8C', 'TD', '5C']],
  // 10-9 against an ace with a king underneath: insurance offered, declined; the peek says so.
  [4, ['TS', 'AC', '9D', 'KC']],
]);

const browser = await chromium.launch({ headless: true });
const phone = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await phone.newPage();
const cdp = await phone.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: LATENCY,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// The wire, as the server sees it: every game request, every answer's status, every round trip.
let hand = 0;
const wire = { acts: 0, deals: 0, statuses: {}, trips: [] };
const sentAt = new Map();
page.on('request', (r) => {
  if (r.method() !== 'POST') return;
  if (r.url().endsWith('/api/act')) wire.acts += 1;
  if (r.url().endsWith('/api/deal')) wire.deals += 1;
  sentAt.set(r, Date.now());
});
page.on('response', (r) => {
  const request = r.request();
  if (request.method() !== 'POST' || !/\/api\/(act|deal)$/.test(r.url())) return;
  wire.statuses[r.status()] = (wire.statuses[r.status()] ?? 0) + 1;
  wire.trips.push(Date.now() - (sentAt.get(request) ?? Date.now()));
});
await page.route('**/api/deal', async (route) => {
  const top = FORCED.get(hand);
  if (top === undefined) return route.continue();
  const body = JSON.parse(route.request().postData() ?? '{}');
  return route.continue({ postData: JSON.stringify({ ...body, forceShoe: top }) });
});

await page.goto(url);
await page.waitForFunction(
  () => window.__bj && !document.querySelector('[data-deal]').disabled,
  null,
  {
    timeout: 30_000,
  },
);

await watch(page);

/** Waits until the screen offers something: a decision, or the next Deal. */
const offered = () =>
  page
    .waitForFunction(
      () => {
        const lit = [...document.querySelectorAll('[data-action]')].filter(
          (b) => !b.hidden && !b.disabled,
        );
        if (lit.length > 0) return { kind: 'decide', actions: lit.map((b) => b.dataset.action) };
        if (!document.querySelector('[data-deal]').disabled) return { kind: 'deal' };
        return null;
      },
      null,
      { timeout: 30_000, polling: 'raf' },
    )
    .then((h) => h.jsonValue());

const KEYS = { hit: 'h', stand: 's', double: 'd', split: 'p', insurance: 'i', noInsurance: 'n' };
const seen = {
  splits: 0,
  doubles: 0,
  offers: 0,
  insured: 0,
  results: 0,
  callouts: [],
  missing: [],
  most: 0,
};
let decisions = 0;
let taps = 0;

for (hand = 0; hand < HANDS; hand += 1) {
  const ready = await offered();
  if (ready.kind !== 'deal') throw new Error(`hand ${hand}: expected Deal, got ${ready.kind}`);
  await page.locator('[data-deal]').dblclick();
  // The last result goes at the press — not when the next one plays.
  const lingering = await page.evaluate(
    () => document.querySelector('[data-line]').dataset.kind === 'result',
  );
  if (lingering) throw new Error(`hand ${hand}: the last result outlived the Deal press`);
  // Until the screen offers the next Deal — never a fixed number of decisions: a hand split to
  // four can take a dozen, and a loop that stopped at its last press would read the result before
  // the reply had played.
  for (let guard = 0; ; guard += 1) {
    if (guard > 40) throw new Error(`hand ${hand}: forty decisions and the round is still open`);
    const next = await offered();
    if (next.kind === 'deal') break;
    seen.most = Math.max(seen.most, guard + 1);
    // What the last reply said over the bar, now that it has played (the peek, insurance).
    const said = await page.evaluate(() => document.querySelector('[data-line]').textContent);
    if (said) seen.callouts.push(said);
    const round = await page.evaluate(() => window.__bj.client.state.round);
    const active = round.hands[round.activeHand ?? 0];
    let action;
    if (next.actions.includes('insurance')) {
      seen.offers += 1;
      action = hand === 3 ? 'insurance' : 'noInsurance';
    } else if (next.actions.includes('split')) action = 'split';
    else if (next.actions.includes('double') && (hand === 2 || hand === 1)) action = 'double';
    else action = recommend(active.cards, round.dealer.cards[0], next.actions);
    if (!next.actions.includes(action))
      action = next.actions.includes('stand') ? 'stand' : next.actions[0];
    if (action === 'split') seen.splits += 1;
    if (action === 'double') seen.doubles += 1;
    if (action === 'insurance') seen.insured += 1;
    decisions += 1;
    // Every decision pressed twice: a double click, or its key struck twice.
    if (decisions % 2 === 0) {
      await page.locator(`[data-action="${action}"]`).dblclick();
    } else {
      await page.keyboard.press(KEYS[action]);
      await page.keyboard.press(KEYS[action]);
    }
    taps += 2;
  }
  const result = await page.evaluate(() => {
    const line = document.querySelector('[data-line]');
    const view = window.__bj.table.view();
    return {
      said: line.dataset.kind === 'result' ? line.textContent : null,
      line: line.textContent,
      kind: line.dataset.kind,
      phase: view.round?.phase ?? null,
      summary: view.summary,
      gate: view.gateOpen,
      busy: view.busy,
      played: window.__bj.stage.position,
    };
  });
  if (result.said === null) seen.missing.push({ hand, ...result });
  if (result.said !== null) seen.results += 1;
}

const mon = await monitored(page);
await browser.close();
stop();

const trips = [...wire.trips].sort((a, b) => a - b);
const report = {
  hands: HANDS,
  latencyMs: LATENCY,
  roundTripMs: { min: trips[0], median: trips[Math.floor(trips.length / 2)] },
  framesWatched: mon.frames,
  decisions,
  taps,
  wire: { deals: wire.deals, acts: wire.acts, statuses: wire.statuses },
  seen: {
    splits: seen.splits,
    doubles: seen.doubles,
    insuranceOffers: seen.offers,
    insured: seen.insured,
    results: seen.results,
    missing: seen.missing,
    mostDecisionsInAHand: seen.most,
    peekSaid: [...new Set(seen.callouts.filter((c) => /blackjack|Insurance/.test(c)))],
  },
  violations: mon.violations,
  errors,
};
console.log(JSON.stringify(report, null, 2));

const failures = [
  mon.violations.length > 0 &&
    'a card ran ahead of its reply, or a button lit that the truth refuses',
  wire.deals !== HANDS && `${wire.deals} deals reached the server for ${HANDS} hands`,
  wire.acts !== decisions && `${wire.acts} actions reached the server for ${decisions} decisions`,
  Object.keys(wire.statuses).some((s) => s !== '200') && 'a request was refused or conflicted',
  (trips[0] ?? 0) < LATENCY && 'the link was not throttled',
  seen.splits < 1 && 'no split',
  seen.doubles < 1 && 'no double',
  seen.offers < 1 && 'no insurance offer',
  !seen.callouts.some((c) => /no blackjack/.test(c)) &&
    'the peek was never said when it found nothing',
  seen.results !== HANDS && `${seen.results} result moments for ${HANDS} hands`,
  errors.length > 0 && 'the page threw',
].filter(Boolean);
if (failures.length > 0) {
  console.error(`C2 done-when NOT met:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('C2 done-when met.');
process.exit(0);
