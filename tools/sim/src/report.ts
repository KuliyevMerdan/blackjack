import type { Cell, Verdict } from './cells.js';
import { PUBLISHED } from './published.js';
import { edge, type Tally } from './tally.js';

const pct = (x: number, digits = 4) => `${(x * 100).toFixed(digits)} %`;
const share = (count: number, of: number) => pct(count / of, 2).padStart(8);
const int = (n: number) => n.toLocaleString('en-US');

export interface EdgeVerdict {
  readonly edge: number;
  readonly standardError: number;
  /** (realised − published) / σ. */
  readonly z: number;
  readonly within3Sigma: boolean;
}

export function verdict(tally: Tally, unit: number): EdgeVerdict {
  const { edge: realised, standardError } = edge(tally, unit);
  const z = (realised - PUBLISHED.edge) / standardError;
  return { edge: realised, standardError, z, within3Sigma: Math.abs(z) <= 3 };
}

export function edgeReport(tally: Tally, unit: number, seconds: number): string {
  const v = verdict(tally, unit);
  const n = tally.rounds;
  const outcomes = Object.entries(tally.outcomes)
    .map(([key, count]) => [Number(key) / 2, count] as const)
    .sort(([a], [b]) => a - b)
    .map(
      ([units, count]) =>
        `  ${(units > 0 ? '+' : '') + units.toString()}`.padEnd(8) + share(count, n),
    );
  return [
    `Rounds          ${int(n)} at one unit, basic strategy, a fresh protocol shuffle each`,
    `Realised edge   ${pct(v.edge)}  ± ${pct(v.standardError)} (1σ)`,
    `Published       ${pct(PUBLISHED.edge)}  ${PUBLISHED.source}`,
    `                ${PUBLISHED.rules}`,
    `Difference      ${v.z >= 0 ? '+' : ''}${v.z.toFixed(2)}σ — ${v.within3Sigma ? 'within 3σ ✓' : 'OUTSIDE 3σ ✗'}`,
    '',
    'Net per round (units)',
    ...outcomes,
    '',
    'How often the rules fire',
    `  a split              ${share(tally.splitRounds, n)} of rounds`,
    `  four hands           ${share(tally.fourHandRounds, n)} of rounds`,
    `  a double             ${share(tally.doubles, tally.hands)} of hands`,
    `  insurance offered    ${share(tally.insuranceOffers, n)} of rounds (never taken)`,
    `  dealer blackjack     ${share(tally.dealerBlackjacks, n)} of rounds`,
    `  player blackjack     ${share(tally.playerBlackjacks, n)} of rounds`,
    `  a bust               ${share(tally.busts, tally.hands)} of hands`,
    '',
    `${seconds.toFixed(1)} s · ${int(Math.round(n / seconds))} rounds/s`,
  ].join('\n');
}

export function chartReport(cells: readonly (readonly [Cell, Verdict])[]): string {
  const lines = [
    'Pair cells: the chart’s action against every other open one, on common shoes',
    '',
  ];
  for (const [cell, v] of cells) {
    const others = Object.entries(v.margins)
      .flatMap(([action, m]) =>
        m === undefined
          ? []
          : [
              `${action} ${m.margin >= 0 ? '+' : ''}${m.margin.toFixed(3)}±${m.standardError.toFixed(3)}`,
            ],
      )
      .join('  ');
    lines.push(
      `${cell.hand.join(' ')} v ${cell.up.charAt(0)}  chart ${String(cell.chart).padEnd(6)} ` +
        `EV ${(v.ev[cell.chart ?? 'stand'] ?? 0).toFixed(3).padStart(7)}  better than: ${others}` +
        (v.ok ? '' : `   ✗ best is ${v.best}`),
    );
  }
  const bad = cells.filter(([, v]) => !v.ok).length;
  lines.push(
    '',
    bad === 0 ? `All ${cells.length} cells hold within 3σ ✓` : `${bad} cells do not hold ✗`,
  );
  return lines.join('\n');
}
