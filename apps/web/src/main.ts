import { Client, httpTransport, type KeyValue } from '@blackjack/client-core';
import { pictureOf } from '@blackjack/director';
import { Stage, buildAtlas, driveGsapFromTicker, type Insets } from '@blackjack/renderer';
import { Application } from 'pixi.js';
import './styles.css';
import { TableController } from './table/controller.js';
import { intentOf } from './table/keys.js';
import { loadSettings, saveSettings } from './table/settings.js';
import { chipLabel, money, mountUi } from './table/ui.js';

/**
 * Boot: one Pixi canvas, the DOM over it, `client-core` wired to both. The atlas is drawn here, at
 * the device's pixel ratio (capped at 3), and its cost is kept for the perf probe.
 */
const stageHost = document.querySelector<HTMLElement>('#stage');
const uiHost = document.querySelector<HTMLElement>('#ui');
if (stageHost === null || uiHost === null) throw new Error('index.html is missing #stage or #ui');

const storage: KeyValue = {
  get: (key) => window.localStorage.getItem(key),
  set: (key, value) => window.localStorage.setItem(key, value),
};
const params = new URLSearchParams(window.location.search);
const stored = loadSettings(storage, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// `?turbo` and `?reduced` are for links and tests; they override this visit, and are not saved.
const settings = {
  turbo: params.has('turbo') || stored.turbo,
  reducedMotion: params.has('reduced') || stored.reducedMotion,
};

let table: TableController | null = null;
const show = mountUi(uiHost, {
  deal: () => void table?.deal(),
  act: (action) => void table?.act(action),
  chip: (value) => table?.addChip(value),
  clear: () => table?.clearStake(),
  settings: (next) => {
    saveSettings(storage, next);
    table?.configure(next);
  },
});

/** The felt's free band: under the HUD, over the controls — measured, not assumed. */
const insets = (): Insets => {
  const header = uiHost.querySelector('.hud')?.getBoundingClientRect();
  const controls = uiHost.querySelector('.controls')?.getBoundingClientRect();
  return {
    top: Math.ceil((header?.bottom ?? 52) + 6),
    bottom: Math.floor((controls?.top ?? stageHost.clientHeight - 140) - 6),
  };
};

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
  chip: chipLabel,
  insets: insets(),
});
app.stage.addChild(stage.root);
const resize = () => stage.resize(stageHost.clientWidth, stageHost.clientHeight, insets());
new ResizeObserver(resize).observe(stageHost);
const controls = uiHost.querySelector('.controls');
if (controls !== null) new ResizeObserver(resize).observe(controls);

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

table = new TableController(client, stage, show, { settings }, money);
show(table.view());

// Skip: a tap on the felt or a key completes the timeline; a hidden tab returns to the end state.
stageHost.addEventListener('pointerdown', () => table?.skip());
window.addEventListener('keydown', (event) => {
  if (event.repeat) return; // a held key is one press, not a stream of them
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (typing) return;
  const intent = intentOf({
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    onPage: target === document.body || target === null,
  });
  if (intent === null) return;
  event.preventDefault();
  if (intent.kind === 'skip') table?.skip();
  else if (intent.kind === 'deal') void table?.deal();
  else void table?.act(intent.action);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) table?.skip();
});

await client.open();
table.refresh(); // the open's change landed while the client was still busy

if (import.meta.env.MODE !== 'production') {
  // The probes' handle (scripts/perf.mjs, scripts/decisions.mjs). Not in a production build.
  Object.assign(window, { __bj: { client, stage, table, app, atlasMs, pictureOf } });
}
