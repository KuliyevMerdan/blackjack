// FIXTURE — must NOT be flagged: the director's whole allow-list.
import { schema } from '@blackjack/protocol';
import { minor } from '@blackjack/money';
import { value } from '@blackjack/cards';

export const ok = [schema, minor, value];
