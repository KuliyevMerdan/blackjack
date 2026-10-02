// FIXTURE — must be rejected by `client-core-deps`: the client holds the truth; it never runs the rules.
import { step } from '@blackjack/engine';

export const leak = step;
