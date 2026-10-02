import type { Card } from '@blackjack/cards';
import { canonical, type Sent } from '@blackjack/client-core';
import { dealt, replay, view } from '@blackjack/engine';
import { commit, shoe, verifyCommit } from '@blackjack/fair';
import { minor } from '@blackjack/money';
import type { FairRecord, GameEvent } from '@blackjack/protocol';

/**
 * The verifier (docs/protocol.md §3.4, ADR-0001): a settled round's public record held to four
 * checks, every one computed here, in this browser, from the record and this browser's own memory —
 * nothing taken on the server's word. The only module of the web app that runs the engine
 * (`engine-only-in-verify`): the game screen never does.
 */

export type Status = 'pass' | 'fail' | 'unknown' | 'forced';

export interface Step {
  readonly id: 'commit' | 'memory' | 'shuffle' | 'replay';
  readonly title: string;
  readonly status: Status;
  /** What was computed and against what, in words. */
  readonly detail: readonly string[];
}

export interface Report {
  /** `verified` — every check passed; `unverifiable` — a dev-forced shoe (§9); else `failed`. */
  readonly verdict: 'verified' | 'failed' | 'unverifiable';
  readonly steps: readonly Step[];
  /** The round replayed, one line per thing that happened at the table — empty if it could not be. */
  readonly replayed: readonly string[];
}

type Format = (minor: number) => string;

export function verify(record: FairRecord, sent: Sent | null, format: Format): Report {
  const forced = record.round.forced === true;
  const steps: Step[] = [];

  // 1. The server seed is the one committed to before the bet.
  const hashed = SEED.test(record.serverSeed) ? commit(record.serverSeed) : '(not a 32-byte seed)';
  steps.push({
    id: 'commit',
    title: 'The server seed matches the commit shown before the bet',
    status: verifyCommit(record.serverSeed, record.commit) ? 'pass' : 'fail',
    detail: [
      `SHA-256 of the revealed seed: ${hashed}`,
      `The commit the round was dealt under: ${record.commit}`,
    ],
  });

  // 2. …and the commit and client seed are the ones this browser saw and sent.
  steps.push(memoryStep(record, sent));

  // 3. The shoe is the shuffle of the two seeds.
  const shuffled = SEED.test(record.serverSeed)
    ? shoe(record.serverSeed, record.clientSeed, record.rules.decks)
    : [];
  const first = firstDifference(shuffled, record.dealt);
  steps.push({
    id: 'shuffle',
    title: 'The cards dealt are the top of the shuffle of both seeds',
    status: forced ? 'forced' : first === null ? 'pass' : 'fail',
    detail: [
      `This browser shuffled ${shuffled.length} cards from the server seed and the client seed “${record.clientSeed}”.`,
      `Its first ${Math.min(8, shuffled.length)}: ${shuffled.slice(0, 8).join(' ')}`,
      `The ${record.dealt.length} the round used: ${record.dealt.join(' ')}`,
      ...(forced
        ? [
            'This round was dealt from a forced shoe (a development server) — it cannot be verified.',
          ]
        : first === null
          ? []
          : [
              `They part at card ${first + 1}: the shuffle has ${shuffled[first] ?? 'nothing'}, the record ${record.dealt[first] ?? 'nothing'}.`,
            ]),
    ],
  });

  // 4. Replaying the decisions through the same engine reproduces the round, every card and payout.
  const result = replay({
    rules: record.rules,
    seeds: {
      roundId: record.roundId,
      commit: record.commit,
      clientSeed: record.clientSeed,
      serverSeed: record.serverSeed,
      forced,
    },
    stake: minor(record.stake),
    decisions: record.decisions,
    shoe: forced ? record.dealt : shuffled,
  });
  let replayed: string[] = [];
  if (!result.ok) {
    steps.push({
      id: 'replay',
      title: 'Your decisions, replayed, reach the same result',
      status: 'fail',
      detail: [
        result.at < 0
          ? `The deal itself could not be replayed (${result.refusal}).`
          : `Decision ${result.at + 1} (${record.decisions[result.at]?.action ?? '?'}) was refused on replay: ${result.refusal}.`,
      ],
    });
  } else {
    replayed = result.events.flatMap((events, i) => [
      ...(i === 0 ? [] : [`— You: ${record.decisions[i - 1]?.action ?? '?'}`]),
      ...events.flatMap((e) => line(e, format)),
    ]);
    const mine = view(result.state);
    const sameRound = canonical(mine) === canonical(record.round);
    const sameCards =
      canonical(dealt(result.state, forced ? record.dealt : shuffled)) === canonical(record.dealt);
    const settled = mine.phase === 'SETTLED';
    steps.push({
      id: 'replay',
      title: 'Your decisions, replayed, reach the same result',
      status: sameRound && sameCards && settled ? 'pass' : 'fail',
      detail: [
        `${record.decisions.length} decision${record.decisions.length === 1 ? '' : 's'} replayed through the engine the server runs.`,
        `Replayed: ${summary(mine, format)}`,
        `Recorded: ${summary(record.round, format)}`,
        ...(sameRound ? [] : ['The replayed round and the recorded one differ.']),
        ...(sameCards
          ? []
          : ['The cards the replay used are not the cards the record says were dealt.']),
      ],
    });
  }

  const failed = steps.some((s) => s.status === 'fail');
  return {
    verdict: failed ? 'failed' : forced ? 'unverifiable' : 'verified',
    steps,
    replayed,
  };
}

const SEED = /^[0-9a-f]{64}$/;

function memoryStep(record: FairRecord, sent: Sent | null): Step {
  const title = 'The commit and client seed are the ones this browser saw and sent';
  if (sent === null) {
    return {
      id: 'memory',
      title,
      status: 'unknown',
      detail: [
        'This browser did not deal this round, so it cannot vouch for the seeds — only the browser that played it can.',
        'The other three checks hold whoever opens the link.',
      ],
    };
  }
  const commitOk = sent.commit === record.commit;
  const seedOk = sent.clientSeed === record.clientSeed;
  return {
    id: 'memory',
    title,
    status: commitOk && seedOk ? 'pass' : 'fail',
    detail: [
      `Commit — this browser saw ${sent.commit}; the record says ${record.commit}${commitOk ? '' : ' ✗'}`,
      `Client seed — this browser sent “${sent.clientSeed}”; the record says “${record.clientSeed}”${seedOk ? '' : ' ✗'}`,
    ],
  };
}

function firstDifference(shuffled: readonly Card[], used: readonly Card[]): number | null {
  for (let i = 0; i < used.length; i += 1) if (shuffled[i] !== used[i]) return i;
  return null;
}

function summary(round: FairRecord['round'], format: Format): string {
  const hands = round.hands
    .map((h) => `${h.cards.join(' ')} ${(h.outcome ?? '—').toLowerCase()} ${format(h.payout ?? 0)}`)
    .join(' | ');
  return `dealer ${round.dealer.cards.join(' ')}; ${hands}; paid ${format(round.totalPayout ?? 0)}`;
}

/** One event as a line of the replay. */
function line(event: GameEvent, format: Format): string[] {
  const hand = (i: number) => `hand ${i + 1}`;
  switch (event.type) {
    case 'roundStarted':
      return [`Stake ${format(event.stake)}.`];
    case 'cardDealt':
      return [
        event.to === 'dealer'
          ? `Dealer ← ${event.card}`
          : `${capital(hand(event.to))} ← ${event.card}`,
      ];
    case 'holeDealt':
      return ['Dealer ← hole card, face down'];
    case 'insuranceOffered':
      return ['Insurance offered.'];
    case 'insuranceDecided':
      return [
        event.stake === 0 ? 'Insurance declined.' : `Insurance taken: ${format(event.stake)}.`,
      ];
    case 'dealerPeeked':
      return [event.blackjack ? 'Dealer peeks: blackjack.' : 'Dealer peeks: no blackjack.'];
    case 'handSplit':
      return [
        `${capital(hand(event.hand))} splits; ${format(event.stake)} on ${hand(event.newHand)}.`,
      ];
    case 'handDoubled':
      return [`${capital(hand(event.hand))} doubles: ${format(event.stake)} more.`];
    case 'handStood':
      return event.auto ? [] : [`${capital(hand(event.hand))} stands.`];
    case 'handBusted':
      return [`${capital(hand(event.hand))} busts.`];
    case 'activeHandChanged':
      return [];
    case 'holeRevealed':
      return [`Dealer turns the hole card: ${event.card}`];
    case 'handSettled':
      return [
        `${capital(hand(event.hand))}: ${event.outcome.toLowerCase()}, ${format(event.payout)} back.`,
      ];
    case 'insuranceSettled':
      return [`Insurance ${event.payout > 0 ? `pays ${format(event.payout)}` : 'lost'}.`];
    case 'roundSettled':
      return [`Round settled: ${format(event.totalPayout)} paid.`];
    default: {
      const unhandled: never = event;
      return [JSON.stringify(unhandled)];
    }
  }
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
