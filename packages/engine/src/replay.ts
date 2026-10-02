import type { Card } from '@blackjack/cards';
import type { Minor } from '@blackjack/money';
import type { Action, GameEvent, Rules } from '@blackjack/protocol';
import { act, deal, maxExposure } from './engine.js';
import type { Refusal, Seeds, State } from './state.js';

export interface Decision {
  readonly seq: number;
  readonly action: Action;
}

export interface ReplayInput {
  readonly rules: Rules;
  readonly seeds: Seeds;
  readonly stake: Minor;
  readonly decisions: readonly Decision[];
  readonly shoe: readonly Card[];
  /**
   * The balance before the deal. It only decides whether a double, a split or insurance was
   * affordable, and a recorded decision was — so the verifier, which does not know the balance,
   * replays with enough for any round at this stake (`maxExposure`).
   */
  readonly balance?: Minor;
}

export type ReplayResult =
  | {
      readonly ok: true;
      readonly state: State;
      /** Each step's events: the deal's first, then one entry per decision. */
      readonly events: readonly (readonly GameEvent[])[];
    }
  | {
      readonly ok: false;
      /** The decision that failed, by its index in `decisions`; -1 for the deal itself. */
      readonly at: number;
      readonly refusal: Refusal | 'STALE_SEQ';
    };

/**
 * A round from its inputs alone: the deal, then each recorded decision in order, through the same
 * `step` the server ran (docs/protocol.md §3.4 step 4). The verification page's entry point, and the
 * server's resume — a round restored from its seeds and decisions is the round that was played.
 *
 * Each decision names the `seq` it was made on, and replay holds it to that: a record whose
 * decisions do not line up with the versions they claim is refused rather than reinterpreted.
 */
export function replay(input: ReplayInput): ReplayResult {
  const { rules, seeds, stake, shoe } = input;
  const dealt = deal(
    { type: 'deal', rules, seeds, stake, balance: input.balance ?? maxExposure(rules, stake) },
    shoe,
  );
  if (!dealt.ok) return { ok: false, at: -1, refusal: dealt.refusal };

  let state = dealt.state;
  const events: (readonly GameEvent[])[] = [dealt.events];
  for (const [index, decision] of input.decisions.entries()) {
    if (decision.seq !== state.seq) return { ok: false, at: index, refusal: 'STALE_SEQ' };
    const next = act(state, decision.action, shoe);
    if (!next.ok) return { ok: false, at: index, refusal: next.refusal };
    state = next.state;
    events.push(next.events);
  }
  return { ok: true, state, events };
}
