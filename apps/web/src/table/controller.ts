import type { Change, Client, Outcome, Status } from '@blackjack/client-core';
import { direct, NORMAL, pictureOf, REDUCED, type Cue } from '@blackjack/director';
import { minor } from '@blackjack/money';
import type { Action, GameConfig, Round } from '@blackjack/protocol';
import { recommend } from '@blackjack/strategy';
import type { Playback, Proposal, Proposed, StageCue, StagePicture } from '@blackjack/renderer';
import { add, canAdd, chipsFor, dealable, fit, limitsOf } from './bet.js';
import { TURBO_SPEED, type Settings } from './settings.js';
import { calloutOf, promptOf, summaryOf, type Summary } from './words.js';

/** The slice of the stage the table drives — the real `Stage`, or a test's recording. */
export interface StageLike {
  render(picture: StagePicture): void;
  play(cues: readonly StageCue[], onCue?: (cue: StageCue, index: number) => void): Playback;
  finish(): void;
  propose(move: Proposed): Proposal;
  setSpeed(speed: number): void;
}

/** A chip on the rail, and whether it may go on the stake. */
export interface Chip {
  readonly value: number;
  readonly enabled: boolean;
}

/** Everything the DOM layer shows, recomputed on every change — the view is a function of this. */
export interface View {
  readonly status: Status;
  /** The balance the HUD may show now: the truth's, less the payouts whose beats have not played. */
  readonly hud: number | null;
  readonly config: GameConfig | null;
  readonly round: Round | null;
  readonly stake: number;
  readonly chips: readonly Chip[];
  /** The decision gate (ADR-0002): open once the screen has caught up with the truth. */
  readonly gateOpen: boolean;
  readonly busy: boolean;
  /** The decisions to offer — the truth's `allowed`, and only once the gate is open. */
  readonly actions: readonly Action[];
  readonly canDeal: boolean;
  /** A refusal or a failure, in words. */
  readonly message: string | null;
  /** What the last beat said that the felt alone might not: an offer, a peek, insurance. */
  readonly callout: string | null;
  /** The decision on screen, in words — for a screen reader, once the gate is open. */
  readonly prompt: string | null;
  /** The result moment: shown once the last result has played, gone at the next Deal. */
  readonly summary: Summary | null;
  /** Basic strategy's choice among `actions`, when the player asked for the hint. */
  readonly hint: Action | null;
  readonly settings: Settings;
}

/**
 * Truth to screen (CLAUDE.md § The client: truth, script, stage). Every change of the truth is
 * either rendered as it stands — a resume, a resync, a conflict carry no events — or scripted by the
 * director and played. The decision gate and the HUD are functions of the playback's position, not
 * of the truth alone: a button opens only for a decision the screen has already shown, and money
 * appears when the card that won it lands.
 *
 * **The one optimistic thing** (ADR-0002): on Double or Split the chips leave at the press. The
 * cards wait for the reply; a refusal, a conflict or a failure sends the chips back, with the reason
 * in words. The balance never moves at the press.
 */
export class TableController {
  private playback: Playback | null = null;
  private hud: number | null = null;
  private stake: number;
  private message: string | null = null;
  private callout: string | null = null;
  private settings: Settings;
  private readonly hidden: () => boolean;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly client: Client,
    private readonly stage: StageLike,
    private readonly show: (view: View) => void,
    options: {
      readonly settings?: Settings;
      readonly stake?: number;
      /** Whether the page is hidden — a reply landing then is drawn as it stands, not played. */
      readonly hidden?: () => boolean;
    } = {},
    private readonly format: (minor: number) => string = String,
  ) {
    this.settings = options.settings ?? { turbo: false, reducedMotion: false, hint: false };
    this.stake = options.stake ?? 500;
    this.hidden = options.hidden ?? (() => false);
    this.stage.setSpeed(this.settings.turbo ? TURBO_SPEED : 1);
    this.unsubscribe.push(
      client.subscribe((change) => this.onChange(change)),
      client.onStatus(() => this.emit()),
      // A request this controller did not make — another tab's resync, a tab back in view — greys
      // the buttons while it is out; its end must light them again.
      client.onBusy(() => this.emit()),
    );
  }

  /** Shows the view again — after a call the controller did not make, such as `client.open()`. */
  refresh(): void {
    this.emit();
  }

  /** Turbo takes effect at once, mid-round; reduced motion from the next reply. */
  configure(settings: Settings): void {
    this.settings = settings;
    this.stage.setSpeed(settings.turbo ? TURBO_SPEED : 1);
    this.emit();
  }

  /** A tap, a key, a hidden tab: the screen snaps to the truth it was heading for. */
  skip(): void {
    this.playback?.skip();
  }

  addChip(chip: number): void {
    const limits = this.limits();
    if (limits === null || !this.betting()) return;
    this.stake = add(this.stake, chip, limits);
    this.emit();
  }

  clearStake(): void {
    if (!this.betting()) return;
    this.stake = 0;
    this.emit();
  }

  async deal(): Promise<void> {
    if (!this.view().canDeal) return;
    this.message = null;
    this.callout = null;
    const sent = this.client.deal(minor(this.view().stake));
    this.emit(); // busy: the last result goes, and Deal greys, at the press
    this.say(await sent);
  }

  async act(action: Action): Promise<void> {
    const view = this.view();
    if (!view.actions.includes(action)) return; // a press with the gate shut, or a double tap
    this.message = null;
    this.callout = null;
    const proposal = this.propose(action, view.round);
    const sent = this.client.act(action);
    this.emit();
    const outcome = await sent;
    if (outcome.kind !== 'ok') proposal?.withdraw();
    this.say(outcome);
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.playback?.skip();
  }

  // ── truth → screen ──────────────────────────────────────────────────────────────────────

  private onChange(change: Change): void {
    const { previous, next, events } = change;
    this.playback?.skip(); // a new truth supersedes whatever was still catching up
    // Nothing to animate — a resume, a resync, a conflict — or no one to watch it: a hidden tab's
    // browser stops animation frames, and a script started there would wait and then play at once.
    if (events.length === 0 || this.hidden()) {
      this.playback = null;
      this.hud = next.balance;
      this.stage.render(pictureOf(next.round));
      if (change.cause === 'conflict') {
        this.message = 'The hand moved on elsewhere — here it is as it stands.';
      }
      this.emit();
      return;
    }
    const pace = this.settings.reducedMotion ? REDUCED : NORMAL;
    const script = direct(previous?.round ?? null, events, requireRound(next), next.balance, pace);
    this.hud = script.hudBefore;
    const playback = this.stage.play(script.cues, (_cue, index) => {
      const cue: Cue | undefined = script.cues[index];
      this.hud = cue?.hud ?? this.hud;
      const said = cue === undefined ? null : calloutOf(cue.beat, this.format);
      // Every line of one reply stays: the press cleared the last reply's.
      if (said !== null) this.callout = this.callout === null ? said : `${this.callout} ${said}`;
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

  /** Double and Split send their chips at the press; nothing else is shown before the reply. */
  private propose(action: Action, round: Round | null): Proposal | null {
    if ((action !== 'double' && action !== 'split') || round === null) return null;
    const hand = round.activeHand;
    const stake = hand === null ? undefined : round.hands[hand]?.stake;
    if (hand === null || stake === undefined) return null;
    const pace = this.settings.reducedMotion ? REDUCED : NORMAL;
    return this.stage.propose({ kind: action, hand, stake, ms: pace.chips });
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

  private limits() {
    const truth = this.client.state;
    return truth === null ? null : limitsOf(truth.config, truth.balance);
  }

  /** Between rounds, with the screen caught up: the only time the stake may change. */
  private betting(): boolean {
    const round = this.client.state?.round ?? null;
    return (round === null || round.phase === 'SETTLED') && !this.client.busy;
  }

  view(): View {
    const truth = this.client.state;
    const round = truth?.round ?? null;
    const gateOpen = this.playback === null || this.playback.done;
    const busy = this.client.busy;
    const open = round !== null && round.phase !== 'SETTLED';
    const limits = this.limits();
    const stake = limits === null ? this.stake : fit(this.stake, limits);
    const caughtUp = gateOpen && !busy;
    const actions = caughtUp && round !== null ? round.allowed : [];
    return {
      status: this.client.status,
      hud: this.hud,
      config: truth?.config ?? null,
      round,
      stake,
      chips:
        limits === null
          ? []
          : chipsFor(limits).map((value) => ({
              value,
              enabled: !open && !busy && canAdd(stake, value, limits),
            })),
      gateOpen,
      busy,
      actions,
      canDeal: limits !== null && !open && caughtUp && dealable(stake, limits),
      message: this.message,
      callout: this.callout,
      prompt: caughtUp && round !== null ? promptOf(round) : null,
      summary: caughtUp && round !== null ? summaryOf(round, this.format) : null,
      hint: this.settings.hint ? hintFor(round, actions) : null,
      settings: this.settings,
    };
  }

  private emit(): void {
    this.show(this.view());
  }
}

function requireRound(truth: Change['next']): Round {
  if (truth.round === null) throw new Error('a reply with events always carries its round');
  return truth.round;
}

/**
 * Basic strategy's move for the decision on screen — `strategy.recommend`, always one of `allowed`.
 * A suggestion on a button the player still presses: it decides nothing and moves no money.
 */
function hintFor(round: Round | null, actions: readonly Action[]): Action | null {
  if (round === null || actions.length === 0) return null;
  const [up] = round.dealer.cards;
  const hand = round.hands[round.activeHand ?? 0];
  if (up === undefined || hand === undefined) return null;
  const choice = recommend(hand.cards, up, actions);
  return actions.includes(choice) ? choice : null;
}
