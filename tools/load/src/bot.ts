import {
  Client,
  canonical,
  httpTransport,
  TransportError,
  type KeyValue,
  type Outcome,
  type Transport,
  type Truth,
} from '@blackjack/client-core';
import { minor } from '@blackjack/money';
import type { Action, Round } from '@blackjack/protocol';
import { recommend } from '@blackjack/strategy';

/** One request's round trip, as the client timed it. */
export interface Timing {
  readonly path: string;
  readonly ms: number;
  readonly faulted: boolean;
  /** No reply at all — a closed connection, a dead server. */
  readonly lost: boolean;
}

export interface BotOptions {
  readonly base: string;
  readonly storage: KeyValue;
  readonly random: () => number;
  /** Whether this bot's session has faults injected — its timings are reported apart. */
  readonly faulted: boolean;
  readonly timings: Timing[];
  /** A player's pause between decisions, in ms. */
  readonly think: readonly [number, number];
}

/**
 * A player on the wire (ROADMAP P0): `client-core` exactly as the browser uses it, basic strategy
 * for the decisions, a human's pause between them. It keeps its own account of what it did — every
 * deal and decision the server accepted, by round — and of every settled round it was shown, so the
 * audit can hold the server to it afterwards.
 *
 * A bot may have a **twin**: a second tab on the same session. Each tells the other when its truth
 * moved, and the other resyncs before its next move — the browser's `TabSync`, minus the channel.
 */
export class Bot {
  readonly client: Client;
  /** roundId → decisions this bot made that the server accepted. */
  readonly acted = new Map<string, number>();
  /**
   * roundId → decisions sent whose fate this bot was not told: the retries ran out (`failed`), or
   * the answer was a `CONFLICT` — another tab moved first, or a reply was lost *and* superseded
   * (§7). Each landed at most once; the audit holds the server to that bound.
   */
  readonly unresolved = new Map<string, number>();
  /** roundId → the settled round as this bot was shown it. More than one shape is a finding. */
  readonly shown = new Map<string, Set<string>>();
  readonly counts = {
    deals: 0,
    acts: 0,
    conflicts: 0,
    failed: 0,
    refused: 0,
    sessionLost: 0,
    resyncs: 0,
    /** Deals sent whose fate this bot was not told — as `unresolved`, for deals. */
    unresolvedDeals: 0,
  };
  twin: Bot | null = null;
  private stale = false;

  constructor(private readonly options: BotOptions) {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    this.client = new Client({
      transport: timed(
        httpTransport({ baseUrl: options.base, fetch: (url, init) => fetch(url, init), sleep }),
        options.timings,
        options.faulted,
      ),
      sleep,
      random: options.random,
      uuid: () => crypto.randomUUID(),
      clientSeed: () =>
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      storage: options.storage,
    });
    this.client.subscribe(({ next }) => {
      const round = next.round;
      if (round !== null && round.phase === 'SETTLED') {
        const seen = this.shown.get(round.roundId) ?? new Set<string>();
        seen.add(canonical(round));
        this.shown.set(round.roundId, seen);
      }
      const twin = this.twin;
      if (twin !== null && versionOf(twin.client.state) !== versionOf(next)) twin.stale = true;
    });
  }

  get token(): string {
    return this.client.state?.token ?? '';
  }

  /** Opens (or joins) the session, however long the server takes to be there. */
  async open(): Promise<void> {
    for (;;) {
      const outcome = await this.client.open();
      if (outcome.kind === 'ok') return;
      await pause(500);
    }
  }

  /** Plays until `until`, then finishes the hand in front of it. */
  async run(until: number): Promise<void> {
    for (;;) {
      const open = isOpen(this.client.state);
      if (!open && Date.now() >= until) return;
      await this.step();
      const [low, high] = this.options.think;
      await pause(low + this.options.random() * (high - low));
    }
  }

  private async step(): Promise<void> {
    if (this.stale) {
      this.stale = false;
      await this.resync();
    }
    const truth = this.client.state;
    if (truth === null) return this.open();
    const round = truth.round;
    if (round === null || round.phase === 'SETTLED') {
      const stake = minor(100 * (1 + Math.floor(this.options.random() * 10)));
      const outcome = await this.client.deal(stake);
      if (outcome.kind === 'ok') this.counts.deals += 1;
      if (outcome.kind === 'conflict' || outcome.kind === 'failed')
        this.counts.unresolvedDeals += 1;
      return this.after(outcome);
    }
    const action = this.choose(round);
    const roundId = round.roundId;
    const outcome = await this.client.act(action);
    if (outcome.kind === 'ok') {
      this.counts.acts += 1;
      this.acted.set(roundId, (this.acted.get(roundId) ?? 0) + 1);
    }
    if (outcome.kind === 'conflict' || outcome.kind === 'failed') {
      this.unresolved.set(roundId, (this.unresolved.get(roundId) ?? 0) + 1);
    }
    return this.after(outcome);
  }

  private async after(outcome: Outcome): Promise<void> {
    switch (outcome.kind) {
      case 'conflict':
        this.counts.conflicts += 1;
        return;
      case 'failed':
        this.counts.failed += 1;
        return this.resync();
      case 'refused':
        this.counts.refused += 1;
        return;
      case 'sessionLost':
        this.counts.sessionLost += 1;
        return;
      default:
        return;
    }
  }

  /** The run is over: catch up with a twin's last move, as an open tab in the browser would. */
  async finish(): Promise<void> {
    if (!this.stale) return;
    this.stale = false;
    await this.resync();
  }

  /** Asks where the round is, until the server answers. */
  async resync(): Promise<void> {
    for (;;) {
      this.counts.resyncs += 1;
      const outcome = await this.client.resync();
      if (outcome.kind === 'ok' || outcome.kind === 'busy') return;
      await pause(500);
    }
  }

  /** Basic strategy — and insurance taken now and then, so the audit sees it paid and lost. */
  private choose(round: Round): Action {
    const allowed = round.allowed;
    if (allowed.includes('insurance')) {
      return this.options.random() < 0.2 ? 'insurance' : 'noInsurance';
    }
    const hand = round.hands[round.activeHand ?? 0];
    const [up] = round.dealer.cards;
    if (hand === undefined || up === undefined) return allowed[0] ?? 'stand';
    return recommend(hand.cards, up, allowed);
  }
}

function isOpen(truth: Truth | null): boolean {
  return truth !== null && truth.round !== null && truth.round.phase !== 'SETTLED';
}

/** The transport, timed — per path, a lost reply marked as such. */
function timed(inner: Transport, timings: Timing[], faulted: boolean): Transport {
  return async (request) => {
    const started = performance.now();
    const path = request.path.startsWith('/fair/')
      ? '/fair/rounds'
      : (request.path.split('?')[0] ?? '');
    try {
      const response = await inner(request);
      timings.push({ path, ms: performance.now() - started, faulted, lost: false });
      return response;
    } catch (error) {
      if (error instanceof TransportError) {
        timings.push({ path, ms: performance.now() - started, faulted, lost: true });
      }
      throw error;
    }
  };
}

/** What two tabs compare: the open round's version, the wallet, the next commit. */
export function versionOf(truth: Truth | null): string {
  if (truth === null) return 'none';
  const round = truth.round;
  const open = round !== null && round.phase !== 'SETTLED' ? `${round.roundId}:${round.seq}` : '-';
  return `${open}:${truth.balance}:${truth.commit}`;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
