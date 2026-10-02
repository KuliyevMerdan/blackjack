import { Client, httpTransport, type KeyValue } from '@blackjack/client-core';
import { NORMAL, TURBO, pictureOf } from '@blackjack/director';
import { Stage, buildAtlas, driveGsapFromTicker } from '@blackjack/renderer';
import { Application } from 'pixi.js';
import './styles.css';
import { TableController } from './table/controller.js';
import { money, mountUi } from './table/ui.js';

/**
 * Boot: one Pixi canvas, the DOM over it, `client-core` wired to both. The atlas is drawn here, at
 * the device's pixel ratio (capped at 3), and its cost is kept for the perf probe.
 */
const stageHost = document.querySelector<HTMLElement>('#stage');
const uiHost = document.querySelector<HTMLElement>('#ui');
if (stageHost === null || uiHost === null) throw new Error('index.html is missing #stage or #ui');

const app = new Application();
await app.init({
  resizeTo: stageHost,
  antialias: true,
  resolution: Math.min(3, window.devicePixelRatio || 1),
  autoDensity: true,
  background: '#0f5132',
});
stageHost.append(app.canvas);
driveGsapFromTicker(app.ticker);

const atlasStarted = performance.now();
const textures = buildAtlas(app.renderer, 96, Math.min(3, window.devicePixelRatio || 1));
const atlasMs = performance.now() - atlasStarted;

const stage = new Stage({
  textures,
  width: stageHost.clientWidth,
  height: stageHost.clientHeight,
  format: money,
});
app.stage.addChild(stage.root);
new ResizeObserver(() => stage.resize(stageHost.clientWidth, stageHost.clientHeight)).observe(
  stageHost,
);

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

const params = new URLSearchParams(window.location.search);
const pace = params.has('turbo') ? TURBO : NORMAL;
let table: TableController | null = null;
const show = mountUi(uiHost, {
  deal: () => void table?.deal(),
  act: (action) => void table?.act(action),
  stake: (direction) => table?.changeStake(direction),
});
table = new TableController(client, stage, show, pace);
show(table.view());

// Skip: a tap on the felt or a key completes the timeline; a hidden tab returns to the end state.
stageHost.addEventListener('pointerdown', () => table?.skip());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' || (event.key === ' ' && event.target === document.body))
    table?.skip();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) table?.skip();
});

await client.open();
table.refresh(); // the open's change landed while the client was still busy

if (import.meta.env.MODE !== 'production') {
  // The perf probe's handle (scripts/perf.mjs). Not in a production build.
  Object.assign(window, { __bj: { client, stage, table, app, atlasMs, pictureOf } });
}
