import { isAce, isTenValue, sameValue, value, type Card } from '@blackjack/cards';
import { ZERO, add, half, payout, sub, sum, type Minor } from '@blackjack/money';
import {
  ACTIONS,
  type Action,
  type GameEvent,
  type Hand,
  type Round,
  type Rules,
} from '@blackjack/protocol';
import type { Command, Deal, Refusal, State, Step } from './state.js';

/**
 * The round machine (docs/protocol.md §3.3, §4). One call is one server step: a deal, or one
 * decision and everything that follows from it without another decision — the next hand's card,
 * the dealer's play, settlement. `step` returns the new state and the events that made it; it
 * never emits, writes or waits. Same state, command and shoe in, same result out, on any runtime.
 */
export function step(state: State | null, command: Command, shoe: readonly Card[]): Step {
  switch (command.type) {
    case 'deal':
      if (state !== null && state.phase !== 'SETTLED') return refuse('ROUND_OPEN');
      return deal(command, shoe);
    case 'act':
      return act(state, command.action, shoe);
    default: {
      const unhandled: never = command;
      throw new TypeError(`unknown command ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Places the stake and deals: player, dealer up, player, dealer hole (§3.3). The round then waits on
 * insurance under an ace; otherwise the dealer peeks under a ten-value, and a blackjack on either
 * side settles the round in this same step (§4.3).
 */
export function deal(command: Deal, shoe: readonly Card[]): Step {
  const { rules, stake, balance } = command;
  if (balance < stake) return refuse('INSUFFICIENT_FUNDS');
  // Every amount this stake can produce, computed now: an inexact one is a config bug, and it
  // fails at the deal rather than at a settlement with cards already on the table (§4.4).
  blackjackPayout(rules, stake);
  half(stake);

  const t = new Table(
    {
      rules,
      seeds: command.seeds,
      seq: 0,
      phase: 'PLAYER',
      stake,
      dealer: [],
      holeHidden: false,
      hands: [{ cards: [], stake, doubled: false, fromSplit: false, state: 'PLAYING' }],
      activeHand: null,
      insurance: null,
      cursor: 0,
      balance: sub(balance, stake),
      totalPayout: null,
    },
    shoe,
  );
  t.emit({ type: 'roundStarted', stake });
  t.dealTo(0);
  t.dealToDealer();
  t.dealTo(0);
  t.dealHole();

  const up = t.upCard();
  if (isAce(up) && rules.insurance) {
    t.phase = 'INSURANCE';
    t.emit({ type: 'insuranceOffered' });
    return t.done();
  }
  if (isAce(up) || isTenValue(up)) {
    if (t.peek()) {
      t.reveal();
      t.settle();
      return t.done();
    }
  }
  t.afterPeek();
  return t.done();
}

/** One player decision on the open round. Anything outside `allowed(state)` is refused. */
export function act(state: State | null, action: Action, shoe: readonly Card[]): Step {
  if (state === null || state.phase === 'SETTLED') return refuse('NO_OPEN_ROUND');
  if (!allowed(state).includes(action)) return refuse('ACTION_NOT_ALLOWED');

  const t = new Table({ ...state, seq: state.seq + 1 }, shoe);
  switch (action) {
    case 'insurance':
    case 'noInsurance':
      t.decideInsurance(action === 'insurance');
      break;
    case 'hit':
      t.hit(t.active());
      break;
    case 'stand':
      t.stand(t.active());
      break;
    case 'double':
      t.double(t.active());
      break;
    case 'split':
      t.split(t.active());
      break;
    default: {
      const unhandled: never = action;
      throw new TypeError(`unknown action ${JSON.stringify(unhandled)}`);
    }
  }
  return t.done();
}

/**
 * The decisions open to the player, in `ACTIONS` order (docs/protocol.md §4.2). Exact: `act`
 * accepts every action in it and refuses every action outside it, because this is the check `act`
 * makes.
 */
export function allowed(state: State): Action[] {
  switch (state.phase) {
    case 'SETTLED':
      return [];
    case 'INSURANCE': {
      const affordable = state.balance >= half(state.stake);
      return ACTIONS.filter((a) => a === 'noInsurance' || (a === 'insurance' && affordable));
    }
    case 'PLAYER': {
      const hand = activeHand(state);
      const { rules } = state;
      const pair = hand.cards.length === 2;
      const lockedAce = isSplitAce(hand) && !rules.hitSplitAces;
      const covers = state.balance >= hand.stake;
      const can: Record<Action, boolean> = {
        hit: !lockedAce,
        stand: true,
        double: pair && !lockedAce && covers && (!hand.fromSplit || rules.doubleAfterSplit),
        split:
          pair &&
          isPair(hand.cards) &&
          state.hands.length < rules.maxHands &&
          !(isSplitAce(hand) && !rules.resplitAces) &&
          covers,
        insurance: false,
        noInsurance: false,
      };
      return ACTIONS.filter((a) => can[a]);
    }
    default: {
      const unhandled: never = state.phase;
      throw new TypeError(`unknown phase ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The snapshot a client may see (docs/protocol.md §2.7): the hole card absent while it is face
 * down, the server seed absent until settlement, `allowed` computed for the decision in front of
 * the player. The only door from `State` to the wire.
 */
export function view(state: State): Round {
  const { seeds } = state;
  const totalStake = sum([
    ...state.hands.map((h) => h.stake),
    ...(state.insurance === null ? [] : [state.insurance.stake]),
  ]);
  return {
    roundId: seeds.roundId,
    seq: state.seq,
    phase: state.phase,
    stake: state.stake,
    commit: seeds.commit,
    clientSeed: seeds.clientSeed,
    dealer: {
      cards: state.holeHidden ? state.dealer.slice(0, 1) : [...state.dealer],
      holeHidden: state.holeHidden,
    },
    hands: state.hands.map((h) => ({ ...h, cards: [...h.cards] })),
    activeHand: state.activeHand,
    allowed: allowed(state),
    insurance: state.insurance === null ? null : { ...state.insurance },
    totalStake,
    ...(state.totalPayout === null ? {} : { totalPayout: state.totalPayout }),
    ...(state.phase === 'SETTLED' ? { serverSeed: seeds.serverSeed } : {}),
    ...(seeds.forced ? { forced: true } : {}),
  };
}

/** Every card the round has taken from the shoe, in shoe order — the fairness record's `dealt`. */
export function dealt(state: State, shoe: readonly Card[]): Card[] {
  return shoe.slice(0, state.cursor);
}

/** The most a round at this stake can put at risk: every hand split and doubled, and insurance. */
export function maxExposure(rules: Rules, stake: Minor): Minor {
  return payout(stake, 4 * rules.maxHands + 1, 2);
}

function refuse(refusal: Refusal): Step {
  return { ok: false, refusal };
}

function blackjackPayout(rules: Rules, stake: Minor): Minor {
  const [numerator, denominator] = rules.blackjackPays;
  return payout(stake, numerator + denominator, denominator);
}

function isSplitAce(hand: Hand): boolean {
  const first = hand.cards[0];
  return hand.fromSplit && first !== undefined && isAce(first);
}

function isPair(cards: readonly Card[]): boolean {
  const [a, b] = cards;
  return a !== undefined && b !== undefined && sameValue(a, b);
}

function activeHand(state: State): Hand {
  const hand = state.activeHand === null ? undefined : state.hands[state.activeHand];
  if (hand === undefined) throw new EngineError(`no active hand at ${state.activeHand}`);
  return hand;
}

/** A broken invariant inside the engine, or a shoe too short for the round — never a player error. */
export class EngineError extends Error {
  override readonly name = 'EngineError';
}

/**
 * One step's working copy of the round. It deals from the shoe, moves money and records events as
 * it goes, and `done()` freezes it into the next `State`. Lives for one call; never escapes.
 */
class Table {
  readonly events: GameEvent[] = [];
  readonly rules: Rules;
  phase: State['phase'];
  dealer: Card[];
  holeHidden: boolean;
  hands: Hand[];
  activeHand: number | null;
  insurance: Round['insurance'];
  cursor: number;
  balance: Minor;
  totalPayout: Minor | null;

  constructor(
    private readonly base: State,
    private readonly shoe: readonly Card[],
  ) {
    this.rules = base.rules;
    this.phase = base.phase;
    this.dealer = [...base.dealer];
    this.holeHidden = base.holeHidden;
    this.hands = base.hands.map((h) => ({ ...h, cards: [...h.cards] }));
    this.activeHand = base.activeHand;
    this.insurance = base.insurance === null ? null : { ...base.insurance };
    this.cursor = base.cursor;
    this.balance = base.balance;
    this.totalPayout = base.totalPayout;
  }

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  done(): Step {
    const state: State = {
      rules: this.rules,
      seeds: this.base.seeds,
      seq: this.base.seq,
      phase: this.phase,
      stake: this.base.stake,
      dealer: this.dealer,
      holeHidden: this.holeHidden,
      hands: this.hands,
      activeHand: this.activeHand,
      insurance: this.insurance,
      cursor: this.cursor,
      balance: this.balance,
      totalPayout: this.totalPayout,
    };
    return { ok: true, state, events: this.events };
  }

  // ── cards ────────────────────────────────────────────────────────────────────────────────

  private draw(): Card {
    const card = this.shoe[this.cursor];
    if (card === undefined) throw new EngineError(`the shoe ran out at position ${this.cursor}`);
    this.cursor += 1;
    return card;
  }

  hand(index: number): Hand {
    const hand = this.hands[index];
    if (hand === undefined) throw new EngineError(`no hand ${index}`);
    return hand;
  }

  active(): number {
    if (this.activeHand === null) throw new EngineError('no active hand');
    return this.activeHand;
  }

  upCard(): Card {
    const up = this.dealer[0];
    if (up === undefined) throw new EngineError('the dealer has no up card');
    return up;
  }

  dealTo(index: number): void {
    const hand = this.hand(index);
    const card = this.draw();
    hand.cards.push(card);
    this.emit({ type: 'cardDealt', to: index, card });
    // A blackjack is a natural on a hand not born of a split (§4.1). `fold` reads it the same way.
    if (!hand.fromSplit && value(hand.cards).natural) hand.state = 'BLACKJACK';
  }

  dealToDealer(): void {
    const card = this.draw();
    this.dealer.push(card);
    this.emit({ type: 'cardDealt', to: 'dealer', card });
  }

  dealHole(): void {
    this.dealer.push(this.draw());
    this.holeHidden = true;
    this.emit({ type: 'holeDealt' });
  }

  reveal(): void {
    const hole = this.dealer[1];
    if (hole === undefined) throw new EngineError('the dealer has no hole card');
    this.holeHidden = false;
    this.emit({ type: 'holeRevealed', card: hole });
  }

  // ── the deal's tail ─────────────────────────────────────────────────────────────────────

  /** Looks under the up card. Only the answer travels; the card stays face down (invariant 2). */
  peek(): boolean {
    const blackjack = value(this.dealer.slice(0, 2)).natural;
    this.emit({ type: 'dealerPeeked', blackjack });
    return blackjack;
  }

  /** No dealer blackjack: a player blackjack settles now, anything else goes to the player. */
  afterPeek(): void {
    if (this.hand(0).state === 'BLACKJACK') {
      this.reveal();
      this.settle();
      return;
    }
    this.activate(0);
  }

  decideInsurance(take: boolean): void {
    const stake = take ? half(this.base.stake) : ZERO;
    this.balance = sub(this.balance, stake);
    this.insurance = { stake };
    this.emit({ type: 'insuranceDecided', stake });

    const blackjack = this.peek();
    if (blackjack) this.reveal();
    if (stake > 0) {
      const returned = blackjack ? payout(stake, 3, 1) : ZERO;
      this.insurance = { stake, payout: returned };
      this.balance = add(this.balance, returned);
      this.emit({ type: 'insuranceSettled', payout: returned });
    }
    if (blackjack) this.settle();
    else this.afterPeek();
  }

  // ── decisions ───────────────────────────────────────────────────────────────────────────

  hit(index: number): void {
    this.dealTo(index);
    this.afterCard(index);
  }

  stand(index: number): void {
    this.hand(index).state = 'STOOD';
    this.emit({ type: 'handStood', hand: index, auto: false });
    this.advance(index);
  }

  double(index: number): void {
    const hand = this.hand(index);
    const extra = hand.stake;
    this.balance = sub(this.balance, extra);
    hand.stake = add(hand.stake, extra);
    hand.doubled = true;
    this.emit({ type: 'handDoubled', hand: index, stake: extra });
    this.dealTo(index);
    if (value(hand.cards).bust) this.bust(index);
    else this.stop(index);
  }

  split(index: number): void {
    const hand = this.hand(index);
    const moved = hand.cards.pop();
    if (moved === undefined) throw new EngineError(`hand ${index} has nothing to split`);
    const extra = hand.stake;
    this.balance = sub(this.balance, extra);
    hand.fromSplit = true;
    this.hands.splice(index + 1, 0, {
      cards: [moved],
      stake: extra,
      doubled: false,
      fromSplit: true,
      state: 'PLAYING',
    });
    this.emit({ type: 'handSplit', hand: index, newHand: index + 1, stake: extra });
    this.hit(index);
  }

  /** After a card lands on the active hand: bust, a split ace's one card, or 21, end it. */
  private afterCard(index: number): void {
    const hand = this.hand(index);
    const { total, bust } = value(hand.cards);
    if (bust) this.bust(index);
    else if (isSplitAce(hand) && !this.rules.hitSplitAces) this.stop(index);
    else if (total === 21 && this.rules.autoStandOn21) this.stop(index);
  }

  private bust(index: number): void {
    this.hand(index).state = 'BUST';
    this.emit({ type: 'handBusted', hand: index });
    this.advance(index);
  }

  /** A hand that ends without a choice: `DONE`. */
  private stop(index: number): void {
    this.hand(index).state = 'DONE';
    this.emit({ type: 'handStood', hand: index, auto: true });
    this.advance(index);
  }

  private activate(index: number): void {
    this.phase = 'PLAYER';
    this.activeHand = index;
    this.emit({ type: 'activeHandChanged', hand: index });
    // A split hand takes its second card when it becomes active (§3.3).
    if (this.hand(index).cards.length === 1) this.hit(index);
  }

  /** Moves to the next hand still to play, left to right — or, with none left, to the dealer. */
  private advance(from: number): void {
    const next = this.hands.findIndex((h, i) => i > from && h.state === 'PLAYING');
    if (next !== -1) {
      this.activate(next);
      return;
    }
    this.activeHand = null;
    this.emit({ type: 'activeHandChanged', hand: null });
    this.dealerPlays();
  }

  // ── the dealer and the money ────────────────────────────────────────────────────────────

  /** Turns the hole card and draws to 17, standing on soft 17 — unless every hand is bust. */
  private dealerPlays(): void {
    this.reveal();
    if (this.hands.some((h) => h.state !== 'BUST')) {
      for (;;) {
        const { total, soft } = value(this.dealer);
        const hits = total < 17 || (total === 17 && soft && this.rules.dealerHitsSoft17);
        if (!hits) break;
        this.dealToDealer();
      }
    }
    this.settle();
  }

  /** Every hand against the dealer's final cards, left to right, then the round (§4.4). */
  settle(): void {
    const dealer = value(this.dealer);
    const dealerBlackjack = dealer.natural;
    this.hands.forEach((hand, index) => {
      const { total } = value(hand.cards);
      const outcome: NonNullable<Hand['outcome']> =
        hand.state === 'BUST'
          ? 'LOSE'
          : hand.state === 'BLACKJACK'
            ? dealerBlackjack
              ? 'PUSH'
              : 'BLACKJACK'
            : dealerBlackjack
              ? 'LOSE'
              : dealer.bust || total > dealer.total
                ? 'WIN'
                : total === dealer.total
                  ? 'PUSH'
                  : 'LOSE';
      const returned = this.payoutFor(outcome, hand.stake);
      hand.outcome = outcome;
      hand.payout = returned;
      this.balance = add(this.balance, returned);
      this.emit({ type: 'handSettled', hand: index, outcome, payout: returned });
    });

    const totalPayout = sum([
      ...this.hands.map((h) => h.payout ?? ZERO),
      this.insurance?.payout ?? ZERO,
    ]);
    this.phase = 'SETTLED';
    this.activeHand = null;
    this.totalPayout = totalPayout;
    this.emit({ type: 'roundSettled', totalPayout, serverSeed: this.base.seeds.serverSeed });
  }

  private payoutFor(outcome: NonNullable<Hand['outcome']>, stake: Minor): Minor {
    switch (outcome) {
      case 'LOSE':
        return ZERO;
      case 'PUSH':
        return stake;
      case 'WIN':
        return payout(stake, 2, 1);
      case 'BLACKJACK':
        return blackjackPayout(this.rules, stake);
      default: {
        const unhandled: never = outcome;
        throw new EngineError(`unknown outcome ${JSON.stringify(unhandled)}`);
      }
    }
  }
}
