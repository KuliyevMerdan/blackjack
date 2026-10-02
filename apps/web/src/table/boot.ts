import type { Client, KeyValue } from '@blackjack/client-core';
import { pictureOf } from '@blackjack/director';
import { Stage, buildAtlas, driveGsapFromTicker, type Insets } from '@blackjack/renderer';
import { Application } from 'pixi.js';
import { feltWords } from '../rules.js';
import { TableController } from './controller.js';
import { intentOf } from './keys.js';
import { loadSettings, saveSettings } from './settings.js';
import { chipLabel, money, mountUi } from './ui.js';

/**
 * The table: one Pixi canvas, the DOM over it, `client-core` wired to both. The atlas is drawn
 * here, at the device's pixel ratio (capped at 3), and its cost is kept for the perf probe.
 */
export async function bootTable(
  stageHost: HTMLElement,
  uiHost: HTMLElement,
  storage: KeyValue,
  client: Client,
): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const stored = loadSettings(
    storage,
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  // `?turbo`, `?reduced` and `?hint` are for links and tests; they override this visit, and are not saved.
  const settings = {
    turbo: params.has('turbo') || stored.turbo,
    reducedMotion: params.has('reduced') || stored.reducedMotion,
    hint: params.has('hint') || stored.hint,
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
    history: () => client.history(),
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
  const config = client.state?.config;
  if (config) stage.setFelt(feltWords(config.rules));

  if (import.meta.env.MODE !== 'production') {
    // The probes' handle (scripts/perf.mjs, scripts/decisions.mjs). Not in a production build.
    Object.assign(window, { __bj: { client, stage, table, app, atlasMs, pictureOf } });
  }
}
