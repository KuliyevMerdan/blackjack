// FIXTURE — must be rejected by `load-deps`: the load tool plays as a client does, over the wire.
import { step } from '@blackjack/engine';

export const leak = step;
