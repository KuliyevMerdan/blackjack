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
 *
 * The break, after the split, is both ends of the wire in turn: this browser offline until the
 * client gives up (the move never left; the table must find its own way back and offer it again),
 * then the server applying the move and hanging up unanswered (the retry must get the stored reply).
 * Each waits on what the page says, never on how fast the backoff runs — CI runners are slow.
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
        broke = true;
        const lab = page.locator('[data-open="lab"]');
        const toggle = async (fault: 'drop' | 'offline' | 'online') => {
          await lab.click();
          if (fault === 'drop') await page.locator('[data-fault="drop"]').click();
          else await page.locator('[data-fault="offline"]').setChecked(fault === 'offline');
          await lab.click();
        };
        // The pill's states as they change.
        await status.evaluate((pill) => {
          const seen: string[] = [];
          Object.assign(window, { seenStates: seen });
          new MutationObserver(() => {
            const state = pill.dataset['state'] ?? '';
            if (state !== (seen.at(-1) ?? 'online')) seen.push(state);
          }).observe(pill, { attributes: true });
        });

        // 1. Mid-hand, after the split, this browser goes offline and the stranger presses on. The
        //    client retries, gives up, and says so — the move never left this browser.
        await toggle('offline');
        await press(page, action);
        await expect(status).toHaveText('Reconnecting…');
        await expect(status).toHaveText('Offline — your table is saved', { timeout: 30_000 });
        await expect(page.locator('[data-message]')).toContainText('Your last move is safe');
        // 2. Back online, the table finds its own way back — nothing to press, nothing to reload —
        //    and offers the same move again, because it never happened.
        await toggle('online');
        await expect(status).toHaveText('Online', { timeout: 30_000 });
        // Retrying, then Offline — and Online last. In between, as many rounds of asking as the
        // network took to come back: the table kept trying while this browser was still cut off.
        const seen: unknown = await page.evaluate(() => Reflect.get(window, 'seenStates'));
        const states = Array.isArray(seen) ? seen.map(String) : [];
        expect([...states.slice(0, 2), states.at(-1)]).toEqual(['retrying', 'offline', 'online']);
        expect(states.slice(2, -1).every((s) => s === 'retrying' || s === 'offline')).toBe(true);
        await expect(page.locator(`[data-action="${action}"]`)).toBeEnabled({ timeout: 15_000 });
        // 3. Now the other end breaks: the server applies the move and hangs up unanswered. The
        //    retry under the same id is answered from the stored reply — one move, not two.
        await toggle('drop');
        await expect(page.locator('[data-lab-state]')).toHaveText('Now: the next 1 reply lost.');
        await press(page, action);
        await expect(page.locator('[data-lab-state]')).toHaveText('No faults.', {
          timeout: 30_000,
        });
        await expect(status).toHaveText('Online', { timeout: 30_000 });
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
