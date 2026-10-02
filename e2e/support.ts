import { expect, type Browser, type Page } from '@playwright/test';

/**
 * What the specs share — all of it through the page: buttons by their data attributes, the HUD and
 * the line over the controls by their text. Nothing here reaches into the app's state.
 */

const errors = new WeakMap<Page, string[]>();

/**
 * A stranger: a fresh browser with nothing stored, on the table in turbo — and, with `reduced`,
 * reduced motion too (both are the table's own settings, a link's `?turbo&reduced`).
 */
export async function stranger(browser: Browser, reduced = false): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen: string[] = [];
  errors.set(page, seen);
  page.on('pageerror', (e) => seen.push(e.message));
  context.on('page', (p) => {
    errors.set(p, seen);
    p.on('pageerror', (e) => seen.push(e.message));
  });
  await page.goto(reduced ? '/?turbo&reduced' : '/?turbo');
  await expect(page.locator('[data-status]')).toHaveText('Online', { timeout: 60_000 });
  return page;
}

export const errorsOf = (page: Page): string[] => errors.get(page) ?? [];

/** The balance in the HUD, in minor units. */
export async function balanceOf(page: Page): Promise<number> {
  return minorOf((await page.locator('[data-balance]').textContent()) ?? '');
}

export function minorOf(text: string): number {
  const match = /€([\d,]+)\.(\d\d)/.exec(text);
  if (match === null) throw new Error(`no amount in “${text}”`);
  return Number((match[1] ?? '').replaceAll(',', '')) * 100 + Number(match[2]);
}

export type Next = { kind: 'decide'; actions: string[] } | { kind: 'settled' };

/**
 * Waits for the table to want something: the actions lit — the gate open, the screen caught up with
 * the reply — or the round over, its result on the line.
 */
export async function next(page: Page): Promise<Next> {
  const handle = await page.waitForFunction(
    () => {
      const lit = [...document.querySelectorAll<HTMLButtonElement>('[data-action]')].filter(
        (b) => !b.hidden && !b.disabled,
      );
      if (lit.length > 0) return { kind: 'decide', actions: lit.map((b) => b.dataset['action']) };
      const line = document.querySelector<HTMLElement>('[data-line]');
      const deal = document.querySelector<HTMLButtonElement>('[data-deal]');
      return line?.dataset['kind'] === 'result' && deal !== null && !deal.disabled
        ? { kind: 'settled' }
        : null;
    },
    null,
    { timeout: 60_000, polling: 'raf' },
  );
  const value: unknown = await handle.jsonValue();
  return value as Next;
}

export async function press(page: Page, action: string): Promise<void> {
  await page.locator(`[data-action="${action}"]`).click();
}

export async function deal(page: Page): Promise<void> {
  await expect(page.locator('[data-deal]')).toBeEnabled({ timeout: 60_000 });
  await page.locator('[data-deal]').click();
}

/** The history's newest hand: opens the sheet, follows its Verify link into a new tab. */
export async function verifyNewest(page: Page): Promise<Page> {
  await page.locator('[data-open="history"]').click();
  const link = page.locator('[data-history-list] li a').first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  const [tab] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
  await expect(tab.locator('.verdict')).toBeVisible({ timeout: 30_000 });
  return tab;
}

/** The four checks' statuses, in order: commit, this browser's memory, the shuffle, the replay. */
export async function stepsOf(tab: Page): Promise<string[]> {
  return tab
    .locator('.step')
    .evaluateAll((steps) => steps.map((s) => s.className.replace('step ', '')));
}
