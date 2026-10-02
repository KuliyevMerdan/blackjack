// FIXTURE — must be rejected by `engine-deps`: the engine is handed its shoe, it does not shuffle one.
import { shoe } from '@blackjack/fair';

export const leak = shoe;
