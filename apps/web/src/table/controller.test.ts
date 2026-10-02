import { Client, type Transport } from '@blackjack/client-core';
import type { Playback, Proposal, Proposed, StageCue, StagePicture } from '@blackjack/renderer';
import { describe, expect, it } from 'vitest';
import { TableController, type StageLike, type View } from './controller.js';
import type { Settings } from './settings.js';

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

const DOUBLED = {
  ...base,
  seq: 1,
  phase: 'SETTLED',
  dealer: { cards: ['KS', '7D'], holeHidden: false },
  hands: [
    hand(['9H', '9C', '2D'], {
      stake: 1000,
      doubled: true,
      state: 'DONE',
      outcome: 'WIN',
      payout: 2000,
    }),
  ],
  activeHand: null,
  allowed: [],
  totalStake: 1000,
  totalPayout: 2000,
  serverSeed: '5e'.repeat(32),
};
const DOUBLE_EVENTS = [
  { type: 'handDoubled', hand: 0, stake: 500 },
  { type: 'cardDealt', to: 0, card: '2D' },
  { type: 'handStood', hand: 0, auto: true },
  { type: 'activeHandChanged', hand: null },
  { type: 'holeRevealed', card: '7D' },
  { type: 'handSettled', hand: 0, outcome: 'WIN', payout: 2000 },
  { type: 'roundSettled', totalPayout: 2000, serverSeed: '5e'.repeat(32) },
];

type ActAnswer = 'reply' | 'conflict' | 'refuse' | 'down';

/**
 * A server of a few answers: a session, a deal of 9-9 against a king, and whatever the test says
 * to the act. `gate` holds the act's reply until the test lets it through, so the screen can be
 * read while the request is out. `acts` counts what reached it.
 */
function server(answer: ActAnswer, options: { gate?: Promise<void>; balance?: number } = {}) {
  const seen = { acts: 0, deals: 0 };
  const transport: Transport = async ({ path, body }) => {
    if (path === '/api/session') {
      return {
        status: 200,
        body: {
          token: 'a1'.repeat(32),
          balance: options.balance ?? 100_000,
          config: CONFIG,
          commit: COMMIT,
          round: null,
        },
      };
    }
    if (path === '/api/deal') {
      seen.deals += 1;
      return {
        status: 200,
        body: { round: DEALT, events: DEAL_EVENTS, balance: 99_500, commit: COMMIT },
      };
    }
    if (path === '/api/round') {
      return { status: 200, body: { round: DEALT, balance: 99_500, commit: COMMIT } };
    }
    seen.acts += 1;
    await options.gate;
    const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : '';
    if (answer === 'down') return { status: 503, body: 'proxy says no' };
    if (answer === 'refuse') {
      return {
        status: 422,
        body: {
          error: { class: 'PLAYER', code: 'INSUFFICIENT_FUNDS', message: 'Not enough to double.' },
        },
      };
    }
    if (answer === 'conflict') {
      return {
        status: 409,
        body: {
          error: { class: 'CONFLICT', code: 'STALE_SEQ', message: 'moved' },
          round: SETTLED,
          balance: 100_500,
          commit: NEXT,
        },
      };
    }
    return action === 'double'
      ? {
          status: 200,
          body: { round: DOUBLED, events: DOUBLE_EVENTS, balance: 101_000, commit: NEXT },
        }
      : {
          status: 200,
          body: { round: SETTLED, events: STAND_EVENTS, balance: 100_500, commit: NEXT },
        };
  };
  return { transport, seen };
}

/** A stage that starts cues only when told to. */
class HeldStage implements StageLike {
  rendered: StagePicture[] = [];
  cues: readonly StageCue[] = [];
  private onCue: (cue: StageCue, index: number) => void = () => {};
  private playback: { cue: number; done: boolean; resolve: () => void } | null = null;

  proposals: { move: Proposed; withdrawn: boolean }[] = [];
  speed = 1;

  render(picture: StagePicture): void {
    this.rendered.push(picture);
  }
  propose(move: Proposed): Proposal {
    const entry = { move, withdrawn: false };
    this.proposals.push(entry);
    return { withdraw: () => void (entry.withdrawn = true) };
  }
  setSpeed(speed: number): void {
    this.speed = speed;
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

async function setUp(
  answer: ActAnswer = 'reply',
  options: { gate?: Promise<void>; balance?: number; settings?: Settings } = {},
) {
  const stage = new HeldStage();
  const views: View[] = [];
  const { transport, seen } = server(answer, options);
  const client = new Client({
    transport,
    sleep: async () => {},
    random: () => 0.5,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    clientSeed: () => 'seed',
    retry: { attempts: 2 },
    dev: true,
  });
  const table = new TableController(
    client,
    stage,
    (v) => views.push(v),
    options.settings ? { settings: options.settings } : {},
    (m) => `€${m / 100}`,
  );
  await client.open();
  table.refresh();
  const last = () => views.at(-1) ?? table.view();
  return { stage, table, last, seen, views };
}

/** Deals and plays the deal to its decision. */
async function dealt(answer: ActAnswer = 'reply', options: Parameters<typeof setUp>[1] = {}) {
  const set = await setUp(answer, options);
  await set.table.deal();
  set.stage.finish();
  await tick();
  return set;
}

/** A promise the test resolves by hand. */
function held(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
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

describe('double and split: optimistic in chips only (ADR-0002)', () => {
  it('the chips leave at the press; nothing else moves until the reply', async () => {
    const gate = held();
    const { stage, table, last } = await dealt('reply', { gate: gate.promise });
    const rendered = stage.rendered.length;
    const cues = stage.cues;
    const pressed = table.act('double');
    expect(stage.proposals).toEqual([
      { move: { kind: 'double', hand: 0, stake: 500, ms: 260 }, withdrawn: false },
    ]);
    expect(stage.cues).toBe(cues); // no card scripted before the reply
    expect(stage.rendered).toHaveLength(rendered);
    expect(last().hud).toBe(99_500); // and no money moved
    expect(last().actions).toEqual([]); // every button greys while the request is out
    gate.release();
    await pressed;
    expect(stage.cues[0]?.beat).toEqual({ kind: 'double', hand: 0, stake: 500 });
    expect(stage.proposals[0]?.withdrawn).toBe(false); // the reply's double beat takes them in
  });

  it('a refusal sends the chips back and says why', async () => {
    const { stage, table, last } = await dealt('refuse');
    await table.act('double');
    expect(stage.proposals[0]?.withdrawn).toBe(true);
    expect(last().message).toBe('Not enough to double.');
    expect(last().round?.seq).toBe(0);
    expect(last().actions).toContain('double');
  });

  it('silence sends them back too: the move’s fate is the server’s, and it has not said', async () => {
    const { stage, table, last } = await dealt('down');
    await table.act('split');
    expect(stage.proposals[0]?.move.kind).toBe('split');
    expect(stage.proposals[0]?.withdrawn).toBe(true);
    expect(last().message).toMatch(/not answering/);
  });

  it('a conflict draws the truth as it stands, without the guessed chips', async () => {
    const { stage, table } = await dealt('conflict');
    await table.act('double');
    expect(stage.proposals[0]?.withdrawn).toBe(true);
    expect(stage.rendered.at(-1)?.hands[0]?.doubled).toBe(false);
  });

  it('hit and stand propose nothing', async () => {
    const { stage, table } = await dealt();
    await table.act('stand');
    expect(stage.proposals).toEqual([]);
  });
});

describe('a double tap', () => {
  it('is one request, one proposal — whatever the second press was', async () => {
    const gate = held();
    const { stage, table, seen } = await dealt('reply', { gate: gate.promise });
    const first = table.act('double');
    const second = table.act('double');
    const third = table.act('stand');
    gate.release();
    await Promise.all([first, second, third]);
    expect(seen.acts).toBe(1);
    expect(stage.proposals).toHaveLength(1);
  });

  it('on Deal is one deal', async () => {
    const { table, seen } = await setUp();
    await Promise.all([table.deal(), table.deal()]);
    expect(seen.deals).toBe(1);
  });
});

describe('words', () => {
  it('the peek is said plainly when the dealer does not have it', async () => {
    const { stage, table, last } = await setUp();
    await table.deal();
    const peek = stage.cues.findIndex((c) => c.beat.kind === 'peek');
    stage.advance(peek);
    expect(last().callout).toBeNull();
    stage.advance(1);
    expect(last().callout).toBe('Dealer checked — no blackjack.');
    stage.finish();
    await tick();
    expect(last().prompt).toBe(
      'You have 9, 9 — 18. Dealer shows a king. Hit, stand, double or split?',
    );
  });

  it('the result arrives with the last result’s beat, and is gone at the next Deal', async () => {
    const gate = held();
    const { stage, table, last } = await dealt('reply', { gate: gate.promise });
    gate.release();
    await table.act('stand');
    expect(last().summary).toBeNull(); // the hole card has not turned yet
    stage.finish();
    await tick();
    expect(last().summary).toEqual({
      heading: 'You win',
      totals: 'Staked €5 · returned €10',
      detail: 'Dealer: 17. Your hand: 18, win, €10 back.',
    });
    const next = table.deal();
    expect(last().summary).toBeNull();
    await next;
  });
});

describe('the bet panel', () => {
  it('lights a chip only while it keeps the stake within the maximum and the balance', async () => {
    const { table, last } = await setUp('reply', { balance: 3000 });
    expect(last().chips.map((c) => c.value)).toEqual([100, 500, 2500, 10_000]);
    expect(last().chips.map((c) => c.enabled)).toEqual([true, true, true, false]);
    table.addChip(2500); // 500 + 2,500 = 3,000: the whole balance
    expect(last().stake).toBe(3000);
    expect(last().chips.every((c) => !c.enabled)).toBe(true);
    table.addChip(100);
    expect(last().stake).toBe(3000);
    table.clearStake();
    expect(last().stake).toBe(0);
    expect(last().canDeal).toBe(false);
    table.addChip(100);
    expect(last().canDeal).toBe(true);
  });

  it('brings a remembered stake within the balance', async () => {
    const { last } = await setUp('reply', { balance: 300 });
    expect(last().stake).toBe(300);
    expect(last().canDeal).toBe(true);
  });

  it('does not move while a hand is open', async () => {
    const { table, last } = await dealt();
    table.addChip(100);
    table.clearStake();
    expect(last().stake).toBe(500);
    expect(last().chips.every((c) => !c.enabled)).toBe(true);
  });
});

describe('settings', () => {
  it('turbo is the stage’s speed, set at once; reduced motion is the next script’s pace', async () => {
    const { stage, table } = await setUp('reply', {
      settings: { turbo: true, reducedMotion: false, hint: false },
    });
    expect(stage.speed).toBe(2.5);
    table.configure({ turbo: false, reducedMotion: true, hint: false });
    expect(stage.speed).toBe(1);
    await table.deal();
    expect(stage.cues.every((c) => c.ms === 0)).toBe(true);
    expect(stage.cues.some((c) => (c.hold ?? 0) > 0)).toBe(true);
  });
});

describe('insurance under an ace', () => {
  const OFFERED = {
    ...base,
    seq: 0,
    phase: 'INSURANCE',
    dealer: { cards: ['AS'], holeHidden: true },
    hands: [hand(['9H', '7C'])],
    activeHand: null,
    allowed: ['insurance', 'noInsurance'],
    totalStake: 500,
  };
  const INSURED = {
    ...OFFERED,
    seq: 1,
    phase: 'PLAYER',
    activeHand: 0,
    allowed: ['hit', 'stand', 'double'],
    insurance: { stake: 250, payout: 0 },
    totalStake: 750,
  };
  const transport: Transport = async ({ path }) => {
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
      const events = [
        { type: 'roundStarted', stake: 500 },
        { type: 'cardDealt', to: 0, card: '9H' },
        { type: 'cardDealt', to: 'dealer', card: 'AS' },
        { type: 'cardDealt', to: 0, card: '7C' },
        { type: 'holeDealt' },
        { type: 'insuranceOffered' },
      ];
      return { status: 200, body: { round: OFFERED, events, balance: 99_500, commit: COMMIT } };
    }
    const events = [
      { type: 'insuranceDecided', stake: 250 },
      { type: 'dealerPeeked', blackjack: false },
      { type: 'insuranceSettled', payout: 0 },
      { type: 'activeHandChanged', hand: 0 },
    ];
    return { status: 200, body: { round: INSURED, events, balance: 99_250, commit: COMMIT } };
  };

  it('offers the pair, then says the peek and what insurance came to — both', async () => {
    const stage = new HeldStage();
    const views: View[] = [];
    const client = new Client({
      transport,
      sleep: async () => {},
      random: () => 0.5,
      uuid: () => '00000000-0000-4000-8000-000000000002',
      clientSeed: () => 'seed',
      dev: true,
    });
    const table = new TableController(
      client,
      stage,
      (v) => views.push(v),
      {},
      (m) => `€${m / 100}`,
    );
    await client.open();
    await table.deal();
    stage.finish();
    await tick();
    const last = () => views.at(-1) ?? table.view();
    expect(last().actions).toEqual(['insurance', 'noInsurance']);
    expect(last().callout).toBe('The dealer shows an ace. Insurance?');
    expect(last().prompt).toBe('Dealer shows an ace. Take insurance or no insurance?');
    await table.act('insurance');
    expect(last().callout).toBeNull(); // the press cleared the offer; the reply has not played yet
    stage.finish();
    await tick();
    expect(last().callout).toBe('Dealer checked — no blackjack. Insurance lost.');
    expect(last().actions).toEqual(['hit', 'stand', 'double']);
    expect(stage.proposals).toEqual([]); // insurance is not one of the optimistic moves
  });
});

describe('the strategy hint', () => {
  it('marks basic strategy’s move once the decision is on screen — and only when asked', async () => {
    const on = await dealt('reply', {
      settings: { turbo: false, reducedMotion: false, hint: true },
    });
    expect(on.last().hint).toBe('stand'); // 9-9 against a king: stand
    const off = await dealt();
    expect(off.last().hint).toBeNull();
  });

  it('is gone while the gate is shut', async () => {
    const { table, last } = await setUp('reply', {
      settings: { turbo: false, reducedMotion: false, hint: true },
    });
    await table.deal();
    expect(last().hint).toBeNull();
  });
});

describe('a hidden tab', () => {
  it('draws a reply as it stands — no script waiting for frames the browser will not give', async () => {
    const stage = new HeldStage();
    const { transport } = server('reply');
    const client = new Client({
      transport,
      sleep: async () => {},
      random: () => 0.5,
      uuid: () => '00000000-0000-4000-8000-000000000003',
      clientSeed: () => 'seed',
    });
    let hidden = true;
    const views: View[] = [];
    const table = new TableController(client, stage, (v) => views.push(v), {
      hidden: () => hidden,
    });
    await client.open();
    await table.deal();
    expect(stage.cues).toEqual([]); // nothing played
    expect(stage.rendered.at(-1)?.hands[0]?.cards).toEqual(['9H', '9C']);
    expect(table.view().gateOpen).toBe(true);
    expect(table.view().hud).toBe(99_500);
    hidden = false;
    await table.act('stand');
    expect(stage.cues.length).toBeGreaterThan(0); // in view again: played
  });
});

describe('a request the table did not make', () => {
  it('greys the buttons while it is out, and lights them again when it ends', async () => {
    const { table, last } = await dealt();
    expect(last().actions).toContain('stand');
    const resync = table['client'].resync(); // as another tab's news or a tab back in view does
    expect(last().actions).toEqual([]);
    await resync;
    expect(last().actions).toContain('stand');
  });
});
