// @vitest-environment happy-dom
import type { Round } from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import type { View } from './controller.js';
import { mountUi, type Handlers } from './ui.js';

/**
 * The action bar and the bet panel as DOM: a function of `View`, deciding nothing. Each test mounts
 * it, shows a view, and reads the page back the way a player — or a screen reader — would.
 */

const ROUND = {
  roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
  seq: 0,
  phase: 'PLAYER',
  stake: 500,
  commit: 'ab'.repeat(32),
  clientSeed: 'seed',
  dealer: { cards: ['KS'], holeHidden: true },
  hands: [{ cards: ['9H', '9C'], stake: 500, doubled: false, fromSplit: false, state: 'PLAYING' }],
  activeHand: 0,
  allowed: ['hit', 'stand', 'double', 'split'],
  insurance: null,
  totalStake: 500,
} as unknown as Round; // a fixture: the controller's tests parse real rounds

const VIEW: View = {
  status: 'online',
  hud: 99_500,
  config: null,
  round: ROUND,
  stake: 500,
  chips: [
    { value: 100, enabled: false },
    { value: 500, enabled: false },
  ],
  gateOpen: true,
  busy: false,
  actions: ['hit', 'stand', 'double', 'split'],
  canDeal: false,
  message: null,
  callout: 'Dealer checked — no blackjack.',
  prompt: 'You have 9, 9 — 18. Dealer shows a king. Hit, stand, double or split?',
  summary: null,
  settings: { turbo: false, reducedMotion: false },
};

function mount() {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const calls: string[] = [];
  const handlers: Handlers = {
    deal: () => calls.push('deal'),
    act: (a) => calls.push(a),
    chip: (v) => calls.push(`chip ${v}`),
    clear: () => calls.push('clear'),
    settings: (s) => calls.push(`settings ${JSON.stringify(s)}`),
  };
  const show = mountUi(root, handlers);
  const buttons = () =>
    [...root.querySelectorAll<HTMLButtonElement>('[data-action]')].filter((b) => !b.hidden);
  return { root, show, calls, buttons };
}

describe('the action bar', () => {
  it('shows exactly `allowed`, each with its key for the keyboard and the screen reader', () => {
    const { show, buttons } = mount();
    show(VIEW);
    expect(
      buttons().map((b) => [b.dataset['action'], b.getAttribute('aria-keyshortcuts')]),
    ).toEqual([
      ['hit', 'H'],
      ['stand', 'S'],
      ['double', 'D'],
      ['split', 'P'],
    ]);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    show({ ...VIEW, round: { ...ROUND, allowed: ['hit', 'stand'] }, actions: ['hit', 'stand'] });
    expect(buttons().map((b) => b.dataset['action'])).toEqual(['hit', 'stand']);
  });

  it('greys, never hides, while the gate is shut — the bar does not jump', () => {
    const { show, buttons } = mount();
    show({ ...VIEW, gateOpen: false, actions: [] });
    expect(buttons()).toHaveLength(4);
    expect(buttons().every((b) => b.disabled)).toBe(true);
  });

  it('offers insurance as its own pair under an ace', () => {
    const { show, buttons } = mount();
    const offer = { ...ROUND, phase: 'INSURANCE', allowed: ['insurance', 'noInsurance'] } as Round;
    show({ ...VIEW, round: offer, actions: ['insurance', 'noInsurance'] });
    expect(buttons().map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Insurance I',
      'No insurance N',
    ]);
  });

  it('says the decision in words, once, to a live region', () => {
    const { root, show } = mount();
    show(VIEW);
    const live = root.querySelector('[aria-live][data-announce]');
    expect(live?.textContent).toBe(`${VIEW.callout} ${VIEW.prompt}`);
    expect(root.querySelector('[data-line]')?.textContent).toBe(VIEW.callout);
  });
});

describe('the bet panel and the result', () => {
  const settled = { ...ROUND, phase: 'SETTLED', allowed: [], activeHand: null } as unknown as Round;

  it('shows the chips the view lights, and only between rounds', () => {
    const { root, show, calls } = mount();
    show(VIEW);
    expect(root.querySelector<HTMLElement>('[data-bet]')?.hidden).toBe(true);
    show({
      ...VIEW,
      round: settled,
      actions: [],
      canDeal: true,
      chips: [
        { value: 100, enabled: true },
        { value: 10_000, enabled: false },
      ],
    });
    const chips = [...root.querySelectorAll<HTMLButtonElement>('.chip')];
    expect(chips.map((c) => [c.textContent, c.disabled])).toEqual([
      ['€1', false],
      ['€100', true],
    ]);
    chips[0]?.click();
    root.querySelector<HTMLButtonElement>('[data-deal]')?.click();
    expect(calls).toEqual(['chip 100', 'deal']);
  });

  it('puts the round’s result over the controls, and says it in full', () => {
    const { root, show } = mount();
    show({
      ...VIEW,
      round: settled,
      actions: [],
      prompt: null,
      summary: { heading: 'You win', totals: 'Staked €5 · returned €10', detail: 'Hand: 18, win.' },
    });
    const line = root.querySelector<HTMLElement>('[data-line]');
    expect(line?.textContent).toBe('You win · Staked €5 · returned €10');
    expect(line?.dataset['kind']).toBe('result');
    expect(root.querySelector('[data-announce]')?.textContent).toBe(
      'You win. Hand: 18, win. Staked €5 · returned €10.',
    );
  });

  it('hands the settings back as the player sets them', () => {
    const { root, show, calls } = mount();
    show(VIEW);
    const turbo = root.querySelector<HTMLInputElement>('[data-turbo]');
    if (turbo === null) throw new Error('no turbo');
    turbo.checked = true;
    turbo.dispatchEvent(new Event('change'));
    expect(calls).toEqual(['settings {"turbo":true,"reducedMotion":false}']);
  });
});
