// ROADMAP P0, the browser's half: `pnpm --filter @blackjack/web hardening`.
//
// A development server (forced shoes) with faults on and a SQLite file, and Chromium as a phone:
//
//   A. two tabs on one session, both playing at once — every action lands once or is answered
//      with CONFLICT, nothing is refused, and both tabs end on the server's round;
//   B. a reply that lands in a hidden tab — drawn as it stands, not queued as a script;
//   C. a reload in the middle of a split — the round comes back as it stands, no replay;
//   D. a slow link (3 s, set from the network lab) during the dealer's play, and a reply lost after
//      the move applied (also from the lab) — one card, not two;
//   E. the server SIGKILLed with a hand open and the page still on it, started again — the press
//      made while it was down lands once when it is back.
//
// The frame monitor (monitor.mjs) watches every page throughout: no card ahead of its reply, no
// lit button the truth refuses. Needs Playwright's Chromium and a built server (`pnpm build`).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { startTable } from './harness.mjs';
import { seen, watch } from './monitor.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'bj-hardening-'));
const table = await startTable({
  server: 8099,
  web: 5199,
  env: { BJ_DEV: 'on', BJ_FAULTS: 'on', BJ_DB: path.join(dir, 'table.db') },
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const errors = [];
const wire = { acts: 0, refused: 0, conflicts: 0 };
const lastActs = [];
context.on('response', async (r) => {
  if (r.request().method() !== 'POST' || !/\/api\/(act|deal)$/.test(r.url())) return;
  if (r.url().endsWith('/api/act')) {
    const body = await r.text().catch(() => '');
    lastActs.push({ sent: r.request().postData(), status: r.status(), body: body.slice(0, 160) });
    if (lastActs.length > 6) lastActs.shift();
  }
  if (r.url().endsWith('/api/act') && r.status() === 200) wire.acts += 1;
  if (r.status() === 422 || r.status() === 400) wire.refused += 1;
  if (r.status() === 409) wire.conflicts += 1;
});
const pages = [];
const open = async (query = '?turbo') => {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${table.url}${query}`);
  await page.waitForFunction(() => window.__bj && window.__bj.client.state !== null, null, {
    timeout: 30_000,
  });
  await watch(page);
  pages.push(page);
  return page;
};

/** The script has played and no request is out. */
const idle = (page) =>
  page.waitForFunction(() => window.__bj.stage.position.done && !window.__bj.client.busy, null, {
    timeout: 30_000,
    polling: 100,
  });
/** The stage shows exactly the truth's picture — compared, then redrawn to check it changed nothing. */
const onTruth = (page) =>
  page.evaluate(() => {
    const { stage, client, pictureOf } = window.__bj;
    const before = JSON.stringify(stage.describe());
    stage.render(pictureOf(client.state.round));
    return before === JSON.stringify(stage.describe());
  });
const versionOf = (page) =>
  page.evaluate(() => {
    const t = window.__bj.client.state;
    const r = t.round;
    const open = r !== null && r.phase !== 'SETTLED' ? `${r.roundId}:${r.seq}` : '-';
    return `${open}:${t.balance}:${t.commit}`;
  });
const serverVersion = (page) =>
  page.evaluate(async () => {
    const token = window.__bj.client.state.token;
    const res = await fetch('/api/round', { headers: { authorization: `Bearer ${token}` } });
    const t = await res.json();
    const r = t.round;
    const open = r !== null && r.phase !== 'SETTLED' ? `${r.roundId}:${r.seq}` : '-';
    return `${open}:${t.balance}:${t.commit}`;
  });
/** The next deal from `page` is dealt from `cards` on top of the shoe (§9, dev only). */
const stack = (page, cards) =>
  page.route(
    '**/api/deal',
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      await route.continue({ postData: JSON.stringify({ ...body, forceShoe: cards }) });
    },
    { times: 1 },
  );
const lit = (page) =>
  page.evaluate(() => ({
    deal: !document.querySelector('[data-deal]').disabled,
    actions: [...document.querySelectorAll('[data-action]')]
      .filter((b) => !b.hidden && !b.disabled)
      .map((b) => b.dataset.action),
  }));
/** Deals until a hand is open — a natural can settle a round in its deal. */
const dealOpen = async (page) => {
  for (let i = 0; i < 6; i += 1) {
    await idle(page);
    await page.waitForFunction(() => !document.querySelector('[data-deal]').disabled, null, {
      timeout: 10_000,
    });
    await page.click('[data-deal]');
    await page.waitForFunction(
      () => window.__bj.client.state.round !== null && !window.__bj.client.busy,
      null,
      { timeout: 15_000 },
    );
    await idle(page);
    const phase = await page.evaluate(() => window.__bj.client.state.round.phase);
    if (phase !== 'SETTLED') return;
  }
  throw new Error('six deals and none left a hand open');
};
/** Finishes the hand on screen by standing (or declining insurance). */
const finish = async (page) => {
  for (let i = 0; i < 12; i += 1) {
    await idle(page);
    const now = await lit(page);
    if (now.deal) return;
    const pick = now.actions.includes('noInsurance') ? 'noInsurance' : 'stand';
    if (now.actions.includes(pick)) await page.click(`[data-action="${pick}"]`);
    else await page.waitForTimeout(150);
  }
  const state = await page.evaluate(() => {
    const v = window.__bj.table.view();
    return {
      phase: v.round?.phase,
      allowed: v.round?.allowed,
      actions: v.actions,
      gate: v.gateOpen,
      busy: v.busy,
      message: v.message,
      status: v.status,
    };
  });
  const dom = await lit(page);
  throw new Error(
    `could not finish the hand: ${JSON.stringify({ state, dom, mine: await versionOf(page), server: await serverVersion(page), lastActs })}`,
  );
};
const report = {};

// ── A. two tabs, both playing ──
{
  const a = await open();
  const b = await open();
  const historyBefore = await a.evaluate(
    async () => (await window.__bj.client.history(100)).value.length,
  );
  const actsBefore = wire.acts;
  let seed = 11;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
  const play = async (page, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const now = await lit(page);
      if (now.deal) await page.click('[data-deal]', { timeout: 1500 }).catch(() => {});
      else if (now.actions.length > 0) {
        const pick = now.actions[Math.floor(random() * now.actions.length)];
        await page.click(`[data-action="${pick}"]`, { timeout: 1500 }).catch(() => {});
      }
      await page.waitForTimeout(100 + random() * 500);
    }
  };
  await Promise.all([play(a, 40_000), play(b, 40_000)]);
  await finish(a);
  await a.waitForTimeout(1500); // the other tab hears, and resyncs
  await idle(a);
  await idle(b);
  // Every accepted action is a decision the server recorded: sum the rounds played meanwhile.
  const recorded = await a.evaluate(async (since) => {
    const { client } = window.__bj;
    const rounds = (await client.history(100)).value;
    const fresh = rounds.slice(0, rounds.length - since);
    let decisions = 0;
    for (const r of fresh) decisions += (await client.fairRecord(r.roundId)).value.decisions.length;
    const open = client.state.round;
    if (open !== null && open.phase !== 'SETTLED') decisions += open.seq;
    return { rounds: fresh.length, decisions };
  }, historyBefore);
  const [va, vb, server] = [await versionOf(a), await versionOf(b), await serverVersion(a)];
  report.twoTabs = {
    rounds: recorded.rounds,
    accepted: wire.acts - actsBefore,
    recorded: recorded.decisions,
    conflicts: wire.conflicts,
    sameRound: va === vb && vb === server,
    onTruth: (await onTruth(a)) && (await onTruth(b)),
  };
  await b.close();
}
const page = pages[0];

// ── B. a reply that lands in a hidden tab ──
{
  await dealOpen(page);
  const hide = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new window.Event('visibilitychange'));
    }, hidden);
  await hide(true);
  const before = await versionOf(page);
  const reply = await page.evaluate(async () => {
    const { table, stage, client } = window.__bj;
    const allowed = client.state.round.allowed;
    await table.act(allowed.includes('noInsurance') ? 'noInsurance' : 'stand');
    return { playing: stage.stats().playing, done: stage.position.done };
  });
  const drawn = await onTruth(page);
  await hide(false);
  await idle(page);
  report.hiddenTab = {
    moved: (await versionOf(page)) !== before,
    sameAsServer: (await versionOf(page)) === (await serverVersion(page)),
    playedWhileHidden: reply.playing,
    drawnAsItStands: drawn,
    onTruthAfter: await onTruth(page),
  };
  await finish(page);
}

// ── C. a reload in the middle of a split ──
{
  await idle(page);
  await stack(page, ['8S', '6H', '8D', 'TC', '3D', '2S', '9H', 'TD', '7C']);
  await page.click('[data-deal]');
  await idle(page);
  const offered = await lit(page);
  await page.click('[data-action="split"]');
  await page.waitForFunction(() => window.__bj.client.state.round.hands.length === 2, null, {
    timeout: 10_000,
  });
  await page.reload();
  await page.waitForFunction(() => window.__bj && window.__bj.client.state !== null, null, {
    timeout: 30_000,
  });
  await watch(page);
  await idle(page);
  const after = await page.evaluate(() => ({
    hands: window.__bj.client.state.round.hands.length,
    allowed: window.__bj.client.state.round.allowed,
    cue: window.__bj.stage.position.cue,
  }));
  const shown = (await lit(page)).actions;
  report.reloadMidSplit = {
    splitOffered: offered.actions.includes('split'),
    hands: after.hands,
    replayed: after.cue !== -1,
    buttonsAreAllowed:
      JSON.stringify([...shown].sort()) === JSON.stringify([...after.allowed].sort()),
    onTruth: await onTruth(page),
  };
  await finish(page);
}

// ── D. a slow link during the dealer's play, and a reply lost after it applied — from the lab ──
{
  await idle(page);
  await page.click('[data-open="lab"]');
  await page.click('[data-latency="3000"]');
  await page.waitForFunction(() =>
    /3000 ms/.test(document.querySelector('[data-lab-state]').textContent),
  );
  await page.click('[data-open="lab"]'); // close the sheet
  await stack(page, ['9S', '7H', '7D', 'TC', '5S', '4H', '3C']);
  await page.click('[data-deal]');
  await idle(page);
  const pressed = Date.now();
  await page.click('[data-action="stand"]'); // 16 against a 7: the dealer plays, slowly
  const greyed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-action]')].every((b) => b.hidden || b.disabled),
  );
  await page.waitForFunction(() => window.__bj.client.state.round.phase === 'SETTLED', null, {
    timeout: 15_000,
  });
  const waited = Date.now() - pressed;
  await idle(page);
  const slow = { waitedMs: waited, greyedWhileWaiting: greyed, onTruth: await onTruth(page) };

  await page.click('[data-open="lab"]');
  await page.click('[data-latency="0"]');
  await page.click('[data-fault="drop"]');
  await page.waitForFunction(() =>
    /next 1 reply lost/.test(document.querySelector('[data-lab-state]').textContent),
  );
  await page.click('[data-open="lab"]');
  await stack(page, ['5S', '9H', '6D', 'TC', '2S', 'TH', '8C']);
  await page.click('[data-deal]'); // this reply is the one lost: dealt, stored, and retried
  await idle(page);
  await page.click('[data-action="hit"]');
  await idle(page);
  const round = await page.evaluate(() => window.__bj.client.state.round);
  report.lab = {
    slow,
    lostReply: {
      oneDeal: round.hands[0].cards.length === 3 && round.seq === 1,
      cards: round.hands[0].cards,
      onTruth: await onTruth(page),
    },
  };
  await finish(page);
}

// ── E. SIGKILL with a hand open ──
{
  await dealOpen(page);
  const before = await page.evaluate(() => {
    const t = window.__bj.client.state;
    return { roundId: t.round.roundId, phase: t.round.phase, balance: t.balance };
  });
  if (before.phase !== 'SETTLED') {
    table.kill();
    const pick = (await lit(page)).actions.includes('noInsurance') ? 'noInsurance' : 'stand';
    await page.click(`[data-action="${pick}"]`);
    await page.waitForTimeout(1200);
    const status = await page.evaluate(() => window.__bj.client.status);
    await table.restart();
    await page.waitForFunction(() => !window.__bj.client.busy, null, { timeout: 30_000 });
    await idle(page);
    const record = await page.evaluate(async (id) => {
      const { client } = window.__bj;
      const r = client.state.round;
      if (r.phase !== 'SETTLED') return { open: true, decisions: r.seq };
      return { open: false, decisions: (await client.fairRecord(id)).value.decisions.length };
    }, before.roundId);
    report.sigkill = {
      statusWhileDown: status,
      landedOnce: record.decisions === 1,
      onTruth: await onTruth(page),
      sameAsServer: (await versionOf(page)) === (await serverVersion(page)),
    };
  } else {
    report.sigkill = { skipped: 'the deal settled itself; run again' };
  }
}

const watched = [];
for (const p of pages) if (!p.isClosed()) watched.push(await seen(p));
await browser.close();
table.stop();
rmSync(dir, { recursive: true, force: true });

report.frames = watched.reduce((n, w) => n + w.frames, 0);
report.violations = watched.flatMap((w) => w.violations);
report.refused = wire.refused;
report.errors = errors;
console.log(JSON.stringify(report, null, 2));

const t = report.twoTabs;
const failures = [
  !(t.accepted === t.recorded) &&
    `two tabs: ${t.accepted} actions accepted, ${t.recorded} recorded`,
  !t.sameRound && 'two tabs did not end on the server’s round',
  !t.onTruth && 'two tabs: a stage off its truth',
  (report.hiddenTab.playedWhileHidden || !report.hiddenTab.drawnAsItStands) &&
    'a hidden tab played its reply',
  !(report.hiddenTab.moved && report.hiddenTab.onTruthAfter && report.hiddenTab.sameAsServer) &&
    'a hidden tab came back off its truth',
  !(report.reloadMidSplit.hands === 2 && !report.reloadMidSplit.replayed) &&
    'a reload mid-split did not come back as it stood',
  !(report.reloadMidSplit.buttonsAreAllowed && report.reloadMidSplit.onTruth) &&
    'after the reload, the table or its buttons were off the truth',
  !(
    report.lab.slow.waitedMs >= 3000 &&
    report.lab.slow.greyedWhileWaiting &&
    report.lab.slow.onTruth
  ) && 'the slow link',
  !(report.lab.lostReply.oneDeal && report.lab.lostReply.onTruth) &&
    'a lost reply became a second move',
  report.sigkill.skipped === undefined &&
    !(report.sigkill.landedOnce && report.sigkill.onTruth && report.sigkill.sameAsServer) &&
    'after the SIGKILL',
  report.violations.length > 0 &&
    'the frame monitor saw a card ahead of its reply or a lit button the truth refuses',
  report.refused > 0 && 'the server refused a request',
  errors.length > 0 && 'a page threw',
].filter(Boolean);
if (failures.length > 0) {
  console.error(`P0 (browser) NOT met:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('P0 (browser) met.');
process.exit(0);
