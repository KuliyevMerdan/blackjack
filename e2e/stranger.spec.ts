import { expect, test } from '@playwright/test';
import {
  balanceOf,
  deal,
  errorsOf,
  minorOf,
  next,
  press,
  stepsOf,
  stranger,
  verifyNewest,
} from './support.js';

/**
 * ROADMAP P1 "Done when": a stranger opens the link, plays a hand with a split, breaks the network
 * from the lab mid-hand, watches it recover with nothing lost, and verifies the hand they just
 * played — in under two minutes.
 *
 * Nothing but the page: no dev hooks, no forced shoe, no request touched. So it runs against the
 * local server in CI and, unchanged, against the live demo (`E2E_BASE_URL=… pnpm e2e:live`). The
 * shuffle is real, so the stranger deals until a pair comes — standing on everything else.
 */
test('a stranger splits, loses a reply mid-hand, recovers, and verifies the hand', async ({
  browser,
}) => {
  const started = Date.now();
  // Turbo and reduced motion, as a hurried player would set them: the pair is luck, ~1 hand in 7,
  // and on a CI runner drawing WebGL in software a hand at the full pace takes seconds.
  const page = await stranger(browser, true);
  const status = page.locator('[data-status]');
  let hands = 0;
  let pressed: string[] = [];
  let broke = false;
  let before = 0;

  while (!broke) {
    const waited = Math.round((Date.now() - started) / 1000);
    expect(hands < 40 && waited < 100, `${hands} hands in ${waited} s and no pair yet`).toBe(true);
    hands += 1;
    before = await balanceOf(page);
    pressed = [];
    await deal(page);
    for (let step = await next(page); step.kind === 'decide'; step = await next(page)) {
      const choose = (): string => {
        if (step.kind !== 'decide') return 'stand';
        if (step.actions.includes('noInsurance')) return 'noInsurance';
        if (pressed.length === 0 && step.actions.includes('split')) return 'split';
        return 'stand';
      };
      const action = choose();
      if (pressed.includes('split') && !broke && action !== 'noInsurance') {
        // Mid-hand, after the split, the lab breaks both ends: this browser goes offline, and the
        // server will apply the next move it hears and hang up without answering.
        const lab = page.locator('[data-open="lab"]');
        await lab.click();
        await page.locator('[data-fault="drop"]').click();
        await expect(page.locator('[data-lab-state]')).toHaveText('Now: the next 1 reply lost.');
        await page.locator('[data-fault="offline"]').check();
        await lab.click();
        broke = true;
        // The pill's states as they change — "Reconnecting…" while the client backs off.
        await status.evaluate((pill) => {
          const seen: string[] = [];
          Object.assign(window, { seenStates: seen });
          new MutationObserver(() => {
            const state = pill.dataset['state'] ?? '';
            if (state !== (seen.at(-1) ?? 'online')) seen.push(state);
          }).observe(pill, { attributes: true });
        });
        await press(page, action);
        await expect(status).toHaveText('Reconnecting…');
        // Back online inside the backoff: the retry lands, the server applies it and hangs up, and
        // the next try under the same id gets the stored answer. (Chromium may make that try
        // itself: a POST cut off on a reused keep-alive socket before any byte came back is
        // resent by the browser. Either way it is the same request, and the server knows it.)
        await lab.click();
        await page.locator('[data-fault="offline"]').uncheck();
        await lab.click();
        // If the outage outlasted the retries, the pill said Offline — and the table kept asking
        // where the round is until it heard. Either way it ends Online, by itself.
        await expect(status).toHaveText('Online', { timeout: 30_000 });
        const seen: unknown = await page.evaluate(() => Reflect.get(window, 'seenStates'));
        expect(Array.isArray(seen) && seen[0]).toBe('retrying');
        expect(Array.isArray(seen) && seen.at(-1)).toBe('online');
        // …and the lab no longer claims a fault the server has spent.
        await expect(page.locator('[data-lab-state]')).toHaveText('No faults.');
      } else {
        await press(page, action);
      }
      pressed.push(action);
    }
  }

  // Nothing lost, nothing doubled: the balance moved by exactly what the line says.
  const totals = (await page.locator('[data-line]').textContent()) ?? '';
  const [staked = '', returned = ''] = totals.split('·').slice(1);
  expect(await balanceOf(page)).toBe(before - minorOf(staked) + minorOf(returned));

  // The proof: every check holds, and the replay has exactly the moves pressed — the lost reply's
  // move once, not twice.
  const tab = await verifyNewest(page);
  await expect(tab.locator('.verdict')).toHaveClass(/\bverified\b/);
  expect(await stepsOf(tab)).toEqual(['pass', 'pass', 'pass', 'pass']);
  const moves = await tab
    .locator('.replay li')
    .evaluateAll((items) =>
      items.flatMap((li) => /^— You: (\w+)$/.exec(li.textContent ?? '')?.slice(1) ?? []),
    );
  expect(moves).toEqual(pressed);

  const tookMs = Date.now() - started;
  expect(tookMs).toBeLessThan(120_000);
  expect(errorsOf(page)).toEqual([]);
  test.info().annotations.push({
    type: 'measured',
    description: `open → verified in ${(tookMs / 1000).toFixed(1)} s; the pair came on hand ${hands}`,
  });
});
