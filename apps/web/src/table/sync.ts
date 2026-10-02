import type { Client, Truth } from '@blackjack/client-core';

/** The slice of `BroadcastChannel` used — a test hands in a pair of fakes. */
export interface Channel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/**
 * Two tabs on one session (ROADMAP P0) keep in step. Each tells the others the version of the truth
 * it holds — round, `seq`, balance — whenever it changes; a tab that hears a version it does not
 * hold asks the server (`resync`) and renders what it gets, as it stands. Nothing is taken from the
 * other tab but the hint that the truth moved: the server stays the only source (ADR-0002).
 *
 * A tab busy with a request of its own resyncs once that request is answered — its reply, or the
 * `CONFLICT` it gets for acting on a version the other tab moved, may already be the news.
 */
export class TabSync {
  private stale = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: Client,
    private readonly channel: Channel,
    private readonly retryMs = 150,
  ) {
    client.subscribe(({ next }) => {
      this.channel.postMessage({ kind: 'truth', token: next.token, version: versionOf(next) });
    });
    channel.addEventListener('message', ({ data }) => this.heard(data));
  }

  private heard(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    if (!('token' in data) || !('version' in data)) return;
    const truth = this.client.state;
    if (truth === null || data.token !== truth.token || data.version === versionOf(truth)) return;
    this.stale = true;
    this.catchUp();
  }

  private catchUp(): void {
    if (!this.stale || this.timer !== null) return;
    if (this.client.busy) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.catchUp();
      }, this.retryMs);
      return;
    }
    this.stale = false;
    void this.client.resync();
  }
}

/**
 * What two tabs compare: the open round and its version, the wallet, the next commit. A settled
 * round counts as no open round — the server's resync answers `null` once a hand settles (§2.5), and
 * a tab still showing the result it just played must not look behind the tab that resynced.
 */
export function versionOf(truth: Truth): string {
  const round = truth.round;
  const open = round !== null && round.phase !== 'SETTLED' ? `${round.roundId}:${round.seq}` : '-';
  return `${open}:${truth.balance}:${truth.commit}`;
}
