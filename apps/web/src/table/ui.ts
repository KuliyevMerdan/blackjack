import { formatMinor, minor } from '@blackjack/money';
import type { Action } from '@blackjack/protocol';
import type { View } from './controller.js';
import { KEYS } from './keys.js';
import type { Settings } from './settings.js';

export interface Handlers {
  deal(): void;
  act(action: Action): void;
  chip(value: number): void;
  clear(): void;
  settings(settings: Settings): void;
}

const LABELS: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  insurance: 'Insurance',
  noInsurance: 'No insurance',
};

/** The order the bar shows them in — the insurance pair, then the decisions. */
const ORDER: readonly Action[] = ['insurance', 'noInsurance', 'hit', 'stand', 'double', 'split'];

const STATUS: Record<View['status'], string> = {
  connecting: 'Connecting…',
  online: 'Online',
  retrying: 'Reconnecting…',
  offline: 'Offline — your table is saved',
  outdated: 'A newer table is out — reload',
};

export const money = (amount: number): string => `€${formatMinor(minor(amount))}`;

/** A chip's face: whole euros without the cents — on the rail and on the felt. */
export const chipLabel = (amount: number): string =>
  amount % 100 === 0 ? `€${formatMinor(minor(amount)).replace(/[.,]00$/, '')}` : money(amount);

/**
 * The DOM over the canvas: the HUD, the connection pill, settings, the bet panel and the action bar.
 * A function of `View` — it reads nothing else and decides nothing. Buttons are disabled, not hidden,
 * while the gate is shut, so the bar does not jump; a button is shown only for an action in
 * `allowed` (ADR-0002). Everything the felt says is also said in words, to a live region.
 */
export function mountUi(root: HTMLElement, handlers: Handlers): (view: View) => void {
  root.innerHTML = `
    <header class="hud">
      <div class="balance">
        <span class="label">Balance</span> <strong data-balance>—</strong>
        <p class="notice">Play money only · 18+ · a portfolio demo, not a casino</p>
      </div>
      <div class="tools">
        <div class="status" data-status></div>
        <button type="button" class="gear" data-gear aria-expanded="false" aria-controls="settings"
          aria-label="Settings">⚙</button>
      </div>
    </header>
    <form class="settings" id="settings" data-settings hidden>
      <label><input type="checkbox" data-turbo /> Turbo — everything plays faster</label>
      <label><input type="checkbox" data-reduced /> Reduced motion — cards appear, nothing travels</label>
    </form>
    <p class="message" data-message role="alert" hidden></p>
    <footer class="controls">
      <p class="line" data-line></p>
      <div class="bet" data-bet>
        <div class="chips" data-chips role="group" aria-label="Add a chip to the stake"></div>
        <div class="stake-row">
          <span class="label">Stake</span>
          <output data-stake aria-live="polite">—</output>
          <button type="button" class="ghost" data-clear>Clear</button>
          <button type="button" class="primary" data-deal aria-keyshortcuts="Enter">Deal</button>
        </div>
      </div>
      <div class="actions" data-actions role="group" aria-label="Your move"></div>
    </footer>
    <p class="sr-only" data-announce aria-live="polite"></p>`;

  const $ = <T extends Element>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (el === null) throw new Error(`missing ${selector}`);
    return el;
  };
  const balance = $<HTMLElement>('[data-balance]');
  const status = $<HTMLElement>('[data-status]');
  const gear = $<HTMLButtonElement>('[data-gear]');
  const panel = $<HTMLFormElement>('[data-settings]');
  const turbo = $<HTMLInputElement>('[data-turbo]');
  const reduced = $<HTMLInputElement>('[data-reduced]');
  const message = $<HTMLElement>('[data-message]');
  const line = $<HTMLElement>('[data-line]');
  const bet = $<HTMLElement>('[data-bet]');
  const chips = $<HTMLElement>('[data-chips]');
  const stake = $<HTMLOutputElement>('[data-stake]');
  const clear = $<HTMLButtonElement>('[data-clear]');
  const deal = $<HTMLButtonElement>('[data-deal]');
  const actions = $<HTMLElement>('[data-actions]');
  const announce = $<HTMLElement>('[data-announce]');

  gear.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    gear.setAttribute('aria-expanded', String(!panel.hidden));
  });
  const changed = () => handlers.settings({ turbo: turbo.checked, reducedMotion: reduced.checked });
  turbo.addEventListener('change', changed);
  reduced.addEventListener('change', changed);
  clear.addEventListener('click', () => handlers.clear());
  deal.addEventListener('click', () => handlers.deal());

  const buttons = new Map<Action, HTMLButtonElement>();
  for (const action of ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset['action'] = action;
    button.setAttribute('aria-keyshortcuts', KEYS[action]);
    button.innerHTML = `<span>${LABELS[action]}</span> <kbd aria-hidden="true">${KEYS[action]}</kbd>`;
    button.addEventListener('click', () => handlers.act(action));
    buttons.set(action, button);
    actions.append(button);
  }

  let chipValues = '';
  const chipButtons = new Map<number, HTMLButtonElement>();
  let said = '';

  return (view) => {
    balance.textContent = view.hud === null ? '—' : money(view.hud);
    status.textContent = STATUS[view.status];
    status.dataset['state'] = view.status;
    turbo.checked = view.settings.turbo;
    reduced.checked = view.settings.reducedMotion;
    message.hidden = view.message === null;
    message.textContent = view.message ?? '';

    const open = view.round !== null && view.round.phase !== 'SETTLED';
    bet.hidden = open;
    actions.hidden = !open;

    // The chips on the rail follow the table's limits; each lights only if it keeps the stake legal.
    const values = view.chips.map((c) => c.value).join(',');
    if (values !== chipValues) {
      chipValues = values;
      chips.replaceChildren();
      chipButtons.clear();
      for (const chip of view.chips) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip';
        button.textContent = chipLabel(chip.value);
        button.setAttribute('aria-label', `Add ${money(chip.value)}`);
        button.addEventListener('click', () => handlers.chip(chip.value));
        chipButtons.set(chip.value, button);
        chips.append(button);
      }
    }
    for (const chip of view.chips) {
      const button = chipButtons.get(chip.value);
      if (button) button.disabled = !chip.enabled;
    }
    stake.textContent = money(view.stake);
    clear.disabled = open || view.busy || view.stake === 0;
    deal.disabled = !view.canDeal;

    for (const [action, button] of buttons) {
      const offered = view.round?.allowed.includes(action) ?? false;
      button.hidden = !offered;
      button.disabled = !view.actions.includes(action);
    }

    // The line over the controls: the round's result once it has played, else the last callout.
    const summary = view.summary;
    line.textContent = summary ? `${summary.heading} · ${summary.totals}` : (view.callout ?? '');
    line.dataset['kind'] = summary ? 'result' : 'callout';

    // The live region speaks what changed: a result in full, else the decision now in front of you.
    const speech = summary
      ? `${summary.heading}. ${summary.detail} ${summary.totals}.`
      : [view.callout, view.prompt].filter((s) => s !== null).join(' ');
    if (speech !== said) {
      said = speech;
      announce.textContent = speech;
    }
  };
}
