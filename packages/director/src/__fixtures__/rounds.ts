import { card, type Card } from '@blackjack/cards';
import { act, allowed, deal, view, type State } from '@blackjack/engine';
import { bytesToHex, sha256, shoe, utf8 } from '@blackjack/fair';
import { minor } from '@blackjack/money';
import { PUBLISHED_RULES, rules, type GameEvent, type Round } from '@blackjack/protocol';

/** Real rounds for the director's tests: the engine and the protocol shuffle, nothing hand-made. */

export interface Step {
  readonly previous: Round | null;
  readonly events: readonly GameEvent[];
  readonly next: Round;
  readonly balance: number;
}

const RULES = rules.parse(PUBLISHED_RULES);
const SEEDS = { roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N', commit: 'ab'.repeat(32), forced: false };

/** Every reply of one round, played with choices from `choose` (default: uniformly at random). */
export function playRound(
  index: number,
  choose: (state: State, random: () => number) => string = (s, r) => pick(allowed(s), r),
  top: readonly Card[] = [],
): Step[] {
  const serverSeed = bytesToHex(sha256(utf8(`director:${index}`)));
  const cards = [...top, ...shoe(serverSeed, 'director')];
  let seed = index * 2654435761;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const first = deal(
    {
      type: 'deal',
      rules: RULES,
      seeds: { ...SEEDS, clientSeed: 'director', serverSeed },
      stake: minor(500),
      balance: minor(100_000),
    },
    cards,
  );
  if (!first.ok) throw new Error(first.refusal);
  const steps: Step[] = [
    { previous: null, events: first.events, next: view(first.state), balance: first.state.balance },
  ];
  let state = first.state;
  while (state.phase !== 'SETTLED') {
    const choice = choose(state, random);
    const offered = allowed(state);
    const action = offered.find((a) => a === choice) ?? offered[0] ?? 'stand';
    const next = act(state, action, cards);
    if (!next.ok) throw new Error(next.refusal);
    steps.push({
      previous: view(state),
      events: next.events,
      next: view(next.state),
      balance: next.state.balance,
    });
    state = next.state;
  }
  return steps;
}

export const stacked = (...codes: string[]): Card[] => codes.map((c) => card(c));

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new RangeError('nothing to pick');
  return item;
}
