import { expect, test } from '@playwright/test';
import {
  balanceOf,
  deal,
  errorsOf,
  next,
  press,
  stepsOf,
  stranger,
  verifyNewest,
} from './support.js';

/**
 * ROADMAP P1: a split into four hands with a double, the dealer busting, every payout asserted on
 * screen and in the balance — then the round taken to the verifier.
 *
 * The shoe is forced (docs/protocol.md §9 — a development server only): the one thing this spec
 * does below the page is add `forceShoe` to the deal request on its way out. In §3.3's order:
 *
 *   8♥ you · 6♠ dealer · 8♣ you · T♦ hole
 *   split → 8♦ to hand 1 · split → 8♠ to hand 1 · split → 3♥ to hand 1 (four hands: 8 3 = 11)
 *   double → T♣ (21) · T♠ hand 2 (18) · 9♥ hand 3 (17) · 7♣ hand 4 (15)
 *   the dealer: 6 T, draws 9♦ — 25, bust. Every hand wins.
 *
 * At a €5 stake: €25 staked (four hands, one doubled), €50 back — hand 1 €20, the rest €10 each.
 */
const SHOE = ['8H', '6S', '8C', 'TD', '8D', '8S', '3H', 'TC', 'TS', '9H', '7C', '9D'];

test('four hands from one pair, a double, the dealer bust — every euro where it should be', async ({
  browser,
}) => {
  const page = await stranger(browser);
  await page.route('**/api/deal', async (route) => {
    const body: unknown = route.request().postDataJSON();
    await route.continue({ postData: JSON.stringify({ ...Object(body), forceShoe: SHOE }) });
  });

  const before = await balanceOf(page);
  await expect(page.locator('[data-stake]')).toHaveText('€5.00');
  await deal(page);

  // Three splits, each offered only while the table has room; then the double on 8 3.
  for (const hands of [2, 3, 4]) {
    expect((await next(page)).kind).toBe('decide');
    await expect(page.locator('[data-action="split"]')).toBeEnabled();
    await press(page, 'split');
    await expect(page.locator('[data-announce]')).toContainText(`of ${hands}`);
  }
  let step = await next(page);
  expect(step).toEqual({ kind: 'decide', actions: ['hit', 'stand', 'double'] });
  await expect(page.locator('[data-announce]')).toContainText('Hand 1 of 4: 8, 3 — 11');
  await expect(page.locator('[data-balance]')).toHaveText(money(before - 2000));
  await press(page, 'double');

  // Hands 2–4 take their second cards as they become active; stand on each.
  for (const said of [
    'Hand 2 of 4: 8, 10 — 18',
    'Hand 3 of 4: 8, 9 — 17',
    'Hand 4 of 4: 8, 7 — 15',
  ]) {
    step = await next(page);
    expect(step.kind).toBe('decide');
    await expect(page.locator('[data-announce]')).toContainText(said);
    await press(page, 'stand');
  }
  expect((await next(page)).kind).toBe('settled');

  // On screen: the verdict, the totals, and every hand's money, in words.
  await expect(page.locator('[data-line]')).toHaveText('You win · Staked €25.00 · returned €50.00');
  const said = page.locator('[data-announce]');
  await expect(said).toContainText('Dealer: 25, bust.');
  await expect(said).toContainText('Hand 1: 21, win, €20.00 back.');
  await expect(said).toContainText('Hand 2: 18, win, €10.00 back.');
  await expect(said).toContainText('Hand 3: 17, win, €10.00 back.');
  await expect(said).toContainText('Hand 4: 15, win, €10.00 back.');
  // In the balance: €25 out, €50 back.
  await expect(page.locator('[data-balance]')).toHaveText(money(before + 2500));

  // The verifier: the commit holds, this browser sent the seed, the decisions replay to the same
  // round — and the shoe, honestly, is not a shuffle: a forced round is never called verified.
  const tab = await verifyNewest(page);
  await expect(tab.locator('.verdict')).toHaveClass(/unverifiable/);
  expect(await stepsOf(tab)).toEqual(['pass', 'pass', 'forced', 'pass']);
  const replay = tab.locator('.replay li');
  await expect(replay.filter({ hasText: /^— You: split$/ })).toHaveCount(3);
  await expect(replay.filter({ hasText: /^— You: double$/ })).toHaveCount(1);
  await expect(replay.filter({ hasText: /^— You: stand$/ })).toHaveCount(3);
  await expect(tab.locator('body')).toContainText('paid €50.00');

  expect(errorsOf(page)).toEqual([]);
});

const money = (minor: number) =>
  `€${Math.floor(minor / 100).toLocaleString('en-US')}.${String(minor % 100).padStart(2, '0')}`;
