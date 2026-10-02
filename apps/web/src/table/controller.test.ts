import { Client, type Transport } from '@blackjack/client-core';
import { NORMAL } from '@blackjack/director';
import type { Playback, StageCue, StagePicture } from '@blackjack/renderer';
import { describe, expect, it } from 'vitest';
import { TableController, type StageLike, type View } from './controller.js';

/**
 * The decision gate and the beat-gated HUD (ADR-0002), against a stage whose clock the test holds:
 * cues start only when the test says so.
 */

const COMMIT = 'ab'.repeat(32);
const NEXT = 'cd'.repeat(32);
const RULES = {
  decks: 6,
  dealerHitsSoft17: false,
  blackjackPays: [3, 2],
  peek: true,
  insurance: true,
  doubleOn: 'ANY_TWO',
  doubleAfterSplit: true,
  maxHands: 4,
  splitBy: 'VALUE',
  resplitAces: false,
  hitSplitAces: false,
  surrender: false,
  autoStandOn21: true,
};
const CONFIG = { currency: 'EUR', betUnit: 100, minBet: 100, maxBet: 10_000, rules: RULES };
const base = {
  roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
  stake: 500,
  commit: COMMIT,
  clientSeed: 'seed',
  insurance: null,
};
const hand = (cards: string[], extra: object = {}) => ({
  cards,
  stake: 500,
  doubled: false,
  fromSplit: false,
  state: 'PLAYING',
  ...extra,
});
const DEALT = {
  ...base,
  seq: 0,
  phase: 'PLAYER',
  dealer: { cards: ['KS'], holeHidden: true },
  hands: [hand(['9H', '9C'])],
  activeHand: 0,
  allowed: ['hit', 'stand', 'double', 'split'],
  totalStake: 500,
};
const SETTLED = {
  ...base,
  seq: 1,
  phase: 'SETTLED',
  dealer: { cards: ['KS', '7D'], holeHidden: false },
  hands: [hand(['9H', '9C'], { state: 'STOOD', outcome: 'WIN', payout: 1000 })],
  activeHand: null,
  allowed: [],
  totalStake: 500,
  totalPayout: 1000,
  serverSeed: '5e'.repeat(32),
};
const DEAL_EVENTS = [
  { type: 'roundStarted', stake: 500 },
  { type: 'cardDealt', to: 0, card: '9H' },
  { type: 'cardDealt', to: 'dealer', card: 'KS' },
  { type: 'cardDealt', to: 0, card: '9C' },
  { type: 'holeDealt' },
  { type: 'dealerPeeked', blackjack: false },
  { type: 'activeHandChanged', hand: 0 },
];
const STAND_EVENTS = [
  { type: 'handStood', hand: 0, auto: false },
  { type: 'activeHandChanged', hand: null },
  { type: 'holeRevealed', card: '7D' },
  { type: 'handSettled', hand: 0, outcome: 'WIN', payout: 1000 },
  { type: 'roundSettled', totalPayout: 1000, serverSeed: '5e'.repeat(32) },
];

/** A server of three answers: a session, a deal, and either a stand or a conflict. */
function server(standAnswer: 'reply' | 'conflict'): Transport {
  return async ({ path }) => {
    if (path === '/api/session') {
      return {
        status: 200,
        body: {
          token: 'a1'.repeat(32),
          balance: 100_000,
          config: CONFIG,
          commit: COMMIT,
          round: null,
        },
      };
    }
    if (path === '/api/deal') {
      return {
        status: 200,
        body: { round: DEALT, events: DEAL_EVENTS, balance: 99_500, commit: COMMIT },
      };
    }
    return standAnswer === 'reply'
      ? {
          status: 200,
          body: { round: SETTLED, events: STAND_EVENTS, balance: 100_500, commit: NEXT },
        }
      : {
          status: 409,
          body: {
            error: { class: 'CONFLICT', code: 'STALE_SEQ', message: 'moved' },
            round: SETTLED,
            balance: 100_500,
            commit: NEXT,
          },
        };
  };
}

/** A stage that starts cues only when told to. */
class HeldStage implements StageLike {
  rendered: StagePicture[] = [];
  cues: readonly StageCue[] = [];
  private onCue: (cue: StageCue, index: number) => void = () => {};
  private playback: { cue: number; done: boolean; resolve: () => void } | null = null;

  render(picture: StagePicture): void {
    this.rendered.push(picture);
  }
  play(
    cues: readonly StageCue[],
    onCue: (cue: StageCue, index: number) => void = () => {},
  ): Playback {
    this.cues = cues;
    this.onCue = onCue;
    let resolve: () => void = () => {};
    const finished = new Promise<void>((r) => (resolve = r));
    const state = { cue: -1, done: false, resolve };
    this.playback = state;
    return {
      get cue() {
        return state.cue;
      },
      get done() {
        return state.done;
      },
      finished,
      skip: () => this.advance(cues.length),
    };
  }
  /** Starts the next `n` cues; the last one ends the playback. */
  advance(n: number): void {
    const p = this.playback;
    if (p === null) return;
    for (let i = 0; i < n && p.cue < this.cues.length - 1; i += 1) {
      p.cue += 1;
      const cue = this.cues[p.cue];
      if (cue) this.onCue(cue, p.cue);
    }
    if (p.cue >= this.cues.length - 1 && !p.done) {
      p.done = true;
      p.resolve();
    }
  }
  finish(): void {
    this.advance(this.cues.length);
  }
}

async function setUp(standAnswer: 'reply' | 'conflict' = 'reply') {
  const stage = new HeldStage();
  const views: View[] = [];
  const client = new Client({
    transport: server(standAnswer),
    sleep: async () => {},
    random: () => 0.5,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    clientSeed: () => 'seed',
    dev: true,
  });
  const table = new TableController(client, stage, (v) => views.push(v), NORMAL);
  await client.open();
  table.refresh();
  const last = () => views.at(-1) ?? table.view();
  return { stage, table, last };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the decision gate', () => {
  it('stays shut while the deal plays, and opens on the decision beat', async () => {
    const { stage, table, last } = await setUp();
    await table.deal();
    expect(last().gateOpen).toBe(false);
    expect(last().actions).toEqual([]);
    stage.advance(stage.cues.length - 2); // the second card is down, the decision is not yet
    expect(last().actions).toEqual([]);
    stage.advance(2);
    await tick();
    expect(last().gateOpen).toBe(true);
    expect(last().actions).toEqual(['hit', 'stand', 'double', 'split']);
  });

  it('a press while the gate is shut sends nothing', async () => {
    const { stage, table, last } = await setUp();
    await table.deal();
    await table.act('stand');
    expect(last().round?.seq).toBe(0); // still the deal's round: nothing was sent
    stage.finish();
  });
});

describe('the beat-gated HUD', () => {
  it('shows the stake gone at once, and the win only when its result plays', async () => {
    const { stage, table, last } = await setUp();
    await table.deal();
    stage.finish();
    await tick();
    expect(last().hud).toBe(99_500);
    await table.act('stand');
    expect(last().hud).toBe(99_500); // the reply says 100,500; the card has not turned yet
    const settle = stage.cues.findIndex((c) => c.beat.kind === 'settle');
    stage.advance(settle);
    expect(last().hud).toBe(99_500);
    stage.advance(1);
    expect(last().hud).toBe(100_500);
  });

  it('jumps straight to the truth on a skip', async () => {
    const { stage, table, last } = await setUp();
    await table.deal();
    stage.finish();
    await table.act('stand');
    table.skip();
    await tick();
    expect(last().hud).toBe(100_500);
    expect(last().gateOpen).toBe(true);
  });
});

describe('a conflict', () => {
  it('is drawn as it stands — no script — and said in words', async () => {
    const { stage, table, last } = await setUp('conflict');
    await table.deal();
    stage.finish();
    await tick();
    const plays = stage.cues;
    await table.act('stand');
    expect(stage.cues).toBe(plays); // nothing new was played
    expect(stage.rendered.at(-1)?.dealer).toEqual(['KS', '7D']);
    expect(last().message).toMatch(/moved on/);
    expect(last().hud).toBe(100_500);
  });
});
