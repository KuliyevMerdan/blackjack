import { Client, type Transport } from '@blackjack/client-core';
import { describe, expect, it } from 'vitest';
import { TabSync, type Channel } from './sync.js';

/** Two tabs, one server: a session, a deal, and a resync that tells the truth as it now stands. */
const COMMIT = 'ab'.repeat(32);
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
const DEALT = {
  roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
  seq: 0,
  phase: 'PLAYER',
  stake: 500,
  commit: COMMIT,
  clientSeed: 'seed',
  dealer: { cards: ['KS'], holeHidden: true },
  hands: [{ cards: ['9H', '9C'], stake: 500, doubled: false, fromSplit: false, state: 'PLAYING' }],
  activeHand: 0,
  allowed: ['hit', 'stand', 'double', 'split'],
  insurance: null,
  totalStake: 500,
};
const EVENTS = [
  { type: 'roundStarted', stake: 500 },
  { type: 'cardDealt', to: 0, card: '9H' },
  { type: 'cardDealt', to: 'dealer', card: 'KS' },
  { type: 'cardDealt', to: 0, card: '9C' },
  { type: 'holeDealt' },
  { type: 'dealerPeeked', blackjack: false },
  { type: 'activeHandChanged', hand: 0 },
];

function server() {
  const state = { round: null as unknown, balance: 100_000, resyncs: 0 };
  const transport: Transport = async ({ path }) => {
    if (path === '/api/session') {
      return {
        status: 200,
        body: {
          token: 'a1'.repeat(32),
          balance: state.balance,
          config: CONFIG,
          commit: COMMIT,
          round: state.round,
        },
      };
    }
    if (path === '/api/deal') {
      state.round = DEALT;
      state.balance = 99_500;
      return {
        status: 200,
        body: { round: DEALT, events: EVENTS, balance: 99_500, commit: COMMIT },
      };
    }
    state.resyncs += 1;
    return { status: 200, body: { round: state.round, balance: state.balance, commit: COMMIT } };
  };
  return { transport, state };
}

/** A broadcast pair: what one posts, the other hears — asynchronously, as a real channel does. */
function channels(): [Channel, Channel] {
  const listeners: ((e: { data: unknown }) => void)[][] = [[], []];
  const make = (me: 0 | 1): Channel => ({
    postMessage: (data) => {
      const other = listeners[me === 0 ? 1 : 0] ?? [];
      setTimeout(() => other.forEach((l) => l({ data })), 0);
    },
    addEventListener: (_type, l) => void listeners[me]?.push(l),
  });
  return [make(0), make(1)];
}

const options = (transport: Transport) => ({
  transport,
  sleep: async () => {},
  random: () => 0.5,
  uuid: () => crypto.randomUUID(),
  clientSeed: () => 'seed',
});
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('two tabs on one session', () => {
  it('a deal in one tab reaches the other through a resync — the server’s word, not the tab’s', async () => {
    const { transport, state } = server();
    const a = new Client(options(transport));
    const b = new Client(options(transport));
    const [ca, cb] = channels();
    new TabSync(a, ca);
    new TabSync(b, cb);
    await a.open();
    await b.open();
    await settle();
    expect(state.resyncs).toBe(0); // the same truth on both: nothing to ask
    await a.deal(500 as never);
    await settle();
    expect(state.resyncs).toBe(1);
    expect(b.state?.round?.roundId).toBe(DEALT.roundId);
    expect(b.state?.balance).toBe(99_500);
  });
});
