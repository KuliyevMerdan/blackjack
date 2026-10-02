import { value, type Card } from '@blackjack/cards';
import { act, allowed, deal, type State } from '@blackjack/engine';
import { bytesToHex, sha256, shoe, utf8 } from '@blackjack/fair';
import { minor, type Minor } from '@blackjack/money';
import { PUBLISHED_RULES, rules as rulesSchema, type Rules } from '@blackjack/protocol';
import { recommend } from '@blackjack/strategy';

export const RULES: Rules = rulesSchema.parse(PUBLISHED_RULES);

/** The stake every simulated hand is played for: one unit, even, so every payout is exact. */
export const UNIT: Minor = minor(100);

/** Enough that no double or split is ever refused for money: the sim measures the rules. */
const BANKROLL: Minor = minor(1_000_000);

/** What one round contributes to a tally. `net` is in minor units; the rest are counts. */
export interface RoundResult {
  readonly net: number;
  readonly hands: number;
  readonly doubles: number;
  readonly insuranceOffered: boolean;
  readonly dealerBlackjack: boolean;
  readonly playerBlackjack: boolean;
  readonly busts: number;
}

/**
 * The shoe of round `index` in the run seeded `seed`: server seed `SHA-256("<seed>:<index>")`, client
 * seed `"sim"`, and the protocol's own shuffle of the two (docs/protocol.md §3.2) — exactly the
 * shoe a served round with those seeds is dealt from.
 */
export function shoeFor(seed: string, index: number, rules: Rules = RULES): Card[] {
  return shoe(bytesToHex(sha256(utf8(`${seed}:${index}`))), 'sim', rules.decks);
}

/** Deals one unit from `cards` and plays basic strategy to settlement. */
export function playRound(cards: readonly Card[], rules: Rules = RULES): RoundResult {
  const start = dealFrom(cards, rules);
  return summarise(playOut(start, cards), start.phase === 'INSURANCE');
}

/** The deal, through the engine, with seeds the sim has no use for. */
export function dealFrom(cards: readonly Card[], rules: Rules = RULES): State {
  const step = deal(
    {
      type: 'deal',
      rules,
      seeds: { roundId: 'sim', commit: 'sim', clientSeed: 'sim', serverSeed: 'sim', forced: false },
      stake: UNIT,
      balance: BANKROLL,
    },
    cards,
  );
  if (!step.ok) throw new Error(`deal refused: ${step.refusal}`);
  return step.state;
}

/** Plays basic strategy from any state to settlement — every decision `recommend`'s. */
export function playOut(from: State, cards: readonly Card[]): State {
  let state = from;
  while (state.phase !== 'SETTLED') {
    const hand = state.activeHand === null ? [] : (state.hands[state.activeHand]?.cards ?? []);
    const up = state.dealer[0];
    if (up === undefined) throw new Error('a round with no up card');
    const choice = recommend(hand, up, allowed(state));
    const next = act(state, choice, cards);
    if (!next.ok) throw new Error(`${choice} refused: ${next.refusal}`);
    state = next.state;
  }
  return state;
}

/** The round's net for the player, against the bankroll it opened with. */
export function netOf(state: State): number {
  return state.balance - BANKROLL;
}

function summarise(state: State, insuranceOffered: boolean): RoundResult {
  return {
    net: netOf(state),
    hands: state.hands.length,
    doubles: state.hands.filter((h) => h.doubled).length,
    insuranceOffered,
    dealerBlackjack: value(state.dealer.slice(0, 2)).natural,
    playerBlackjack: state.hands[0]?.state === 'BLACKJACK',
    busts: state.hands.filter((h) => h.state === 'BUST').length,
  };
}
