import { describe, expect, it } from 'vitest';
import {
  ACTION_ID,
  CONFIG,
  ERRORS,
  EVENTS,
  INSURANCE_ROUND,
  OPEN_ROUND,
  REPLIES,
  REQUESTS,
  SETTLED_ROUND,
} from './__fixtures__/wire.js';
import {
  ERROR_CODES,
  EVENT_TYPES,
  PUBLISHED_RULES,
  actRequest,
  actionReply,
  classOf,
  dealRequest,
  devDealRequest,
  errorReply,
  fairRecord,
  gameConfig,
  gameEvent,
  historyQuery,
  historyReply,
  httpStatus,
  round,
  roundReply,
  rules,
  sessionReply,
  sessionRequest,
} from './index.js';

/** The issues of a parse that must fail, as readable strings. */
function issues(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((i) => i.message).join('; ');
}

describe('every fixture in docs/protocol.md parses', () => {
  it.each([
    ['session request', sessionRequest, REQUESTS.session],
    ['new session request', sessionRequest, REQUESTS.sessionNew],
    ['deal request', dealRequest, REQUESTS.deal],
    ['act request', actRequest, REQUESTS.act],
    ['history query', historyQuery, REQUESTS.historyQuery],
    ['session reply', sessionReply, REPLIES.session],
    ['resumed session reply', sessionReply, REPLIES.sessionResumed],
    ['deal reply', actionReply, REPLIES.deal],
    ['settling reply', actionReply, REPLIES.settle],
    ['round reply', roundReply, REPLIES.round],
    ['round reply, no round', roundReply, REPLIES.noRound],
    ['history reply', historyReply, REPLIES.history],
    ['fairness record', fairRecord, REPLIES.fair],
    ['an insurance round', round, INSURANCE_ROUND],
    ...Object.entries(ERRORS).map(
      ([name, value]) => [`error: ${name}`, errorReply, value] as const,
    ),
  ] as const)('%s', (_name, schema, value) => {
    const result = schema.safeParse(value);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('has a fixture for every event type, and every fixture is an event', () => {
    const seen = new Set<string>();
    for (const value of Object.values(EVENTS)) seen.add(gameEvent.parse(value).type);
    expect([...seen].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('gives the history query its default limit, from a query string', () => {
    expect(historyQuery.parse({})).toEqual({ limit: 30 });
    expect(historyQuery.parse({ limit: '7' }).limit).toBe(7);
    expect(historyQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(historyQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('invariant 9 — unknown fields are ignored', () => {
  it('strips them rather than refusing', () => {
    const parsed = actRequest.parse({ ...REQUESTS.act, extra: 'from a newer client' });
    expect(parsed).not.toHaveProperty('extra');
  });

  it('drops forceShoe from a production deal and keeps it in a dev one (§9)', () => {
    const forced = { ...REQUESTS.deal, forceShoe: ['9H', 'KS', '9C', '7D'] };
    expect(dealRequest.parse(forced)).not.toHaveProperty('forceShoe');
    expect(devDealRequest.parse(forced).forceShoe).toEqual(['9H', 'KS', '9C', '7D']);
  });
});

describe('invariant 2 — face-down never travels', () => {
  it('refuses an open round that carries the server seed', () => {
    expect(issues(round.safeParse({ ...OPEN_ROUND, serverSeed: '5e'.repeat(32) }))).toMatch(
      /server seed travels only at settlement/,
    );
  });

  it('refuses an open round that shows a second dealer card', () => {
    const leak = { ...OPEN_ROUND, dealer: { cards: ['KS', '7D'], holeHidden: true } };
    expect(issues(round.safeParse(leak))).toMatch(/dealer up card and nothing else/);
  });

  it('refuses an open round with the hole marked visible', () => {
    const leak = { ...OPEN_ROUND, dealer: { cards: ['KS'], holeHidden: false } };
    expect(issues(round.safeParse(leak))).toMatch(/dealer up card and nothing else/);
  });

  it('refuses a holeDealt event that names the card', () => {
    expect(gameEvent.safeParse({ type: 'holeDealt', card: '7D' }).success).toBe(false);
  });
});

describe('the snapshot is consistent with its phase', () => {
  it.each([
    ['without its seed', { serverSeed: undefined }, /reveals its server seed/],
    ['without totalPayout', { totalPayout: undefined }, /carries totalPayout/],
    ['with an action allowed', { allowed: ['hit'] }, /nothing is allowed/],
    ['with an active hand', { activeHand: 0 }, /nothing is active/],
    [
      'with the hole hidden',
      { dealer: { cards: ['KS', '7D'], holeHidden: true } },
      /shows the hole/,
    ],
  ])('refuses a settled round %s', (_name, change, message) => {
    expect(issues(round.safeParse({ ...SETTLED_ROUND, ...change }))).toMatch(message);
  });

  it('refuses a settled hand without its outcome', () => {
    const [first, second] = SETTLED_ROUND.hands;
    const hands = [{ ...first, outcome: undefined }, second];
    expect(issues(round.safeParse({ ...SETTLED_ROUND, hands }))).toMatch(/outcome and a payout/);
  });

  it('refuses an open hand that already has an outcome', () => {
    const hands = [{ ...OPEN_ROUND.hands[0], outcome: 'WIN', payout: 1000 }];
    expect(issues(round.safeParse({ ...OPEN_ROUND, hands }))).toMatch(/no outcome or payout/);
  });

  it.each([
    [
      'a hand decision in INSURANCE',
      { ...INSURANCE_ROUND, allowed: ['hit', 'stand'] },
      /insurance decisions only/,
    ],
    ['an active hand in INSURANCE', { ...INSURANCE_ROUND, activeHand: 0 }, /no hand is active/],
    [
      'decided insurance in INSURANCE',
      { ...INSURANCE_ROUND, insurance: { stake: 250 } },
      /undecided/,
    ],
    [
      'an insurance decision in PLAYER',
      { ...OPEN_ROUND, allowed: ['stand', 'insurance'] },
      /hand decisions/,
    ],
    ['PLAYER without stand', { ...OPEN_ROUND, allowed: ['hit'] }, /stand among them/],
    ['no active hand in PLAYER', { ...OPEN_ROUND, activeHand: null }, /has an active hand/],
    ['an active hand out of range', { ...OPEN_ROUND, activeHand: 2 }, /has an active hand/],
    ['a repeated action', { ...OPEN_ROUND, allowed: ['stand', 'stand'] }, /repeats/],
  ])('refuses %s', (_name, value, message) => {
    expect(issues(round.safeParse(value))).toMatch(message);
  });

  it('refuses a stood hand as the active one', () => {
    const hands = [{ ...OPEN_ROUND.hands[0], state: 'STOOD' }];
    expect(issues(round.safeParse({ ...OPEN_ROUND, hands }))).toMatch(/active hand is PLAYING/);
  });

  it('refuses more than four hands', () => {
    const hands = Array.from({ length: 5 }, () => OPEN_ROUND.hands[0]);
    expect(round.safeParse({ ...OPEN_ROUND, hands }).success).toBe(false);
  });
});

describe('values on the wire', () => {
  it.each([
    ['a card that is not one', { ...EVENTS.cardDealt, card: '1S' }],
    ['a hand index past four hands', { ...EVENTS.cardDealt, to: 4 }],
    ['a fractional amount', { ...EVENTS.handSettled, payout: 10.5 }],
    ['a negative amount', { ...EVENTS.insuranceSettled, payout: -1 }],
    ['an upper-case seed', { ...EVENTS.roundSettled, serverSeed: '5E'.repeat(32) }],
  ])('refuses %s', (_name, value) => {
    expect(gameEvent.safeParse(value).success).toBe(false);
  });

  it.each([
    ['an empty client seed', { ...REQUESTS.deal, clientSeed: '' }],
    ['a 65-character client seed', { ...REQUESTS.deal, clientSeed: 'x'.repeat(65) }],
    ['a non-ASCII client seed', { ...REQUESTS.deal, clientSeed: 'sé' }],
    ['a zero stake', { ...REQUESTS.deal, stake: 0 }],
    ['an upper-case actionId', { ...REQUESTS.deal, actionId: ACTION_ID.toUpperCase() }],
  ])('refuses a deal with %s', (_name, value) => {
    expect(dealRequest.safeParse(value).success).toBe(false);
  });

  it('refuses an action the protocol does not have', () => {
    expect(actRequest.safeParse({ ...REQUESTS.act, action: 'surrender' }).success).toBe(false);
  });
});

describe('GameConfig', () => {
  it('parses the published rules', () => {
    expect(rules.parse(PUBLISHED_RULES)).toEqual(PUBLISHED_RULES);
    expect(gameConfig.parse(CONFIG).rules.maxHands).toBe(4);
  });

  it.each([
    [
      'an odd betUnit',
      { ...CONFIG, betUnit: 101, minBet: 101, maxBet: 10100 },
      /betUnit must be even/,
    ],
    ['a minBet off the unit', { ...CONFIG, minBet: 150 }, /multiple of betUnit/],
    ['minBet above maxBet', { ...CONFIG, minBet: 20000 }, /above maxBet/],
    ['surrender', { ...CONFIG, rules: { ...CONFIG.rules, surrender: true } }, /./],
    ['a table without the peek', { ...CONFIG, rules: { ...CONFIG.rules, peek: false } }, /./],
  ])('refuses %s', (_name, value, message) => {
    expect(issues(gameConfig.safeParse(value))).toMatch(message);
  });
});

describe('errors — the class is a function of the code', () => {
  it('maps every code to exactly one class and one status', () => {
    for (const [cls, codes] of Object.entries(ERROR_CODES)) {
      for (const code of codes) {
        expect(classOf(code)).toBe(cls);
        expect(httpStatus(code)).toBeGreaterThanOrEqual(400);
      }
    }
    expect(httpStatus('MALFORMED')).toBe(400);
    expect(httpStatus('UNKNOWN_SESSION')).toBe(401);
    expect(httpStatus('UNKNOWN_ROUND')).toBe(404);
    expect(httpStatus('STALE_SEQ')).toBe(409);
    expect(httpStatus('INSUFFICIENT_FUNDS')).toBe(422);
    expect(httpStatus('INTERNAL')).toBe(500);
    expect(httpStatus('UNAVAILABLE')).toBe(503);
  });

  it('refuses an error whose class disagrees with its code', () => {
    const wrong = { error: { class: 'SYSTEM', code: 'STALE_SEQ', message: '' }, round: OPEN_ROUND };
    expect(issues(errorReply.safeParse(wrong))).toMatch(/STALE_SEQ is not SYSTEM/);
  });

  it('refuses a CONFLICT without the state that resolves it', () => {
    expect(issues(errorReply.safeParse({ error: ERRORS.stale.error }))).toMatch(
      /carries the round/,
    );
    expect(issues(errorReply.safeParse({ error: ERRORS.commitMismatch.error }))).toMatch(
      /carries the commit/,
    );
  });
});
