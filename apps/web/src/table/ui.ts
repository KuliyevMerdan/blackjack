import type { Read } from '@blackjack/client-core';
import { formatMinor, minor } from '@blackjack/money';
import type { Action, RoundSummary } from '@blackjack/protocol';
import { prettyCards } from '../cards.js';
import { rulesWords } from '../rules.js';
import type { View } from './controller.js';
import { KEYS } from './keys.js';
import type { Settings } from './settings.js';

export interface Handlers {
  deal(): void;
  act(action: Action): void;
  chip(value: number): void;
  clear(): void;
  settings(settings: Settings): void;
  /** The session's last rounds, newest first — asked for each time the panel opens. */
  history(): Promise<Read<readonly RoundSummary[]>>;
}

const REPO = 'https://github.com/KuliyevMerdan/blackjack/blob/main';

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
        <div class="buttons">
          <button type="button" class="gear" data-open="history" aria-expanded="false"
            aria-controls="history" aria-label="History">☰</button>
          <button type="button" class="gear" data-open="about" aria-expanded="false"
            aria-controls="about" aria-label="Rules and how this works">i</button>
          <button type="button" class="gear" data-open="settings" aria-expanded="false"
            aria-controls="settings" aria-label="Settings">⚙</button>
        </div>
        <div class="status" data-status></div>
      </div>
    </header>
    <form class="sheet settings" id="settings" data-sheet="settings" hidden>
      <label><input type="checkbox" data-turbo /> Turbo — everything plays faster</label>
      <label><input type="checkbox" data-reduced /> Reduced motion — cards appear, nothing travels</label>
      <label><input type="checkbox" data-hint /> Strategy hint — mark basic strategy's move</label>
    </form>
    <section class="sheet history" id="history" data-sheet="history" hidden aria-label="History">
      <h2>Your last hands</h2>
      <p class="hint-text" data-history-state>Loading…</p>
      <ol data-history-list></ol>
    </section>
    <section class="sheet about" id="about" data-sheet="about" hidden aria-label="Rules">
      <h2>The rules</h2>
      <ul data-rules></ul>
      <h2>How this works</h2>
      <p>The shoe for each round is fixed before you bet: the server shows a fingerprint (SHA-256) of
        its secret seed, you add a seed of your own, and the six decks are shuffled from both. When
        the round ends the secret is revealed, and the round's “Verify” link replays it in your
        browser — the shuffle and the rules engine are the same code the server runs.</p>
      <p>The screen never runs ahead of the server: buttons open only for a decision you have
        already been shown, and the hole card is not in your browser until it turns.</p>
      <p><a target="_blank" rel="noopener" href="${REPO}/docs/adr/ADR-0001-committed-shoe.md">The committed shoe</a> ·
        <a target="_blank" rel="noopener" href="${REPO}/docs/adr/ADR-0002-presentation-lags-truth.md">The presentation lags the truth</a></p>
      <p class="notice">Play money only · 18+ · no real money, payments or crypto.</p>
    </section>
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
  const turbo = $<HTMLInputElement>('[data-turbo]');
  const reduced = $<HTMLInputElement>('[data-reduced]');
  const hintBox = $<HTMLInputElement>('[data-hint]');
  const historyState = $<HTMLElement>('[data-history-state]');
  const historyList = $<HTMLOListElement>('[data-history-list]');
  const rulesList = $<HTMLUListElement>('[data-rules]');
  const message = $<HTMLElement>('[data-message]');
  const line = $<HTMLElement>('[data-line]');
  const bet = $<HTMLElement>('[data-bet]');
  const chips = $<HTMLElement>('[data-chips]');
  const stake = $<HTMLOutputElement>('[data-stake]');
  const clear = $<HTMLButtonElement>('[data-clear]');
  const deal = $<HTMLButtonElement>('[data-deal]');
  const actions = $<HTMLElement>('[data-actions]');
  const announce = $<HTMLElement>('[data-announce]');

  // One sheet open at a time, under the HUD; its button says whether it is. Delegated, so a sheet
  // added later (the network lab) opens the same way.
  root.addEventListener('click', (event) => {
    const target = event.target;
    const opener = target instanceof Element ? target.closest<HTMLElement>('[data-open]') : null;
    if (opener === null) return;
    const name = opener.dataset['open'];
    const sheets = [...root.querySelectorAll<HTMLElement>('[data-sheet]')];
    for (const sheet of sheets) sheet.hidden = sheet.dataset['sheet'] !== name || !sheet.hidden;
    for (const o of root.querySelectorAll<HTMLElement>('[data-open]')) {
      const shown = sheets.some((sh) => sh.dataset['sheet'] === o.dataset['open'] && !sh.hidden);
      o.setAttribute('aria-expanded', String(shown));
    }
    if (
      name === 'history' &&
      sheets.some((sh) => sh.dataset['sheet'] === 'history' && !sh.hidden)
    ) {
      void showHistory();
    }
  });
  const showHistory = async () => {
    historyState.hidden = false;
    historyState.textContent = 'Loading…';
    historyList.replaceChildren();
    const read = await handlers.history();
    if (read.kind !== 'ok') {
      historyState.textContent = 'The history could not be fetched. Try again in a moment.';
      return;
    }
    if (read.value.length === 0) {
      historyState.textContent = 'No hands yet — deal one.';
      return;
    }
    historyState.hidden = true;
    historyList.replaceChildren(...read.value.map(historyRow));
  };
  const changed = () =>
    handlers.settings({
      turbo: turbo.checked,
      reducedMotion: reduced.checked,
      hint: hintBox.checked,
    });
  turbo.addEventListener('change', changed);
  reduced.addEventListener('change', changed);
  hintBox.addEventListener('change', changed);
  let rulesShown = false;
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
    hintBox.checked = view.settings.hint;
    if (!rulesShown && view.config !== null) {
      rulesShown = true;
      rulesList.replaceChildren(
        ...rulesWords(view.config.rules).map((r) => {
          const li = document.createElement('li');
          li.textContent = r;
          return li;
        }),
      );
    }
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
      const hinted = view.hint === action;
      button.classList.toggle('hint', hinted);
      if (hinted) button.setAttribute('aria-description', 'Basic strategy’s move');
      else button.removeAttribute('aria-description');
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

/** One past hand: when, the cards, the money — and the link that proves it. */
function historyRow(round: RoundSummary): HTMLLIElement {
  const li = document.createElement('li');
  const when = document.createElement('time');
  when.dateTime = new Date(round.settledAt).toISOString();
  when.textContent = new Date(round.settledAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const cards = document.createElement('span');
  cards.className = 'cards';
  cards.textContent = `Dealer ${prettyCards(round.dealer)} · You ${round.hands.map(prettyCards).join(' | ')}`;
  const sums = document.createElement('span');
  sums.className = 'sums';
  sums.textContent = `Staked ${money(round.totalStake)} · returned ${money(round.totalPayout)}`;
  const verify = document.createElement('a');
  verify.href = `#/verify/${round.roundId}`;
  verify.target = '_blank';
  verify.rel = 'noopener';
  verify.textContent = 'Verify';
  verify.setAttribute('aria-label', `Verify the hand of ${when.textContent}`);
  li.append(when, cards, sums, verify);
  return li;
}
