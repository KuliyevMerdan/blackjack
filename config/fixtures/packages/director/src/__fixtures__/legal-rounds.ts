// FIXTURE — must NOT be flagged: the director's test code may play real rounds to script.
import { step } from '@blackjack/engine';
import { shoe } from '@blackjack/fair';
import { schema } from '@blackjack/protocol';

export const ok = [step, shoe, schema];
