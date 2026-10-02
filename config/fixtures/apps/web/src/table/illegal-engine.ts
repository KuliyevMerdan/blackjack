// FIXTURE — must be rejected by `engine-only-in-verify`: the game screen never runs the engine.
// This is one of the two illegal imports ROADMAP S0's "Done when" names.
import { step } from '@blackjack/engine';

export const leak = step;
