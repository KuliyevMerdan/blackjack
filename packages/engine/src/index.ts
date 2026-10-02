/**
 * @blackjack/engine — the round machine, `step(state, command, shoe) → { state, events }`. It
 * returns events; it never emits.
 *
 * Pure and headless (CLAUDE.md § Purity rules): the server runs it per request, `tools/sim` runs it
 * ten million times, and the verification page replays a settled round through it. The shoe is an
 * argument — the engine never shuffles and does not import `fair`.
 */
export { step, deal, act, allowed, view, dealt, maxExposure, EngineError } from './engine.js';
export { replay, type Decision, type ReplayInput, type ReplayResult } from './replay.js';
export type { State, Seeds, Command, Deal, Act, Refusal, Step } from './state.js';
