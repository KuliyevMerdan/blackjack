import { describe, expect, it } from 'vitest';
import { BEFORE_DOUBLE, EVENTS, REPLIES } from './__fixtures__/wire.js';
import { actionReply } from './api.js';
import { gameEvent } from './events.js';
import { FoldError, fold, tableOf } from './fold.js';
import { round } from './round.js';

/**
 * Invariant 6 on the hand-written fixtures. The engine's suite asserts the same property on every
 * step of 100,000 hands; these pin the reading of each event to the document.
 */
describe('fold — the events prove the snapshot', () => {
  it('folds a deal from nothing into its snapshot', () => {
    const reply = actionReply.parse(REPLIES.deal);
    expect(fold(null, reply.events)).toEqual(tableOf(reply.round));
  });

  it('folds a double, the dealer and settlement onto the snapshot it was decided on', () => {
    const reply = actionReply.parse(REPLIES.settle);
    expect(fold(round.parse(BEFORE_DOUBLE), reply.events)).toEqual(tableOf(reply.round));
  });

  it('starts over at roundStarted, whatever came before', () => {
    const deal = actionReply.parse(REPLIES.deal);
    const settled = actionReply.parse(REPLIES.settle).round;
    expect(fold(settled, deal.events)).toEqual(tableOf(deal.round));
  });

  it('reads a natural off the cards: BLACKJACK for a dealt hand, not for a split one', () => {
    const events = [
      EVENTS.roundStarted,
      { type: 'cardDealt', to: 0, card: 'AS' },
      { type: 'cardDealt', to: 'dealer', card: '7H' },
      { type: 'cardDealt', to: 0, card: 'KD' },
      EVENTS.holeDealt,
    ].map((e) => gameEvent.parse(e));
    expect(fold(null, events).hands[0]?.state).toBe('BLACKJACK');

    const split = actionReply.parse(REPLIES.deal);
    const after = fold(
      split.round,
      [
        { type: 'handSplit', hand: 0, newHand: 1, stake: 500 },
        { type: 'cardDealt', to: 0, card: 'AS' },
      ].map((e) => gameEvent.parse(e)),
    );
    // 9 + A is 20, but a split hand's two-card 21 would not be a blackjack either.
    expect(after.hands.map((h) => h.state)).toEqual(['PLAYING', 'PLAYING']);
  });

  it('tells a stand from a hand that stopped on its own', () => {
    const reply = actionReply.parse(REPLIES.deal);
    const stood = fold(reply.round, [gameEvent.parse({ type: 'handStood', hand: 0, auto: false })]);
    const done = fold(reply.round, [gameEvent.parse({ type: 'handStood', hand: 0, auto: true })]);
    expect(stood.hands[0]?.state).toBe('STOOD');
    expect(done.hands[0]?.state).toBe('DONE');
  });

  it('leaves its input alone', () => {
    const before = round.parse(BEFORE_DOUBLE);
    const copy = structuredClone(before);
    fold(before, actionReply.parse(REPLIES.settle).events);
    expect(before).toEqual(copy);
  });

  it('refuses events with no round under them, and events naming hands that do not exist', () => {
    expect(() => fold(null, [])).toThrow(FoldError);
    expect(() => fold(null, [gameEvent.parse(EVENTS.holeDealt)])).toThrow(/before roundStarted/);
    const deal = actionReply.parse(REPLIES.deal);
    expect(() => fold(deal.round, [gameEvent.parse(EVENTS.handBusted)])).toThrow(/no hand 2/);
    expect(() => fold(deal.round, [gameEvent.parse(EVENTS.insuranceSettled)])).toThrow(
      /never taken/,
    );
  });
});
