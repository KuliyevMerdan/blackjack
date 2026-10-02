import { TransportError, type Client, type Transport } from '@blackjack/client-core';
import type { Faults } from '@blackjack/protocol';

/**
 * The network lab (ROADMAP P0, docs/protocol.md §9): the visitor breaks their own connection to the
 * table and watches the protocol hold — a reply lost after the move applied, a storm of refusals, a
 * slow link, this browser offline. The server-side faults touch only this session; "offline" is
 * this browser's alone, a switch in front of its transport.
 */
export class Offline {
  on = false;

  wrap(inner: Transport): Transport {
    return async (request) => {
      // The lab's own request is never the one it breaks.
      if (this.on && request.path !== '/api/faults') {
        throw new TransportError('offline — the network lab');
      }
      return inner(request);
    };
  }
}

const LATENCIES = [0, 300, 1000, 3000];

/** Adds the lab's button and sheet to the HUD — only when the server offers faults. */
export function mountLab(root: HTMLElement, client: Client, offline: Offline): void {
  const buttons = root.querySelector('.tools .buttons');
  const anchor = root.querySelector('[data-sheet="about"]');
  if (!client.lab || buttons === null || anchor === null) return;

  const opener = document.createElement('button');
  opener.type = 'button';
  opener.className = 'gear lab-opener';
  opener.dataset['open'] = 'lab';
  opener.setAttribute('aria-expanded', 'false');
  opener.setAttribute('aria-controls', 'lab');
  opener.setAttribute('aria-label', 'Network lab');
  opener.textContent = '⚡';
  buttons.prepend(opener);

  const sheet = document.createElement('section');
  sheet.className = 'sheet lab';
  sheet.id = 'lab';
  sheet.dataset['sheet'] = 'lab';
  sheet.hidden = true;
  sheet.setAttribute('aria-label', 'Network lab');
  sheet.innerHTML = `
    <h2>Network lab</h2>
    <p class="hint-text">Break your own connection to the table and watch nothing get lost. Only
      your session is touched.</p>
    <div class="row" role="group" aria-label="Latency">
      <span class="label">Latency</span>
      ${LATENCIES.map((ms) => `<button type="button" data-latency="${ms}">${ms === 0 ? 'none' : ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}</button>`).join('')}
    </div>
    <button type="button" data-fault="drop">Lose the next reply</button>
    <p class="hint-text">The server applies your next move, then hangs up without answering. The
      client retries under the same id and gets the stored answer — one move, not two.</p>
    <button type="button" data-fault="storm">Refuse the next 5 requests</button>
    <label><input type="checkbox" data-fault="lossy" /> Lose 30% of replies</label>
    <label><input type="checkbox" data-fault="offline" /> This browser offline</label>
    <button type="button" class="ghost" data-fault="reset">Everything back to normal</button>
    <p class="hint-text" data-lab-state role="status"></p>`;
  anchor.after(sheet);

  const state = sheet.querySelector<HTMLElement>('[data-lab-state]');
  const lossy = sheet.querySelector<HTMLInputElement>('[data-fault="lossy"]');
  const offlineBox = sheet.querySelector<HTMLInputElement>('[data-fault="offline"]');
  const latencyButtons = [...sheet.querySelectorAll<HTMLButtonElement>('[data-latency]')];
  let shown: Faults | null = null;

  const render = () => {
    if (state === null) return;
    const parts: string[] = [];
    if (shown !== null) {
      if (shown.latencyMs > 0) parts.push(`${shown.latencyMs} ms latency`);
      if (shown.dropNext > 0)
        parts.push(`the next ${shown.dropNext} repl${shown.dropNext === 1 ? 'y' : 'ies'} lost`);
      if (shown.stormNext > 0) parts.push(`the next ${shown.stormNext} requests refused`);
      if (shown.dropRate > 0) parts.push(`${Math.round(shown.dropRate * 100)}% of replies lost`);
    }
    if (offline.on) parts.push('this browser offline');
    state.textContent = parts.length === 0 ? 'No faults.' : `Now: ${parts.join(' · ')}.`;
    for (const b of latencyButtons) {
      b.setAttribute(
        'aria-pressed',
        String(Number(b.dataset['latency']) === (shown?.latencyMs ?? 0)),
      );
    }
    if (lossy) lossy.checked = (shown?.dropRate ?? 0) > 0;
    if (offlineBox) offlineBox.checked = offline.on;
  };
  const send = async (patch: Partial<Faults>) => {
    const read = await client.faults(patch);
    if (read.kind === 'ok') shown = read.value;
    else if (state) state.textContent = 'The lab could not reach the table.';
    render();
  };

  for (const b of latencyButtons) {
    b.addEventListener('click', () => void send({ latencyMs: Number(b.dataset['latency']) }));
  }
  sheet
    .querySelector('[data-fault="drop"]')
    ?.addEventListener('click', () => void send({ dropNext: 1 }));
  sheet
    .querySelector('[data-fault="storm"]')
    ?.addEventListener('click', () => void send({ stormNext: 5 }));
  lossy?.addEventListener('change', () => void send({ dropRate: lossy.checked ? 0.3 : 0 }));
  offlineBox?.addEventListener('change', () => {
    offline.on = offlineBox.checked;
    render();
  });
  sheet.querySelector('[data-fault="reset"]')?.addEventListener('click', () => {
    offline.on = false;
    void send({ latencyMs: 0, dropRate: 0, unavailableRate: 0, dropNext: 0, stormNext: 0 });
  });
  render();
}
