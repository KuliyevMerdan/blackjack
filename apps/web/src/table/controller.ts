import type { Change, Client, Outcome, Status } from '@blackjack/client-core';
import { direct, pictureOf, type Pace } from '@blackjack/director';
import { minor } from '@blackjack/money';
import type { Action, GameConfig, Round } from '@blackjack/protocol';
import type { Playback, StageCue, StagePicture } from '@blackjack/renderer';

/** The slice of the stage the table drives — the real `Stage`, or a test's recording. */
export interface StageLike {
  render(picture: StagePicture): void;
  play(cues: readonly StageCue[], onCue?: (cue: StageCue, index: number) => void): Playback;
  finish(): void;
}

/** Everything the DOM layer shows, recomputed on every change — the view is a function of this. */
export interface View {
  readonly status: Status;
  /** The balance the HUD may show now: the truth's, less the payouts whose beats have not played. */
  readonly hud: number | null;
  readonly config: GameConfig | null;
  readonly round: Round | null;
  readonly stake: number;
  /** The decision gate (ADR-0002): open once the screen has caught up with the truth. */
  readonly gateOpen: boolean;
  readonly busy: boolean;
  /** The decisions to offer — the truth's `allowed`, and only once the gate is open. */
  readonly actions: readonly Action[];
  readonly canDeal: boolean;
  readonly message: string | null;
}

/**
 * Truth to screen (CLAUDE.md § The client: truth, script, stage). Every change of the truth is
 * either rendered as it stands — a resume, a resync, a conflict carry no events — or scripted by the
 * director and played. The decision gate and the HUD are functions of the playback's position, not
 * of the truth alone: a button opens only for a decision the screen has already shown, and money
 * appears when the card that won it lands.
 */
export class TableController {
  private playback: Playback | null = null;
  private hud: number | null = null;
  private stake = 500;
  private message: string | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly client: Client,
    private readonly stage: StageLike,
    private readonly show: (view: View) => void,
    private pace: Pace,
  ) {
    this.unsubscribe.push(
      client.subscribe((change) => this.onChange(change)),
      client.onStatus(() => this.emit()),
    );
  }

  /** Shows the view again — after a call the controller did not make, such as `client.open()`. */
  refresh(): void {
    this.emit();
  }

  setPace(pace: Pace): void {
    this.pace = pace;
  }

  /** A tap, a key, a hidden tab: the screen snaps to the truth it was heading for. */
  skip(): void {
    this.playback?.skip();
  }

  changeStake(direction: 1 | -1): void {
    const config = this.client.state?.config;
    if (!config) return;
    const at = CHIPS.findIndex((c) => c >= this.stake);
    const next = CHIPS[Math.max(0, Math.min(CHIPS.length - 1, at + direction))] ?? this.stake;
    this.stake = Math.min(config.maxBet, Math.max(config.minBet, next));
    this.emit();
  }

  async deal(): Promise<void> {
    if (!this.view().canDeal) return;
    this.message = null;
    this.say(await this.client.deal(minor(this.stake)));
  }

  async act(action: Action): Promise<void> {
    if (!this.view().actions.includes(action)) return;
    this.message = null;
    this.say(await this.client.act(action));
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.playback?.skip();
  }

  // ── truth → screen ──────────────────────────────────────────────────────────────────────

  private onChange(change: Change): void {
    const { previous, next, events } = change;
    this.playback?.skip(); // a new truth supersedes whatever was still catching up
    if (events.length === 0) {
      this.playback = null;
      this.hud = next.balance;
      this.stage.render(pictureOf(next.round));
      if (change.cause === 'conflict') {
        this.message = 'The hand moved on elsewhere — here it is as it stands.';
      }
      this.emit();
      return;
    }
    const script = direct(
      previous?.round ?? null,
      events,
      requireRound(next),
      next.balance,
      this.pace,
    );
    this.hud = script.hudBefore;
    const playback = this.stage.play(script.cues, (_cue, index) => {
      this.hud = script.cues[index]?.hud ?? this.hud;
      this.emit();
    });
    this.playback = playback;
    this.emit();
    void playback.finished.then(() => {
      if (this.playback !== playback) return;
      this.hud = next.balance;
      this.emit();
    });
  }

  private say(outcome: Outcome): void {
    const words: Partial<Record<Outcome['kind'], string>> = {
      failed: 'The table is not answering. Your last move is safe — try again in a moment.',
      sessionLost: 'Your session had expired, so a fresh table has been opened.',
      commitMoved: 'The next shoe’s commit changed. Deal again to play your seed against it.',
    };
    if (outcome.kind === 'refused') this.message = outcome.message;
    else this.message = words[outcome.kind] ?? this.message;
    this.emit();
  }

  view(): View {
    const truth = this.client.state;
    const round = truth?.round ?? null;
    const gateOpen = this.playback === null || this.playback.done;
    const busy = this.client.busy;
    const open = round !== null && round.phase !== 'SETTLED';
    return {
      status: this.client.status,
      hud: this.hud,
      config: truth?.config ?? null,
      round,
      stake: this.stake,
      gateOpen,
      busy,
      actions: gateOpen && !busy && round !== null ? round.allowed : [],
      canDeal: truth !== null && !open && gateOpen && !busy,
      message: this.message,
    };
  }

  private emit(): void {
    this.show(this.view());
  }
}

/** The stakes the chip buttons step through, in minor units. */
export const CHIPS = [100, 200, 500, 1000, 2000, 5000, 10_000];

function requireRound(truth: Change['next']): Round {
  if (truth.round === null) throw new Error('a reply with events always carries its round');
  return truth.round;
}
