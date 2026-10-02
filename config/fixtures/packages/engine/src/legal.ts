// FIXTURE — must NOT be flagged: the engine's whole allow-list, through entry points.
import { schema } from '@blackjack/protocol';
import { minor } from '@blackjack/money';
import { value } from '@blackjack/cards';

export const ok = [schema, minor, value];
