// FIXTURE — must NOT be flagged: the verification page replays a hand through the engine.
import { replay } from '@blackjack/engine';
import { shoe } from '@blackjack/fair';

export const ok = [replay, shoe];
