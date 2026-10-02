/**
 * @blackjack/strategy — basic strategy for the published rules, as a table, and the decision it
 * recommends for any hand, up card and set of allowed actions.
 *
 * Pure. `tools/sim` plays it through the engine to measure the realised edge; the client shows it
 * as a hint (C3); the load tool plays it against a running server (P0).
 */
export { chart, column, ROWS, type Code } from './chart.js';
export { recommend, type Decision } from './recommend.js';
