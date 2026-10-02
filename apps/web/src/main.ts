import { Client, httpTransport, type KeyValue } from '@blackjack/client-core';
import './styles.css';
import { money } from './table/ui.js';

/**
 * Two pages, one bundle entry: the table, and `#/verify/:roundId`. Each is loaded only when asked
 * for — the verification page brings the engine and the table brings Pixi, and neither ships with
 * the other. A change of hash reloads: the two share nothing on screen.
 */
const stageHost = document.querySelector<HTMLElement>('#stage');
const uiHost = document.querySelector<HTMLElement>('#ui');
if (stageHost === null || uiHost === null) throw new Error('index.html is missing #stage or #ui');

const storage: KeyValue = {
  get: (key) => window.localStorage.getItem(key),
  set: (key, value) => window.localStorage.setItem(key, value),
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const client = new Client({
  transport: httpTransport({ baseUrl: '', fetch: (url, init) => fetch(url, init), sleep }),
  sleep,
  random: Math.random,
  uuid: () => crypto.randomUUID(),
  clientSeed: () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
  storage,
  dev: import.meta.env.DEV,
});

window.addEventListener('hashchange', () => window.location.reload());
const verifying = /^#\/verify\/([0-9A-HJKMNP-TV-Z]{26})$/i.exec(window.location.hash);
if (verifying?.[1] !== undefined) {
  stageHost.remove();
  document.body.classList.add('page');
  const { mountVerify } = await import('./verify/page.js');
  await mountVerify(uiHost, verifying[1].toUpperCase(), {
    client,
    format: money,
    instant: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    sleep,
  });
} else {
  const { bootTable } = await import('./table/boot.js');
  await bootTable(stageHost, uiHost, storage, client);
}
