import type { Client } from '@blackjack/client-core';
import type { FairRecord } from '@blackjack/protocol';
import { prettyCards } from '../cards.js';
import { rulesWords } from '../rules.js';
import { verify, type Report, type Status } from './verify.js';

/**
 * The verification page, `#/verify/:roundId` (ROADMAP C3): the public record fetched, then the four
 * checks of §3.4 shown one by one as this browser computes them — the commit, its own memory of
 * the seeds, the shuffle, and the round replayed through the engine card by card.
 *
 * Everything from the record goes into the page as text, never as HTML: a client seed is any
 * printable ASCII a player typed, and a record is the server's word until the checks say otherwise.
 */
export interface VerifyDeps {
  readonly client: Client;
  readonly format: (minor: number) => string;
  /** Show every step at once — the reduced-motion setting. */
  readonly instant: boolean;
  readonly sleep: (ms: number) => Promise<void>;
}

const REPO = 'https://github.com/KuliyevMerdan/blackjack/blob/main';

export async function mountVerify(
  root: HTMLElement,
  roundId: string,
  deps: VerifyDeps,
): Promise<Report | null> {
  root.replaceChildren();
  const page = el('main', { class: 'verify' });
  root.append(page);
  page.append(
    el('a', { class: 'back', href: './' }, '← Back to the table'),
    el('h1', {}, 'Verify a round'),
    el('p', { class: 'id' }, `Round ${roundId}`),
  );
  const status = el('p', { class: 'loading', role: 'status' }, 'Fetching the public record…');
  page.append(status);

  const read = await deps.client.fairRecord(roundId);
  if (read.kind !== 'ok') {
    status.textContent =
      read.kind === 'unknown'
        ? 'No settled round has that id. A round can be verified once it has settled.'
        : `The record could not be fetched (${read.reason}). Try again in a moment.`;
    status.className = 'loading failed';
    return null;
  }
  const record = read.value;
  const report = verify(record, deps.client.sent.find(record.roundId), deps.format);
  status.textContent = 'Checking, in this browser — nothing below is taken on the server’s word.';

  const steps = el('ol', { class: 'steps' });
  page.append(steps);
  for (const [i, step] of report.steps.entries()) {
    if (!deps.instant) await deps.sleep(i === 0 ? 300 : 650);
    const item = el('li', { class: `step ${step.status}` });
    item.append(
      el('span', { class: 'mark', 'aria-hidden': 'true' }, MARK[step.status]),
      el('h2', {}, `${i + 1}. ${step.title}`),
      el('p', { class: 'state' }, WORD[step.status]),
      ...step.detail.map((d) => el('p', { class: 'detail' }, d)),
    );
    steps.append(item);
  }

  if (!deps.instant) await deps.sleep(500);
  const verdict = el(
    'p',
    { class: `verdict ${report.verdict}`, role: 'status' },
    VERDICT[report.verdict],
  );
  page.insertBefore(verdict, steps);
  status.remove();

  page.append(roundSection(record, deps.format), replaySection(report), rulesSection(record));
  page.append(
    el('p', { class: 'how' }, [
      'SHA-256, the shuffle and the round machine on this page are the same code the server runs, shipped to your browser. ',
      link(
        `${REPO}/docs/adr/ADR-0001-committed-shoe.md`,
        'Why the shoe is committed before the bet',
      ),
      ' · ',
      link(`${REPO}/docs/protocol.md#34-get-fairroundsroundid`, 'the four checks, specified'),
    ]),
  );
  return report;
}

const MARK: Record<Status, string> = { pass: '✓', fail: '✗', unknown: '?', forced: '!' };
const WORD: Record<Status, string> = {
  pass: 'Holds.',
  fail: 'Does not hold.',
  unknown: 'Cannot be checked here.',
  forced: 'Not verifiable: a forced shoe.',
};
const VERDICT: Record<Report['verdict'], string> = {
  verified: 'Verified — this round was dealt from the committed shoe, and paid as the rules say.',
  failed: 'Not verified — the record does not hold. See the step that failed.',
  unverifiable: 'Not verifiable — dealt from a forced shoe on a development server.',
};

function roundSection(record: FairRecord, format: (minor: number) => string): HTMLElement {
  const { round } = record;
  const section = el('section', { class: 'round' }, [el('h2', {}, 'The round')]);
  const rows = [
    `Dealer: ${prettyCards(round.dealer.cards)}`,
    ...round.hands.map(
      (h, i) =>
        `${round.hands.length > 1 ? `Hand ${i + 1}` : 'You'}: ${prettyCards(h.cards)} — ${(h.outcome ?? '').toLowerCase()}, ${format(h.payout ?? 0)} back on ${format(h.stake)}`,
    ),
    ...(round.insurance !== null && round.insurance.stake > 0
      ? [`Insurance ${format(round.insurance.stake)}: ${format(round.insurance.payout ?? 0)} back`]
      : []),
    `Staked ${format(round.totalStake)} · returned ${format(round.totalPayout ?? 0)}`,
    `Settled ${new Date(record.settledAt).toLocaleString()}`,
  ];
  section.append(...rows.map((r) => el('p', {}, r)));
  return section;
}

function replaySection(report: Report): HTMLElement {
  const section = el('section', { class: 'replay' }, [el('h2', {}, 'Replayed here, card by card')]);
  if (report.replayed.length === 0) {
    section.append(el('p', {}, 'The round could not be replayed from its record.'));
    return section;
  }
  const list = el('ol', {});
  list.append(...report.replayed.map((line) => el('li', {}, line)));
  section.append(list);
  return section;
}

function rulesSection(record: FairRecord): HTMLElement {
  const section = el('section', { class: 'rules' }, [
    el('h2', {}, 'The rules it was played under'),
  ]);
  const list = el('ul', {});
  list.append(...rulesWords(record.rules).map((r) => el('li', {}, r)));
  section.append(list);
  return section;
}

function link(href: string, text: string): HTMLAnchorElement {
  return el('a', { href, target: '_blank', rel: 'noopener' }, text);
}

/** An element with attributes and text or children — text always as text. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
  content: string | readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (typeof content === 'string') node.textContent = content;
  else node.append(...content);
  return node;
}
