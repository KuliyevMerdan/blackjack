// FIXTURE — must be rejected by `renderer-deps`: the renderer plays beats, it never sees a reply.
// This is one of the two illegal imports ROADMAP S0's "Done when" names.
import { schema } from '@blackjack/protocol';

export const leak = schema;
