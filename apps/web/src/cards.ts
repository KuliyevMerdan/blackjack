import type { Card } from '@blackjack/cards';

const SUIT: Readonly<Record<string, string>> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** `TD` → `10♦`: a card as a player reads it, for lists and the verification page. */
export function prettyCard(card: Card): string {
  const rank = card[0] === 'T' ? '10' : (card[0] ?? '');
  return `${rank}${SUIT[card[1] ?? ''] ?? ''}`;
}

export const prettyCards = (cards: readonly Card[]): string => cards.map(prettyCard).join(' ');
