import type { Rules } from '@blackjack/protocol';

/**
 * The published rules in a player's words — the felt's print, the rules panel, and the verification
 * page, all read from `GameConfig.rules` (§2.2): the table says what the server plays, never a copy
 * of it typed into the page.
 */
export function rulesWords(rules: Rules): string[] {
  const [num, den] = rules.blackjackPays;
  const hands = rules.maxHands;
  return [
    `${rules.decks} decks, shuffled fresh every round`,
    `Blackjack pays ${num} to ${den}`,
    rules.dealerHitsSoft17 ? 'Dealer hits soft 17' : 'Dealer stands on soft 17',
    ...(rules.peek ? ['Dealer peeks for blackjack under an ace or a ten'] : []),
    ...(rules.insurance ? ['Insurance pays 2 to 1'] : []),
    'Double on any first two cards', // `doubleOn` has one value in v1: ANY_TWO
    ...(rules.doubleAfterSplit ? ['Double after a split'] : []),
    `Split any two cards of the same value, up to ${hands} hands`, // `splitBy`: VALUE only
    rules.hitSplitAces ? 'Split aces may be hit' : 'Split aces take one card each',
    ...(rules.resplitAces ? ['Aces may be resplit'] : []),
    ...(rules.autoStandOn21 ? ['21 stands by itself'] : []),
    ...(rules.surrender ? ['Surrender offered'] : []),
  ];
}

/** What a real table prints on its felt — three short lines, so a phone held upright fits them. */
export function feltWords(rules: Rules): string {
  const [num, den] = rules.blackjackPays;
  return [
    `BLACKJACK PAYS ${num} TO ${den}`,
    rules.dealerHitsSoft17 ? 'DEALER HITS SOFT 17' : 'DEALER STANDS ON SOFT 17',
    ...(rules.insurance ? ['INSURANCE PAYS 2 TO 1'] : []),
  ].join('\n');
}
