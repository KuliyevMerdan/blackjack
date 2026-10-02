import { isAce, points, value, type Card } from '@blackjack/cards';

/**
 * Basic strategy for the published rules (docs/protocol.md §2.2): six decks, dealer stands on soft
 * 17, double on any two, double after split, split to four hands, no resplit of aces, one card to
 * each split ace, no surrender, the dealer peeks. The rows are the standard chart for these rules;
 * `tools/sim --chart` measures each pair cell against the engine (CLAUDE.md § Gaps).
 *
 * One character per dealer up card, in the order `2 3 4 5 6 7 8 9 T A`:
 * `H` hit · `S` stand · `D` double, else hit · `d` double, else stand · `P` split.
 */
export type Code = 'H' | 'S' | 'D' | 'd' | 'P';

const HARD: Record<number, string> = {
  4: 'HHHHHHHHHH',
  5: 'HHHHHHHHHH',
  6: 'HHHHHHHHHH',
  7: 'HHHHHHHHHH',
  8: 'HHHHHHHHHH',
  9: 'HDDDDHHHHH',
  10: 'DDDDDDDDHH',
  11: 'DDDDDDDDDH',
  12: 'HHSSSHHHHH',
  13: 'SSSSSHHHHH',
  14: 'SSSSSHHHHH',
  15: 'SSSSSHHHHH',
  16: 'SSSSSHHHHH',
};

/** By the soft total: soft 13 is A-2, soft 18 is A-7. Soft 19 and up always stand. */
const SOFT: Record<number, string> = {
  12: 'HHHHHHHHHH',
  13: 'HHHDDHHHHH',
  14: 'HHHDDHHHHH',
  15: 'HHDDDHHHHH',
  16: 'HHDDDHHHHH',
  17: 'HDDDDHHHHH',
  18: 'SddddSSHHH',
};

/**
 * By the points of one card of the pair: `1` is aces, `10` any two ten-values — a king and a ten
 * split together here (split by value, D8), and are never split. Fives play as a hard ten.
 */
const PAIRS: Record<number, string> = {
  1: 'PPPPPPPPPP',
  2: 'PPPPPPHHHH',
  3: 'PPPPPPHHHH',
  4: 'HHHPPHHHHH',
  6: 'PPPPPHHHHH',
  7: 'PPPPPPHHHH',
  8: 'PPPPPPPPPP',
  9: 'PPPPPSPPSS',
  10: 'SSSSSSSSSS',
};

/** The rows, for a test to hold to their shape: ten cells each, one code per cell. */
export const ROWS: Readonly<Record<'hard' | 'soft' | 'pairs', Record<number, string>>> = {
  hard: HARD,
  soft: SOFT,
  pairs: PAIRS,
};

/** The column for a dealer up card: 2–9 by pip, ten-values together, the ace last. */
export function column(upcard: Card): number {
  return isAce(upcard) ? 9 : points(upcard) - 2;
}

/** The chart's code for a hand against an up card — the first choice, before `allowed` is read. */
export function chart(hand: readonly Card[], upcard: Card, canSplit: boolean): Code {
  const [a, b] = hand;
  if (canSplit && hand.length === 2 && a !== undefined && b !== undefined) {
    const row = points(a) === points(b) ? PAIRS[points(a)] : undefined;
    if (row !== undefined) return cell(row, upcard);
  }
  const { total, soft } = value(hand);
  if (soft) return total >= 19 ? 'S' : cell(SOFT[total] ?? 'HHHHHHHHHH', upcard);
  if (total >= 17) return 'S';
  return cell(HARD[total] ?? 'HHHHHHHHHH', upcard);
}

function cell(row: string, upcard: Card): Code {
  const code = row.charAt(column(upcard));
  switch (code) {
    case 'H':
    case 'S':
    case 'D':
    case 'd':
    case 'P':
      return code;
    default:
      throw new RangeError(`no chart cell for ${upcard} in ${row}`);
  }
}
