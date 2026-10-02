import { value } from '@blackjack/cards';
import { add } from '@blackjack/money';
import type { GameEvent } from './events.js';
import type { Hand, Round } from './round.js';

/**
 * What the events of a reply prove: the round as it lies on the table — cards, stakes, states,
 * outcomes and money. Not the round's identity (`roundId`, `commit`, `clientSeed`, `forced`), which
 * only the deal reply can introduce; not its version (`seq`); and not `allowed`, which is the
 * server's offer for the next decision rather than a fact about the table (invariant 5).
 */
export type Table = Omit<Round, 'roundId' | 'seq' | 'commit' | 'clientSeed' | 'allowed' | 'forced'>;

/** The part of a snapshot that `fold` reproduces. */
export function tableOf(round: Round): Table {
  const {
    roundId: _roundId,
    seq: _seq,
    commit: _commit,
    clientSeed: _clientSeed,
    allowed: _allowed,
    forced: _forced,
    ...table
  } = round;
  return clone(table);
}

/**
 * Applies a reply's events, in order, to the snapshot before it (docs/protocol.md §1 invariant 6).
 * `fold(previous, reply.events)` deep-equals `tableOf(reply.round)` for every reply the server sends:
 * the engine's tests assert it on every step it takes, and a dev client asserts it on every reply
 * it receives — so the events the director animates are proven to end in the snapshot it shows.
 *
 * A deal's events start with `roundStarted`, which discards whatever `previous` was. Any other
 * reply needs the snapshot it was decided on.
 *
 * Two facts are read off the cards rather than carried by an event, with the same `value()` the
 * engine decides with: a non-split hand whose two cards are a natural is a `BLACKJACK`, and nothing
 * else is.
 */
export function fold(previous: Round | null, events: readonly GameEvent[]): Table {
  let table: Table | null = previous === null ? null : tableOf(previous);

  for (const event of events) {
    if (event.type === 'roundStarted') {
      table = {
        phase: 'PLAYER',
        stake: event.stake,
        dealer: { cards: [], holeHidden: false },
        hands: [
          {
            cards: [],
            stake: event.stake,
            doubled: false,
            fromSplit: false,
            state: 'PLAYING',
          },
        ],
        activeHand: null,
        insurance: null,
        totalStake: event.stake,
      };
      continue;
    }
    if (table === null) throw new FoldError(`${event.type} before roundStarted`);
    apply(table, event);
  }

  if (table === null) throw new FoldError('no round to fold onto');
  return table;
}

export class FoldError extends Error {
  override readonly name = 'FoldError';
}

function apply(table: Table, event: Exclude<GameEvent, { type: 'roundStarted' }>): void {
  switch (event.type) {
    case 'cardDealt': {
      if (event.to === 'dealer') {
        table.dealer.cards.push(event.card);
        return;
      }
      const hand = handAt(table, event.to);
      hand.cards.push(event.card);
      if (!hand.fromSplit && value(hand.cards).natural) hand.state = 'BLACKJACK';
      return;
    }
    case 'holeDealt':
      table.dealer.holeHidden = true;
      return;
    case 'insuranceOffered':
      table.phase = 'INSURANCE';
      return;
    case 'insuranceDecided':
      table.insurance = { stake: event.stake };
      table.totalStake = add(table.totalStake, event.stake);
      return;
    case 'dealerPeeked':
      return;
    case 'handSplit': {
      const hand = handAt(table, event.hand);
      const moved = hand.cards.pop();
      if (moved === undefined) throw new FoldError(`hand ${event.hand} has nothing to split`);
      hand.fromSplit = true;
      table.hands.splice(event.newHand, 0, {
        cards: [moved],
        stake: event.stake,
        doubled: false,
        fromSplit: true,
        state: 'PLAYING',
      });
      table.totalStake = add(table.totalStake, event.stake);
      return;
    }
    case 'handDoubled': {
      const hand = handAt(table, event.hand);
      hand.stake = add(hand.stake, event.stake);
      hand.doubled = true;
      table.totalStake = add(table.totalStake, event.stake);
      return;
    }
    case 'handStood':
      handAt(table, event.hand).state = event.auto ? 'DONE' : 'STOOD';
      return;
    case 'handBusted':
      handAt(table, event.hand).state = 'BUST';
      return;
    case 'activeHandChanged':
      table.activeHand = event.hand;
      if (event.hand !== null) table.phase = 'PLAYER';
      return;
    case 'holeRevealed':
      table.dealer.cards.push(event.card);
      table.dealer.holeHidden = false;
      return;
    case 'handSettled': {
      const hand = handAt(table, event.hand);
      hand.outcome = event.outcome;
      hand.payout = event.payout;
      return;
    }
    case 'insuranceSettled':
      if (table.insurance === null) throw new FoldError('insurance settled but never taken');
      table.insurance.payout = event.payout;
      return;
    case 'roundSettled':
      table.phase = 'SETTLED';
      table.activeHand = null;
      table.totalPayout = event.totalPayout;
      table.serverSeed = event.serverSeed;
      return;
    default: {
      const unhandled: never = event;
      throw new FoldError(`unknown event ${JSON.stringify(unhandled)}`);
    }
  }
}

function handAt(table: Table, index: number): Hand {
  const hand = table.hands[index];
  if (hand === undefined) throw new FoldError(`no hand ${index}`);
  return hand;
}

function clone(table: Table): Table {
  return {
    ...table,
    dealer: { ...table.dealer, cards: [...table.dealer.cards] },
    hands: table.hands.map((hand) => ({ ...hand, cards: [...hand.cards] })),
    insurance: table.insurance === null ? null : { ...table.insurance },
  };
}
