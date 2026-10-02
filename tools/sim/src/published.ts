/**
 * The house edge published for exactly these rules (CLAUDE.md § Gaps), and where it was read.
 *
 * Wizard of Odds' calculator gives three figures per rule set. This table reshuffles a fresh shoe
 * every round (ADR-0001) and the sim plays total-dependent basic strategy, which is its
 * "basic strategy with continuous shuffler" column. The other two — a cut card (0.42622 %) and
 * perfect composition-dependent play (0.40312 %) — describe games this is not.
 */
export const PUBLISHED = {
  edge: 0.0040622,
  source:
    'Wizard of Odds, Blackjack House Edge Calculator — "basic strategy with continuous shuffler"',
  url: 'https://wizardofodds.com/games/blackjack/calculator/',
  rules:
    '6 decks · dealer stands on soft 17 · double any two · double after split · resplit to 4 hands · ' +
    'no resplit or hitting of split aces · original bet only against dealer blackjack · ' +
    'no surrender · blackjack pays 3 to 2',
  read: '2026-10-02',
} as const;
