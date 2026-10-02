/**
 * Hand-written wire fixtures — one of every request, reply, event and error in docs/protocol.md,
 * as JSON would arrive. Written from the document, so a schema that disagrees with it fails here.
 */

export const TOKEN = 'a1'.repeat(32);
export const COMMIT = '3c'.repeat(32);
export const NEXT_COMMIT = '4d'.repeat(32);
export const SERVER_SEED = '5e'.repeat(32);
export const ROUND_ID = '01K6H3Z8Q4M2V7XKX0C9T5RB1N';
export const ACTION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

export const RULES = {
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

export const CONFIG = { currency: 'EUR', betUnit: 100, minBet: 100, maxBet: 10000, rules: RULES };

/** A pair of nines against a king, waiting on the player. */
export const OPEN_ROUND = {
  roundId: ROUND_ID,
  seq: 0,
  phase: 'PLAYER',
  stake: 500,
  commit: COMMIT,
  clientSeed: 'player-seed',
  dealer: { cards: ['KS'], holeHidden: true },
  hands: [{ cards: ['9H', '9C'], stake: 500, doubled: false, fromSplit: false, state: 'PLAYING' }],
  activeHand: 0,
  allowed: ['hit', 'stand', 'double', 'split'],
  insurance: null,
  totalStake: 500,
};

/** An ace up: the round waits on insurance. */
export const INSURANCE_ROUND = {
  ...OPEN_ROUND,
  dealer: { cards: ['AS'], holeHidden: true },
  hands: [{ cards: ['TH', '9C'], stake: 500, doubled: false, fromSplit: false, state: 'PLAYING' }],
  phase: 'INSURANCE',
  activeHand: null,
  allowed: ['insurance', 'noInsurance'],
};

/** The nines split, the second doubled, the dealer drew to 17. */
export const SETTLED_ROUND = {
  ...OPEN_ROUND,
  seq: 3,
  phase: 'SETTLED',
  dealer: { cards: ['KS', '7D'], holeHidden: false },
  hands: [
    {
      cards: ['9H', 'TD'],
      stake: 500,
      doubled: false,
      fromSplit: true,
      state: 'STOOD',
      outcome: 'WIN',
      payout: 1000,
    },
    {
      cards: ['9C', '2S', '8H'],
      stake: 1000,
      doubled: true,
      fromSplit: true,
      state: 'DONE',
      outcome: 'WIN',
      payout: 2000,
    },
  ],
  activeHand: null,
  allowed: [],
  totalStake: 1500,
  totalPayout: 3000,
  serverSeed: SERVER_SEED,
};

/** The nines split, the first stood on 19, the second drawn to 11 — the double comes next. */
export const BEFORE_DOUBLE = {
  ...OPEN_ROUND,
  seq: 2,
  hands: [
    { cards: ['9H', 'TD'], stake: 500, doubled: false, fromSplit: true, state: 'STOOD' },
    { cards: ['9C', '2S'], stake: 500, doubled: false, fromSplit: true, state: 'PLAYING' },
  ],
  activeHand: 1,
  allowed: ['hit', 'stand', 'double'],
  totalStake: 1000,
};

export const EVENTS = {
  roundStarted: { type: 'roundStarted', stake: 500 },
  cardDealt: { type: 'cardDealt', to: 0, card: '9H' },
  cardDealtDealer: { type: 'cardDealt', to: 'dealer', card: 'KS' },
  holeDealt: { type: 'holeDealt' },
  insuranceOffered: { type: 'insuranceOffered' },
  insuranceDecided: { type: 'insuranceDecided', stake: 250 },
  dealerPeeked: { type: 'dealerPeeked', blackjack: false },
  handSplit: { type: 'handSplit', hand: 0, newHand: 1, stake: 500 },
  handDoubled: { type: 'handDoubled', hand: 1, stake: 500 },
  handStood: { type: 'handStood', hand: 0, auto: false },
  handBusted: { type: 'handBusted', hand: 2 },
  activeHandChanged: { type: 'activeHandChanged', hand: 1 },
  activeHandCleared: { type: 'activeHandChanged', hand: null },
  holeRevealed: { type: 'holeRevealed', card: '7D' },
  handSettled: { type: 'handSettled', hand: 0, outcome: 'WIN', payout: 1000 },
  insuranceSettled: { type: 'insuranceSettled', payout: 0 },
  roundSettled: { type: 'roundSettled', totalPayout: 3000, serverSeed: SERVER_SEED },
};

export const REQUESTS = {
  session: { token: TOKEN },
  sessionNew: {},
  deal: { actionId: ACTION_ID, stake: 500, clientSeed: 'player-seed', commit: COMMIT },
  act: { actionId: ACTION_ID, roundId: ROUND_ID, seq: 0, action: 'split' },
  historyQuery: { limit: '30', before: ROUND_ID },
};

export const REPLIES = {
  session: { token: TOKEN, balance: 100000, config: CONFIG, commit: COMMIT, round: null },
  sessionResumed: {
    token: TOKEN,
    balance: 99500,
    config: CONFIG,
    commit: COMMIT,
    round: OPEN_ROUND,
  },
  deal: {
    round: OPEN_ROUND,
    events: [
      EVENTS.roundStarted,
      { type: 'cardDealt', to: 0, card: '9H' },
      EVENTS.cardDealtDealer,
      { type: 'cardDealt', to: 0, card: '9C' },
      EVENTS.holeDealt,
      { type: 'activeHandChanged', hand: 0 },
    ],
    balance: 99500,
    commit: COMMIT,
  },
  settle: {
    round: SETTLED_ROUND,
    events: [
      EVENTS.handDoubled,
      { type: 'cardDealt', to: 1, card: '8H' },
      { type: 'handStood', hand: 1, auto: true },
      { type: 'activeHandChanged', hand: null },
      EVENTS.holeRevealed,
      { type: 'handSettled', hand: 0, outcome: 'WIN', payout: 1000 },
      { type: 'handSettled', hand: 1, outcome: 'WIN', payout: 2000 },
      EVENTS.roundSettled,
    ],
    balance: 101500,
    commit: NEXT_COMMIT,
  },
  round: { round: OPEN_ROUND, balance: 99500, commit: COMMIT },
  noRound: { round: null, balance: 100000, commit: COMMIT },
  history: {
    rounds: [
      {
        roundId: ROUND_ID,
        settledAt: 1759400000000,
        stake: 500,
        totalStake: 1500,
        totalPayout: 3000,
        dealer: ['KS', '7D'],
        hands: [
          ['9H', 'TD'],
          ['9C', '2S', '8H'],
        ],
      },
    ],
  },
  fair: {
    roundId: ROUND_ID,
    settledAt: 1759400000000,
    rules: RULES,
    commit: COMMIT,
    serverSeed: SERVER_SEED,
    clientSeed: 'player-seed',
    stake: 500,
    decisions: [
      { seq: 0, action: 'split' },
      { seq: 1, action: 'stand' },
      { seq: 2, action: 'double' },
    ],
    dealt: ['9H', 'KS', '9C', '7D', 'TD', '2S', '8H'],
    round: SETTLED_ROUND,
  },
};

export const ERRORS = {
  player: {
    error: { class: 'PLAYER', code: 'INSUFFICIENT_FUNDS', message: 'Not enough to double.' },
  },
  malformed: {
    error: { class: 'PLAYER', code: 'MALFORMED', message: 'clientSeed: not 1–64 printable ASCII' },
  },
  session: { error: { class: 'SESSION', code: 'UNKNOWN_SESSION', message: 'Session not known.' } },
  stale: {
    error: { class: 'CONFLICT', code: 'STALE_SEQ', message: 'The hand moved on.' },
    round: OPEN_ROUND,
    balance: 99500,
  },
  noOpenRound: {
    error: { class: 'CONFLICT', code: 'NO_OPEN_ROUND', message: 'No hand is open.' },
    round: null,
    balance: 100000,
  },
  commitMismatch: {
    error: { class: 'CONFLICT', code: 'COMMIT_MISMATCH', message: 'A new commit was published.' },
    commit: NEXT_COMMIT,
  },
  system: { error: { class: 'SYSTEM', code: 'UNAVAILABLE', message: 'Try again.' } },
};
