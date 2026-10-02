import { value, type Card } from '@blackjack/cards';
import { gsap } from 'gsap';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { CardTextures } from './atlas.js';
import {
  cardAt,
  chipAt,
  layout,
  type Insets,
  type Layout,
  type Point,
  type Shape,
} from './layout.js';
import { EMPTY_PICTURE, type StageCue, type StageHand, type StagePicture } from './picture.js';

type Owner = 'dealer' | number;

interface CardView {
  readonly sprite: Sprite;
  face: Card | null;
}

/** A hand's stake on the felt: one disc, two when doubled, the amount on top. */
interface StackView {
  readonly root: Container;
  readonly discs: Graphics;
  readonly amount: Text;
}

/** Chips sent at the press of Double or Split, before the server has answered (ADR-0002). */
interface PendingView {
  readonly kind: 'double' | 'split';
  readonly stack: StackView;
}

export interface StageOptions {
  readonly textures: CardTextures;
  readonly width: number;
  readonly height: number;
  /** Minor units to display text — `money.formatMinor`, handed in: the stage cannot see `money`. */
  readonly format: (minor: number) => string;
  /** The amount printed on a chip — shorter than `format` where it can be. `format` if absent. */
  readonly chip?: (minor: number) => string;
  /** The band between the app's HUD and its controls; a phone's usual sizes if absent. */
  readonly insets?: Insets;
}

/** A script being played. `skip()` completes it: the screen snaps to where it was heading. */
export interface Playback {
  /** The index of the last cue that has started, or −1. */
  readonly cue: number;
  readonly done: boolean;
  readonly finished: Promise<void>;
  skip(): void;
}

/** Optimistic chips in flight. `withdraw()` sends them back — the server said no, or said nothing. */
export interface Proposal {
  withdraw(): void;
}

/** The player's own move, shown before the reply: which hand, how much, how long the chips fly. */
export interface Proposed {
  readonly kind: 'double' | 'split';
  readonly hand: number;
  readonly stake: number;
  readonly ms: number;
}

interface Placed {
  readonly face: Card | null;
  readonly x: number;
  readonly y: number;
}

/** What is on the stage, read back — for tests and the perf probe, never for game logic. */
export interface Described {
  readonly dealer: readonly Placed[];
  readonly hands: readonly (readonly Placed[])[];
  readonly chips: readonly { readonly amount: string; readonly x: number; readonly y: number }[];
  readonly labels: {
    readonly dealer: string;
    readonly insurance: string;
    readonly hands: readonly string[];
  };
  readonly active: number | null;
  /** Hands drawn dimmed — every hand but the active one while a decision is open. */
  readonly dimmed: readonly number[];
}

const key = (owner: Owner, index: number) =>
  owner === 'dealer' ? `d:${index}` : `h:${owner}:${index}`;

const DIM = 0x8c8c8c;
const LIT = 0xffffff;
const GOLD = 0xf2c94c;

/**
 * The table (ADR-0002's stage). It knows cards, chips and positions, not messages: it draws a
 * picture, or plays a list of cues from one picture to the next, with GSAP — whose clock is Pixi's
 * ticker (`driveGsapFromTicker`), so the whole screen runs on one clock.
 *
 * **Two paths, one picture.** Every cue has an animated path — a card travels from the shoe, the
 * hole card turns, a pair comes apart and its stake follows — and `render(picture)` is the snap path
 * that puts everything where it ends. `skip()` completes the timeline and every tween in flight, and
 * the scene must then be exactly what `render` would have drawn; `stage.test.ts` holds the two to
 * that from every cue.
 *
 * **One optimistic thing.** `propose()` sends a Double's or a Split's chips out at the press, before
 * the reply; the cue that makes the move true takes them in, and `withdraw()` sends them back. Cards
 * never move ahead of the server — there is no API here that could.
 */
export class Stage {
  readonly root = new Container();
  private readonly felt = new Graphics();
  private readonly cards = new Container();
  private readonly chipLayer = new Container();
  private readonly marks = new Container();
  private readonly shoe: Sprite;
  private readonly ring = new Graphics();
  private readonly dealerLabel: Text;
  /** The rules, printed on the felt the way a real table prints them. */
  private readonly print = new Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 11,
      fontWeight: '700',
      fill: 0xe9d8a6,
      letterSpacing: 1.5,
      align: 'center',
      lineHeight: 16,
    },
  });
  private readonly insuranceLabel: Text;
  private readonly handLabels: Text[] = [];
  private readonly views = new Map<string, CardView>();
  private stacks: StackView[] = [];
  private pending: PendingView[] = [];
  private readonly tweens = new Set<gsap.core.Tween>();
  private timeline: gsap.core.Timeline | null = null;
  private picture: StagePicture = EMPTY_PICTURE;
  private place: Layout;
  private playing: { cue: number; done: boolean } = { cue: -1, done: true };
  private speed = 1;

  constructor(private options: StageOptions) {
    this.place = this.lay(shapeOf(EMPTY_PICTURE));
    this.shoe = new Sprite(options.textures.back);
    this.shoe.anchor.set(0.5);
    this.dealerLabel = label();
    this.insuranceLabel = label();
    this.cards.sortableChildren = true;
    this.print.anchor.set(0.5, 0);
    this.print.alpha = 0.45;
    this.root.addChild(
      this.felt,
      this.print,
      this.shoe,
      this.ring,
      this.chipLayer,
      this.cards,
      this.marks,
    );
    this.marks.addChild(this.dealerLabel, this.insuranceLabel);
    for (let i = 0; i < 4; i += 1) {
      const text = label();
      this.handLabels.push(text);
      this.marks.addChild(text);
    }
    this.drawFelt();
    this.render(EMPTY_PICTURE);
  }

  // ── the snap path ───────────────────────────────────────────────────────────────────────

  /** Draws `picture` as it stands — a resume, a resync, a conflict, a skip's destination. */
  render(picture: StagePicture): void {
    this.finish();
    for (const p of this.pending) p.stack.root.destroy({ children: true });
    this.pending = [];
    this.picture = picture;
    this.place = this.lay(shapeOf(picture));
    const wanted = new Set<string>();
    for (const [owner, index, face] of slots(picture)) {
      const id = key(owner, index);
      wanted.add(id);
      const view = this.views.get(id) ?? this.create(id, face);
      this.setFace(view, face);
      const at = cardAt(this.place, owner, index);
      view.sprite.position.set(at.x, at.y);
      view.sprite.scale.set(this.fit(view.sprite));
      view.sprite.alpha = 1;
      view.sprite.zIndex = zOf(owner, index);
    }
    for (const [id, view] of this.views) if (!wanted.has(id)) this.remove(id, view);
    this.fitStacks(picture.hands.length, null);
    this.stacks.forEach((stack, i) => {
      const at = chipAt(this.place, i);
      stack.root.position.set(at.x, at.y);
    });
    this.mark(picture);
  }

  /**
   * A new size snaps the table to where it was heading. The skip comes first: the picture to
   * redraw is the one the script ends on, not the one it had reached.
   */
  resize(width: number, height: number, insets?: Insets): void {
    this.finish();
    this.options = { ...this.options, width, height, ...(insets ? { insets } : {}) };
    this.drawFelt();
    this.render(this.picture);
  }

  // ── the animated path ───────────────────────────────────────────────────────────────────

  /**
   * Plays `cues` from the picture on screen. `onCue` hears each as it starts — the app's decision
   * gate and beat-gated HUD read the position from it.
   */
  play(
    cues: readonly StageCue[],
    onCue: (cue: StageCue, index: number) => void = () => {},
  ): Playback {
    this.finish();
    const state = { cue: -1, done: false };
    this.playing = state;
    let resolve: () => void = () => {};
    const finished = new Promise<void>((r) => (resolve = r));
    const end = cues.reduce((t, c) => Math.max(t, c.at + c.ms + (c.hold ?? 0)), 0);
    const timeline: gsap.core.Timeline = gsap.timeline({
      onComplete: () => {
        if (this.timeline === timeline) this.timeline = null; // nothing kept once it has played
        state.done = true;
        resolve();
      },
    });
    cues.forEach((cue, index) => {
      timeline.call(
        () => {
          this.enter(cue);
          state.cue = index;
          onCue(cue, index);
        },
        [],
        cue.at / 1000,
      );
    });
    timeline.set({}, {}, end / 1000);
    // Never on a timeline of zero length (reduced motion with nothing held): GSAP takes a scaled
    // zero-length timeline for finished and fires none of its calls — the gate would wait forever.
    if (end > 0) timeline.timeScale(this.speed);
    this.timeline = timeline;
    return {
      get cue() {
        return state.cue;
      },
      get done() {
        return state.done;
      },
      finished,
      skip: () => this.finish(),
    };
  }

  /** Completes the timeline and every tween in flight, in order — the skip. */
  finish(): void {
    const timeline = this.timeline;
    this.timeline = null;
    if (timeline !== null) {
      timeline.progress(1);
      timeline.kill();
    }
    // Completing a tween can only remove it, so this drains.
    for (const tween of [...this.tweens]) {
      tween.progress(1);
      tween.kill();
      this.tweens.delete(tween);
    }
  }

  /** What the felt says — the rules, worded by the app from the config (the stage cannot read it). */
  setFelt(text: string): void {
    this.print.text = text;
    this.placePrint();
  }

  /** Under the dealer's row, above the hands — behind every card that climbs into it. */
  private placePrint(): void {
    const first = this.place.hands[0];
    const y =
      first === undefined ? this.options.height / 2 : first.y - this.place.cardHeight * 1.25;
    this.print.position.set(this.place.felt / 2, Math.round(y));
  }

  /**
   * Turbo (ADR-0002): a `timeScale` on everything playing and everything to come — set mid-round,
   * it speeds up the round already on screen. The script's times do not change; only how fast the
   * stage walks them.
   */
  setSpeed(speed: number): void {
    this.speed = speed > 0 ? speed : 1;
    if (this.timeline !== null && this.timeline.duration() > 0) this.timeline.timeScale(this.speed);
    for (const tween of this.tweens) tween.timeScale(this.speed);
  }

  /**
   * The player pressed Double or Split: their chips leave at once — that is their own move, and its
   * latency is felt — and land where the stake will stand. The cue that makes the move true takes
   * them in; nothing else about the table changes until it does.
   */
  propose(move: Proposed): Proposal {
    const stack = this.createStack(this.place.bank);
    drawStack(stack, this.chipText(move.stake), 1, false);
    stack.root.scale.set((this.place.chip * 2) / CHIP_SIZE);
    let target: Point;
    if (move.kind === 'double') {
      const at = chipAt(this.place, move.hand);
      target = { x: at.x, y: at.y - 4 };
    } else {
      const hands = [...shapeOf(this.picture).hands];
      hands.splice(move.hand + 1, 0, 1);
      const after = this.lay({ dealer: this.picture.dealer.length, hands });
      target = chipAt(after, move.hand + 1);
    }
    const pending: PendingView = { kind: move.kind, stack };
    this.pending.push(pending);
    this.tween(stack.root, {
      x: target.x,
      y: target.y,
      duration: move.ms / 1000,
      ease: 'power2.out',
    });
    return {
      withdraw: () => {
        if (!this.pending.includes(pending)) return; // already taken in, or swept by a render
        this.pending = this.pending.filter((p) => p !== pending);
        const bank = this.place.bank;
        this.tween(stack.root, {
          x: bank.x,
          y: bank.y,
          duration: move.ms / 1000,
          ease: 'power2.in',
          onComplete: () => stack.root.destroy({ children: true }),
        });
      },
    };
  }

  /** One cue: move every card and stack from where it is to where `cue.after` has it. */
  private enter(cue: StageCue): void {
    const { beat, after } = cue;
    let adopted: StackView | null = null;
    if (beat.kind === 'split' && typeof beat.hand === 'number') {
      this.splitKeys(beat.hand);
      adopted = this.takePending('split');
      const source = this.stacks[beat.hand];
      const born = adopted ?? this.createStack(source?.root.position ?? this.place.bank);
      this.stacks.splice(beat.hand + 1, 0, born);
    }
    if (beat.kind === 'clear') {
      // A new round: last round's stakes leave with its cards, and the new stake comes from the bank.
      for (const stack of this.stacks) stack.root.destroy({ children: true });
      this.stacks = [];
    }
    if (beat.kind === 'double') {
      const taken = this.takePending('double');
      taken?.root.destroy({ children: true });
    }
    this.picture = after;
    this.place = this.lay(shapeOf(after));
    const seconds = cue.ms / 1000;
    const wanted = new Set<string>();
    for (const [owner, index, face] of slots(after)) {
      const id = key(owner, index);
      wanted.add(id);
      const target = cardAt(this.place, owner, index);
      const existing = this.views.get(id);
      const view = existing ?? this.create(id, face, this.place.shoe);
      view.sprite.zIndex = zOf(owner, index);
      if (existing !== undefined && existing.face !== face) this.flip(view, face, seconds);
      if (view.sprite.x !== target.x || view.sprite.y !== target.y) {
        this.tween(view.sprite, {
          x: target.x,
          y: target.y,
          duration: seconds,
          ease: 'power2.out',
        });
      }
      const scale = this.fit(view.sprite);
      if (view.sprite.scale.y !== scale && existing?.face === face) {
        this.tween(view.sprite.scale, { x: scale, y: scale, duration: seconds });
      }
    }
    for (const [id, view] of this.views) {
      if (wanted.has(id)) continue;
      this.views.delete(id);
      this.tween(view.sprite, {
        alpha: 0,
        y: view.sprite.y - 30,
        duration: seconds,
        onComplete: () => view.sprite.destroy(),
      });
    }
    this.fitStacks(after.hands.length, this.place.bank);
    this.stacks.forEach((stack, i) => {
      const at = chipAt(this.place, i);
      if (stack.root.x !== at.x || stack.root.y !== at.y) {
        this.tween(stack.root, { x: at.x, y: at.y, duration: seconds, ease: 'power2.out' });
      }
    });
    if (beat.kind === 'peek') this.peek(seconds);
    this.mark(after);
  }

  /** A split: hands to the right move one place right; the pair's second card starts the new hand. */
  private splitKeys(hand: number): void {
    const moved = new Map<string, CardView>();
    for (const [id, view] of this.views) {
      const m = /^h:(\d+):(\d+)$/.exec(id);
      const h = Number(m?.[1]);
      const i = Number(m?.[2]);
      if (m === null) moved.set(id, view);
      else if (h > hand) moved.set(key(h + 1, i), view);
      else if (h === hand && i === 1) moved.set(key(hand + 1, 0), view);
      else moved.set(id, view);
    }
    this.views.clear();
    for (const [id, view] of moved) this.views.set(id, view);
  }

  private takePending(kind: PendingView['kind']): StackView | null {
    const found = this.pending.find((p) => p.kind === kind);
    if (found === undefined) return null;
    this.pending = this.pending.filter((p) => p !== found);
    return found.stack;
  }

  /** The hole card turning: the card narrows to an edge, changes face, and widens again. */
  private flip(view: CardView, face: Card | null, seconds: number): void {
    const proxy = { t: 0 };
    view.face = face;
    this.tween(proxy, {
      t: 1,
      duration: Math.max(seconds, 0),
      onUpdate: () => {
        const scale = this.fit(view.sprite);
        view.sprite.scale.set(scale * Math.abs(1 - 2 * proxy.t), scale);
        if (proxy.t >= 0.5) this.setFace(view, face);
      },
      onComplete: () => {
        this.setFace(view, face);
        view.sprite.scale.set(this.fit(view.sprite));
      },
    });
  }

  /** The dealer checks under the up card: the hole card lifts at its corner and settles back. */
  private peek(seconds: number): void {
    const hole = this.views.get(key('dealer', 1));
    if (hole === undefined || seconds <= 0) return;
    const base = cardAt(this.place, 'dealer', 1);
    const lift = this.place.cardHeight * 0.12;
    const proxy = { t: 0 };
    this.tween(proxy, {
      t: 1,
      duration: seconds,
      onUpdate: () => {
        const up = Math.sin(Math.PI * proxy.t);
        hole.sprite.y = base.y - lift * up;
        hole.sprite.rotation = -0.06 * up;
      },
      onComplete: () => {
        hole.sprite.y = base.y;
        hole.sprite.rotation = 0;
      },
    });
  }

  private tween(target: object, vars: gsap.TweenVars): void {
    const onComplete = vars.onComplete;
    // A zero-length tween completes inside `gsap.to`, before it returns: track it only if it lives.
    let finished = false;
    let tween: gsap.core.Tween | null = null;
    tween = gsap.to(target, {
      ...vars,
      onComplete: () => {
        finished = true;
        if (tween !== null) this.tweens.delete(tween);
        if (onComplete) onComplete();
      },
    });
    if (!finished) {
      tween.timeScale(this.speed);
      this.tweens.add(tween);
    }
  }

  private chipText(minor: number): string {
    return (this.options.chip ?? this.options.format)(minor);
  }

  private lay(shape: Shape): Layout {
    const { width, height, insets } = this.options;
    return layout(width, height, shape, insets);
  }

  // ── pieces ──────────────────────────────────────────────────────────────────────────────

  private create(id: string, face: Card | null, from?: Point): CardView {
    const sprite = new Sprite(
      face === null ? this.options.textures.back : this.options.textures.face(face),
    );
    sprite.anchor.set(0.5);
    sprite.scale.set(this.fit(sprite));
    if (from) sprite.position.set(from.x, from.y);
    const view: CardView = { sprite, face };
    this.views.set(id, view);
    this.cards.addChild(sprite);
    return view;
  }

  /** As many stacks as hands: new ones come from `from` (the bank), surplus ones go at once. */
  private fitStacks(count: number, from: Point | null): void {
    while (this.stacks.length > count) this.stacks.pop()?.root.destroy({ children: true });
    while (this.stacks.length < count) this.stacks.push(this.createStack(from ?? { x: 0, y: 0 }));
  }

  private createStack(at: Point): StackView {
    const root = new Container();
    const discs = new Graphics();
    const amount = new Text({
      text: '',
      style: { fontFamily: FONT, fontSize: 10, fontWeight: '700', fill: 0x1b1b1f },
    });
    amount.anchor.set(0.5);
    root.addChild(discs, amount);
    root.position.set(at.x, at.y);
    this.chipLayer.addChild(root);
    return { root, discs, amount };
  }

  /** The scale that makes a card the layout's width: atlas frames are drawn once, at one size. */
  private fit(sprite: Sprite): number {
    const width = sprite.texture.frame.width;
    return width > 0 ? this.place.cardWidth / width : 1;
  }

  private remove(id: string, view: CardView): void {
    this.views.delete(id);
    view.sprite.destroy();
  }

  private setFace(view: CardView, face: Card | null): void {
    view.face = face;
    view.sprite.texture =
      face === null ? this.options.textures.back : this.options.textures.face(face);
  }

  /**
   * Everything a picture says that is not a card's place: totals and results beside each stake, the
   * stakes themselves, insurance under the dealer, and the active hand — ringed, with every other
   * hand dimmed, so which hand a button acts on is never a question.
   */
  private mark(picture: StagePicture): void {
    const { format } = this.options;
    const l = this.place;
    this.placePrint();
    const up = picture.dealer.filter((f): f is Card => f !== null);
    this.dealerLabel.text =
      up.length === 0 ? '' : `${totalOf(up)}${value(up).bust ? ' · bust' : ''}`;
    const d = cardAt(l, 'dealer', 0);
    this.dealerLabel.position.set(d.x - l.cardWidth * 0.5, d.y + l.cardHeight * 0.5 + 4);
    this.insuranceLabel.text = insuranceText(picture.insurance, format);
    this.insuranceLabel.position.set(d.x - l.cardWidth * 0.5, d.y + l.cardHeight * 0.5 + 21);

    const dimming = picture.active !== null && picture.hands.length > 1;
    this.handLabels.forEach((text, i) => {
      const hand = picture.hands[i];
      text.text = hand === undefined || hand.cards.length === 0 ? '' : handText(hand, format);
      text.style.fill = dimming && i === picture.active ? GOLD : 0xf4f1e8;
      text.alpha = dimming && i !== picture.active ? 0.6 : 1;
      const chip = chipAt(l, i);
      text.position.set(chip.x + l.chip + 6, chip.y - l.chip);
    });
    this.stacks.forEach((stack, i) => {
      const hand = picture.hands[i];
      if (hand === undefined) return;
      drawStack(stack, this.chipText(hand.stake), hand.doubled ? 2 : 1, hand.result === 'LOSE');
      stack.root.scale.set((l.chip * 2) / CHIP_SIZE);
      stack.root.alpha = hand.result === 'LOSE' ? 0.4 : dimming && i !== picture.active ? 0.6 : 1;
    });
    for (const [id, view] of this.views) {
      const hand = handOf(id);
      view.sprite.tint = dimming && hand !== null && hand !== picture.active ? DIM : LIT;
    }

    this.ring.clear();
    if (picture.active !== null) {
      const hand = picture.hands[picture.active];
      const first = cardAt(l, picture.active, 0);
      const last = cardAt(l, picture.active, Math.max(0, (hand?.cards.length ?? 1) - 1));
      const pad = l.cardWidth * 0.1;
      this.ring
        .roundRect(
          first.x - l.cardWidth / 2 - pad,
          last.y - l.cardHeight / 2 - pad,
          last.x - first.x + l.cardWidth + 2 * pad,
          first.y - last.y + l.cardHeight + 2 * pad,
          10,
        )
        .stroke({ width: 3, color: GOLD, alpha: 0.95 });
    }
  }

  private drawFelt(): void {
    const { width, height } = this.options;
    const place = this.lay(shapeOf(EMPTY_PICTURE));
    this.felt.clear().rect(0, 0, width, height).fill({ color: 0x0f5132 });
    this.felt
      .ellipse(place.felt / 2, height * 0.05, place.felt * 0.62, height * 0.78)
      .stroke({ width: 2, color: 0xe9d8a6, alpha: 0.25 });
    this.shoe.position.set(place.shoe.x, place.shoe.y);
    const frame = this.shoe.texture.frame.width;
    this.shoe.scale.set(frame > 0 ? place.cardWidth / frame : 1);
  }

  // ── read-back ───────────────────────────────────────────────────────────────────────────

  describe(): Described {
    const read = (owner: Owner, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const view = this.views.get(key(owner, i));
        return {
          face: view?.face ?? null,
          x: Math.round(view?.sprite.x ?? Number.NaN),
          y: Math.round(view?.sprite.y ?? Number.NaN),
        };
      });
    const { active, hands } = this.picture;
    return {
      dealer: read('dealer', this.picture.dealer.length),
      hands: hands.map((h, i) => read(i, h.cards.length)),
      chips: this.stacks.map((s) => ({
        amount: s.amount.text,
        x: Math.round(s.root.x),
        y: Math.round(s.root.y),
      })),
      labels: {
        dealer: this.dealerLabel.text,
        insurance: this.insuranceLabel.text,
        hands: this.handLabels.map((t) => t.text),
      },
      active,
      dimmed:
        active !== null && hands.length > 1
          ? hands.map((_h, i) => i).filter((i) => i !== active)
          : [],
    };
  }

  /** The sprite drawing a card — for tests that follow one card through a move. */
  spriteAt(owner: Owner, index: number): Sprite | undefined {
    return this.views.get(key(owner, index))?.sprite;
  }

  /** The tint a card is drawn with — the active hand's are lit, the others dimmed. */
  tintAt(owner: Owner, index: number): number | undefined {
    const sprite = this.views.get(key(owner, index))?.sprite;
    return sprite === undefined ? undefined : sprite.tint;
  }

  /** What the stage is holding on to — a leak shows here first (the perf probe reads it). */
  stats(): {
    cards: number;
    sprites: number;
    stacks: number;
    chips: number;
    pending: number;
    tweens: number;
    playing: boolean;
  } {
    return {
      cards: this.views.size,
      sprites: this.cards.children.length,
      stacks: this.stacks.length,
      chips: this.chipLayer.children.length,
      pending: this.pending.length,
      tweens: this.tweens.size,
      playing: this.timeline !== null,
    };
  }

  get position(): { cue: number; done: boolean } {
    return { ...this.playing };
  }

  destroy(): void {
    this.finish();
    this.root.destroy({ children: true });
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** A chip is drawn this big and scaled to the layout's radius. */
const CHIP_SIZE = 32;

function drawStack(stack: StackView, amount: string, discs: number, lost: boolean): void {
  const r = CHIP_SIZE / 2;
  stack.discs.clear();
  for (let i = 0; i < discs; i += 1) {
    const y = -i * 4;
    stack.discs
      .circle(0, y, r)
      .fill({ color: lost ? 0x9e9e9e : GOLD })
      .circle(0, y, r)
      .stroke({ width: 2, color: 0x1b1b1f, alpha: 0.5 })
      .circle(0, y, r * 0.72)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
  }
  stack.amount.text = amount;
  stack.amount.position.set(0, -(discs - 1) * 4);
}

function shapeOf(picture: StagePicture): Shape {
  return { dealer: picture.dealer.length, hands: picture.hands.map((h) => h.cards.length) };
}

function handOf(id: string): number | null {
  const m = /^h:(\d+):/.exec(id);
  return m === null ? null : Number(m[1]);
}

/** Every card of a picture with its owner and index, dealer first. */
function slots(picture: StagePicture): [Owner, number, Card | null][] {
  return [
    ...picture.dealer.map((face, i): [Owner, number, Card | null] => ['dealer', i, face]),
    ...picture.hands.flatMap((hand, h) =>
      hand.cards.map((card, i): [Owner, number, Card | null] => [h, i, card]),
    ),
  ];
}

function zOf(owner: Owner, index: number): number {
  return (owner === 'dealer' ? 0 : 100 * (owner + 1)) + index;
}

function totalOf(cards: readonly Card[]): string {
  const { total, soft } = value(cards);
  return soft && total < 21 ? `soft ${total}` : String(total);
}

/** Two lines beside a stake: the total, and what became of it. */
function handText(hand: StageHand, format: (minor: number) => string): string {
  const total =
    hand.state === 'BLACKJACK' && hand.cards.length === 2 ? 'Blackjack' : totalOf(hand.cards);
  const state = hand.state === 'BUST' ? ' · bust' : '';
  switch (hand.result) {
    case null:
      return `${total}${state}`;
    case 'WIN':
      return `${total}${state}\nwin +${format(hand.payout ?? 0)}`;
    case 'BLACKJACK':
      return `${total}\npays +${format(hand.payout ?? 0)}`;
    case 'PUSH':
      return `${total}\npush · ${format(hand.payout ?? 0)} back`;
    case 'LOSE':
      return `${total}${state}\nlose`;
  }
}

function insuranceText(
  insurance: StagePicture['insurance'],
  format: (minor: number) => string,
): string {
  if (insurance === null || insurance.stake === 0) return '';
  if (insurance.payout === null) return `Insurance ${format(insurance.stake)}`;
  return insurance.payout > 0 ? `Insurance pays +${format(insurance.payout)}` : 'Insurance lost';
}

function label(): Text {
  return new Text({
    text: '',
    style: { fontFamily: FONT, fontSize: 13, fontWeight: '600', fill: 0xf4f1e8, lineHeight: 16 },
  });
}

/**
 * GSAP on Pixi's clock (ROADMAP C1): GSAP's own ticker is removed and `updateRoot` is called from
 * Pixi's, so tweens and frames advance together and a hidden tab pauses both. Returns the undo.
 */
export function driveGsapFromTicker(ticker: {
  add(fn: () => void): unknown;
  remove(fn: () => void): unknown;
  readonly lastTime: number;
}): () => void {
  gsap.ticker.remove(gsap.updateRoot);
  gsap.ticker.lagSmoothing(0);
  const tick = () => gsap.updateRoot(ticker.lastTime / 1000);
  ticker.add(tick);
  return () => {
    ticker.remove(tick);
    gsap.ticker.add(gsap.updateRoot);
  };
}
