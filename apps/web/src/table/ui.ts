import { formatMinor, minor } from '@blackjack/money';
import type { Action } from '@blackjack/protocol';
import type { View } from './controller.js';

export interface Handlers {
  deal(): void;
  act(action: Action): void;
  stake(direction: 1 | -1): void;
}

const LABELS: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  insurance: 'Insurance',
  noInsurance: 'No insurance',
};

const STATUS: Record<View['status'], string> = {
  connecting: 'Connecting…',
  online: 'Online',
  retrying: 'Reconnecting…',
  offline: 'Offline — your table is saved',
  outdated: 'A newer table is out — reload',
};

export const money = (amount: number): string => `€${formatMinor(minor(amount))}`;

/**
 * The DOM over the canvas: the HUD, the connection pill, the stake and the action bar. A function
 * of `View` — it reads nothing else and decides nothing. Buttons are disabled, not hidden, while
 * the gate is shut, so the layout does not jump (ADR-0002).
 */
export function mountUi(root: HTMLElement, handlers: Handlers): (view: View) => void {
  root.innerHTML = `
    <header class="hud">
      <div class="balance"><span class="label">Balance</span> <strong data-balance>—</strong></div>
      <div class="status" data-status></div>
    </header>
    <p class="message" data-message hidden></p>
    <footer class="controls">
      <div class="bet" data-bet>
        <button type="button" data-stake="-1" aria-label="Lower the stake">−</button>
        <output data-stake-value>—</output>
        <button type="button" data-stake="1" aria-label="Raise the stake">+</button>
        <button type="button" class="primary" data-deal>Deal</button>
      </div>
      <div class="actions" data-actions></div>
    </footer>
    <p class="notice">Play money only · 18+ · a portfolio demo, not a casino</p>`;

  const $ = <T extends Element>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (el === null) throw new Error(`missing ${selector}`);
    return el;
  };
  const balance = $<HTMLElement>('[data-balance]');
  const status = $<HTMLElement>('[data-status]');
  const message = $<HTMLElement>('[data-message]');
  const bet = $<HTMLElement>('[data-bet]');
  const stakeValue = $<HTMLOutputElement>('[data-stake-value]');
  const deal = $<HTMLButtonElement>('[data-deal]');
  const actions = $<HTMLElement>('[data-actions]');

  root.querySelectorAll<HTMLButtonElement>('[data-stake]').forEach((button) => {
    button.addEventListener('click', () =>
      handlers.stake(button.dataset['stake'] === '1' ? 1 : -1),
    );
  });
  deal.addEventListener('click', () => handlers.deal());
  const buttons = new Map<Action, HTMLButtonElement>();
  for (const action of Object.keys(LABELS).filter(isAction)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = LABELS[action];
    button.dataset['action'] = action;
    button.addEventListener('click', () => handlers.act(action));
    buttons.set(action, button);
    actions.append(button);
  }

  return (view) => {
    balance.textContent = view.hud === null ? '—' : money(view.hud);
    status.textContent = STATUS[view.status];
    status.dataset['state'] = view.status;
    message.hidden = view.message === null;
    message.textContent = view.message ?? '';
    stakeValue.textContent = money(view.stake);

    const open = view.round !== null && view.round.phase !== 'SETTLED';
    bet.hidden = open;
    deal.disabled = !view.canDeal;
    actions.hidden = !open;
    for (const [action, button] of buttons) {
      const offered = view.round?.allowed.includes(action) ?? false;
      button.hidden = !offered;
      button.disabled = !view.actions.includes(action);
    }
  };
}

function isAction(value: string): value is Action {
  return value in LABELS;
}
