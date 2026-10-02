import { card, type Card } from '@blackjack/cards';
import { act, allowed, type State } from '@blackjack/engine';
import { recommend, type Decision } from '@blackjack/strategy';
import { dealFrom, netOf, playOut, shoeFor } from './play.js';

/** The pair cells measured: every pair the chart splits or not, and a mixed ten-value pair. */
export const PAIRS: readonly (readonly [string, string])[] = [
  ['AS', 'AH'],
  ['2S', '2H'],
  ['3S', '3H'],
  ['4S', '4H'],
  ['5S', '5H'],
  ['6S', '6H'],
  ['7S', '7H'],
  ['8S', '8H'],
  ['9S', '9H'],
  ['TS', 'TH'],
  ['KS', 'TH'], // split by value (D8): a king and a ten are a pair here, not at most tables
];
export const UPCARDS: readonly string[] = [
  '2D',
  '3D',
  '4D',
  '5D',
  '6D',
  '7D',
  '8D',
  '9D',
  'TD',
  'AD',
];

export interface ActionStats {
  /** Σ net and Σ net² in units, over the trials that reached a decision. */
  sum: number;
  sumSquared: number;
  /** Σ (chart's net − this action's net) and its square, paired on the same shoe. */
  diff: number;
  diffSquared: number;
}

export interface Cell {
  readonly hand: readonly [string, string];
  readonly up: string;
  /** Trials that reached the decision — a dealer blackjack ends a round before it. */
  trials: number;
  chart: Decision | null;
  actions: Partial<Record<Decision, ActionStats>>;
}

/**
 * Every decision open at the cell, each played on the **same** shoe and finished with basic
 * strategy — common random numbers, so the difference between two actions has a far smaller
 * variance than either action's result. The shoe is the protocol's, with the three cards of the
 * cell moved to the top.
 */
export function measureCell(
  hand: readonly [string, string],
  up: string,
  trials: number,
  seed: string,
): Cell {
  const cell: Cell = { hand, up, trials: 0, chart: null, actions: {} };
  const top = [card(hand[0]), card(up), card(hand[1])];
  for (let t = 0; t < trials; t += 1) {
    const cards = stack(shoeFor(`${seed}:${hand.join('')}v${up}`, t), top);
    let state: State = dealFrom(cards);
    if (state.phase === 'INSURANCE') state = step(state, 'noInsurance', cards);
    if (state.phase === 'SETTLED') continue; // the dealer had blackjack: no decision to measure
    const open = allowed(state);
    const chart = recommend(state.hands[0]?.cards ?? [], card(up), open);
    cell.chart = chart;
    cell.trials += 1;
    const nets = new Map<Decision, number>();
    for (const action of open)
      nets.set(action, netOf(playOut(step(state, action, cards), cards)) / 100);
    const chartNet = nets.get(chart) ?? 0;
    for (const [action, net] of nets) {
      const stats = (cell.actions[action] ??= { sum: 0, sumSquared: 0, diff: 0, diffSquared: 0 });
      stats.sum += net;
      stats.sumSquared += net * net;
      stats.diff += chartNet - net;
      stats.diffSquared += (chartNet - net) ** 2;
    }
  }
  return cell;
}

export interface Verdict {
  readonly best: Decision;
  readonly ev: Partial<Record<Decision, number>>;
  /** For each other action: how much better the chart's action did, and that margin's error. */
  readonly margins: Partial<Record<Decision, { margin: number; standardError: number }>>;
  /** The chart's action is the best, or within 3 standard errors of it. */
  readonly ok: boolean;
}

export function judge(cell: Cell): Verdict {
  const n = cell.trials;
  const ev: Partial<Record<Decision, number>> = {};
  const margins: Verdict['margins'] = {};
  let best: Decision = cell.chart ?? 'stand';
  let ok = true;
  for (const [action, stats] of entries(cell.actions)) {
    ev[action] = stats.sum / n;
    if ((ev[action] ?? 0) > (ev[best] ?? -Infinity)) best = action;
    if (action === cell.chart) continue;
    const margin = stats.diff / n;
    const variance = Math.max(0, stats.diffSquared / n - margin ** 2) / (n - 1);
    const standardError = Math.sqrt(variance);
    margins[action] = { margin, standardError };
    if (margin < -3 * standardError) ok = false;
  }
  return { best, ev, margins, ok };
}

function entries(actions: Cell['actions']): [Decision, ActionStats][] {
  const out: [Decision, ActionStats][] = [];
  for (const action of ['hit', 'stand', 'double', 'split'] as const) {
    const stats = actions[action];
    if (stats !== undefined) out.push([action, stats]);
  }
  return out;
}

function step(state: State, action: Decision, cards: readonly Card[]): State {
  const next = act(state, action, cards);
  if (!next.ok) throw new Error(`${action} refused: ${next.refusal}`);
  return next.state;
}

/** `cards` with one copy of each of `top` taken out and put first, in order. */
export function stack(cards: readonly Card[], top: readonly Card[]): Card[] {
  const rest = [...cards];
  for (const c of top) {
    const at = rest.indexOf(c);
    if (at === -1) throw new Error(`${c} is not in the shoe`);
    rest.splice(at, 1);
  }
  return [...top, ...rest];
}
