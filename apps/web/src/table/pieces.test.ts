import { inMemory } from '@blackjack/client-core';
import { card } from '@blackjack/cards';
import { describe, expect, it } from 'vitest';
import { add, canAdd, ceilingOf, chipsFor, dealable, fit, type Limits } from './bet.js';
import { intentOf, KEYS, type KeyPress } from './keys.js';
import { loadSettings, saveSettings } from './settings.js';
import { calloutOf, cardName } from './words.js';

const LIMITS: Limits = { betUnit: 100, minBet: 100, maxBet: 10_000, balance: 100_000 };

describe('bet', () => {
  it('offers 1, 5, 25 and 100 units, up to the table maximum', () => {
    expect(chipsFor(LIMITS)).toEqual([100, 500, 2500, 10_000]);
    expect(chipsFor({ betUnit: 200, maxBet: 2000 })).toEqual([200, 1000]);
    expect(chipsFor({ betUnit: 200, maxBet: 100 })).toEqual([200]);
  });

  it('never builds a stake the server would refuse', () => {
    // Every stake reachable from nothing by chips, under every balance: in range, whole units,
    // affordable — or not dealable.
    for (const balance of [0, 50, 100, 250, 999, 3000, 10_000, 1_000_000]) {
      const limits = { ...LIMITS, balance };
      const seen = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const stake = queue.pop() ?? 0;
        for (const chip of chipsFor(limits)) {
          const next = add(stake, chip, limits);
          expect(next <= ceilingOf(limits)).toBe(true);
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      for (const stake of seen) {
        const ok = stake >= 100 && stake <= 10_000 && stake % 100 === 0 && stake <= balance;
        expect(dealable(stake, limits)).toBe(ok);
      }
    }
  });

  it('a chip that would pass the ceiling stays dark, and a stake beyond reach is brought in', () => {
    expect(canAdd(9_900, 100, LIMITS)).toBe(true);
    expect(canAdd(9_900, 500, LIMITS)).toBe(false);
    expect(ceilingOf({ ...LIMITS, balance: 450 })).toBe(400);
    expect(fit(5000, { ...LIMITS, balance: 450 })).toBe(400);
    expect(dealable(150, LIMITS)).toBe(false);
  });
});

describe('settings', () => {
  it('are remembered, and default to the system’s reduced-motion preference', () => {
    const storage = inMemory();
    expect(loadSettings(storage, true)).toEqual({ turbo: false, reducedMotion: true });
    saveSettings(storage, { turbo: true, reducedMotion: false });
    expect(loadSettings(storage, true)).toEqual({ turbo: true, reducedMotion: false });
  });

  it('ignore what is not theirs, field by field', () => {
    const storage = inMemory();
    storage.set('bj:settings', '{"turbo":"yes","reducedMotion":true}');
    expect(loadSettings(storage, false)).toEqual({ turbo: false, reducedMotion: true });
    storage.set('bj:settings', 'not json');
    expect(loadSettings(storage, false)).toEqual({ turbo: false, reducedMotion: false });
  });
});

describe('keys', () => {
  const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    onPage: true,
    ...extra,
  });

  it('H S D P I N act, in either case', () => {
    for (const [action, key] of Object.entries(KEYS)) {
      expect(intentOf(press(key))).toEqual({ kind: 'act', action });
      expect(intentOf(press(key.toLowerCase()))).toEqual({ kind: 'act', action });
    }
  });

  it('Enter deals and Space skips from the page, never from a focused button', () => {
    expect(intentOf(press('Enter'))).toEqual({ kind: 'deal' });
    expect(intentOf(press(' '))).toEqual({ kind: 'skip' });
    expect(intentOf(press('Enter', { onPage: false }))).toBeNull();
    expect(intentOf(press(' ', { onPage: false }))).toBeNull();
    expect(intentOf(press('Escape', { onPage: false }))).toEqual({ kind: 'skip' });
  });

  it('leaves the browser its shortcuts', () => {
    expect(intentOf(press('d', { metaKey: true }))).toBeNull();
    expect(intentOf(press('s', { ctrlKey: true }))).toBeNull();
    expect(intentOf(press('x'))).toBeNull();
  });
});

describe('words', () => {
  it('name cards as a player says them', () => {
    expect(['AS', 'KD', 'TC', '7H'].map((c) => cardName(card(c)))).toEqual([
      'ace',
      'king',
      '10',
      '7',
    ]);
  });

  it('say the peek either way, and what insurance came to', () => {
    const f = (m: number) => `€${m / 100}`;
    expect(calloutOf({ kind: 'peek', blackjack: false }, f)).toBe('Dealer checked — no blackjack.');
    expect(calloutOf({ kind: 'peek', blackjack: true }, f)).toBe('Dealer has blackjack.');
    expect(calloutOf({ kind: 'insurancePaid', payout: 750 }, f)).toBe('Insurance pays €7.5.');
    expect(calloutOf({ kind: 'insurancePaid', payout: 0 }, f)).toBe('Insurance lost.');
    expect(calloutOf({ kind: 'card', to: 0, face: card('AS') }, f)).toBeNull();
  });
});
