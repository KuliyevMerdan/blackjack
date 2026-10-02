/**
 * @blackjack/director — the script: `(previous, events, pace) → beats with durations`, and the
 * picture each ends in (ADR-0002). Pure — the choreography is a unit test.
 */
export {
  EMPTY,
  applyBeat,
  pictureOf,
  type Beat,
  type Face,
  type HandPicture,
  type HandState,
  type Picture,
  type Result,
} from './picture.js';
export { NORMAL, INSTANT, REDUCED, scaled, type Pace } from './pace.js';
export { direct, type Cue, type Script } from './script.js';
