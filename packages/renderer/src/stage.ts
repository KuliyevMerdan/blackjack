import { value, type Card } from '@blackjack/cards';
import { gsap } from 'gsap';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { CardTextures } from './atlas.js';
import { cardAt, layout, type Layout, type Point } from './layout.js';
import { EMPTY_PICTURE, type StageCue, type StagePicture } from './picture.js';

type Owner = 'dealer' | number;

interface CardView {
  readonly sprite: Sprite;
  face: Card | null;
}

export interface StageOptions {
  readonly textures: CardTextures;
  readonly width: number;
  readonly height: number;
  /** Minor units to display text — `money.formatMinor`, handed in: the stage cannot see `money`. */
  readonly format: (minor: number) => string;
}

/** A script being played. `skip()` completes it: the screen snaps to where it was heading. */
export interface Playback {
  /** The index of the last cue that has started, or −1. */
  readonly cue: number;
  readonly done: boolean;
  readonly finished: Promise<void>;
  skip(): void;
}

/** What is on the stage, read back — for tests and the perf probe, never for game logic. */
export interface Described {
  readonly dealer: readonly { face: Card | null; x: number; y: number }[];
  readonly hands: readonly (readonly { face: Card | null; x: number; y: number }[])[];
  readonly labels: { readonly dealer: string; readonly hands: readonly string[] };
  readonly active: number | null;
}

const key = (owner: Owner, index: number) =>
  owner === 'dealer' ? `d:${index}` : `h:${owner}:${index}`;

/**
 * The table (ADR-0002's stage). It knows cards and positions, not messages: it draws a picture, or
 * plays a list of cues from one picture to the next, with GSAP — whose clock is Pixi's ticker
 * (`driveGsapFromTicker`), so the whole screen runs on one clock.
 *
 * **Two paths, one picture.** Every cue has an animated path — a card travels from the shoe, the
 * hole card turns, a pair comes apart — and `render(picture)` is the snap path that puts everything
 * where it ends. `skip()` completes the timeline and every tween in flight, and the scene must then
 * be exactly what `render` would have drawn; `stage.test.ts` holds the two to that from every cue.
 */
export class Stage {
  readonly root = new Container();
  private readonly felt = new Graphics();
  private readonly cards = new Container();
  private readonly marks = new Container();
  private readonly shoe: Sprite;
  private readonly ring = new Graphics();
  private readonly dealerLabel: Text;
  private readonly handLabels: Text[] = [];
  private readonly views = new Map<string, CardView>();
  private readonly tweens = new Set<gsap.core.Tween>();
  private timeline: gsap.core.Timeline | null = null;
  private picture: StagePicture = EMPTY_PICTURE;
  private place: Layout;
  private playing: { cue: number; done: boolean } = { cue: -1, done: true };

  constructor(private options: StageOptions) {
    this.place = layout(options.width, options.height, 1);
    this.shoe = new Sprite(options.textures.back);
    this.shoe.anchor.set(0.5);
    this.dealerLabel = label(0xf4f1e8);
    this.root.addChild(this.felt, this.shoe, this.ring, this.cards, this.marks);
    this.marks.addChild(this.dealerLabel);
    for (let i = 0; i < 4; i += 1) {
      const text = label(0xf4f1e8);
      this.handLabels.push(text);
      this.marks.addChild(text);
    }
    this.drawFelt();
    this.render(EMPTY_PICTURE);
  }

  // ── the snap path ───────────────────────────────────────────────────────────────────────

  /** Draws `picture` as it stands — a resume, a resync, a skip's destination. */
  render(picture: StagePicture): void {
    this.finish();
    this.picture = picture;
    this.place = layout(this.options.width, this.options.height, picture.hands.length);
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
    this.mark(picture);
  }

  resize(width: number, height: number): void {
    this.options = { ...this.options, width, height };
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
    const end = cues.reduce((t, c) => Math.max(t, c.at + c.ms), 0);
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

  /** One cue: move every card from where it is to where `cue.after` has it. */
  private enter(cue: StageCue): void {
    const { beat, after } = cue;
    if (beat.kind === 'split' && typeof beat.hand === 'number') this.splitKeys(beat.hand);
    this.picture = after;
    this.place = layout(this.options.width, this.options.height, after.hands.length);
    const seconds = (cue.ms * 0.8) / 1000;
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
    if (!finished) this.tweens.add(tween);
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
    this.cards.sortableChildren = true;
    return view;
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

  /** Totals, stakes and results under the cards, and the ring round the active hand. */
  private mark(picture: StagePicture): void {
    const { format } = this.options;
    const up = picture.dealer.filter((f): f is Card => f !== null);
    this.dealerLabel.text = up.length === 0 ? '' : totalOf(up);
    const d = cardAt(this.place, 'dealer', 0);
    this.dealerLabel.position.set(
      d.x - this.place.cardWidth * 0.5,
      d.y + this.place.cardHeight * 0.62,
    );

    this.handLabels.forEach((text, i) => {
      const hand = picture.hands[i];
      if (hand === undefined || hand.cards.length === 0) {
        text.text = hand === undefined ? '' : format(hand.stake);
      } else {
        const result =
          hand.result === null
            ? hand.state === 'BUST'
              ? ' · bust'
              : hand.state === 'BLACKJACK'
                ? ' · blackjack'
                : ''
            : ` · ${hand.result.toLowerCase()}${hand.payout ? ` +${format(hand.payout)}` : ''}`;
        text.text = `${totalOf(hand.cards)}${result}\n${format(hand.stake)}${hand.doubled ? ' ×2' : ''}`;
      }
      const at = cardAt(this.place, i, 0);
      text.position.set(at.x - this.place.cardWidth * 0.5, at.y + this.place.cardHeight * 0.62);
    });

    this.ring.clear();
    if (picture.active !== null) {
      const at = cardAt(this.place, picture.active, 0);
      const hand = picture.hands[picture.active];
      const span = Math.max(0, (hand?.cards.length ?? 1) - 1);
      const w = this.place.cardWidth * 1.2 + span * this.place.fan.x;
      const h = this.place.cardHeight * 1.2 - span * this.place.fan.y;
      this.ring
        .roundRect(
          at.x - this.place.cardWidth * 0.6,
          at.y - h + this.place.cardHeight * 0.6,
          w,
          h,
          10,
        )
        .stroke({ width: 3, color: 0xf2c94c, alpha: 0.9 });
    }
  }

  private drawFelt(): void {
    const { width, height } = this.options;
    this.felt.clear().rect(0, 0, width, height).fill({ color: 0x0f5132 });
    this.felt
      .ellipse(width / 2, height * 0.05, width * 0.62, height * 0.78)
      .stroke({ width: 2, color: 0xe9d8a6, alpha: 0.25 });
    const place = layout(width, height, 1);
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
    return {
      dealer: read('dealer', this.picture.dealer.length),
      hands: this.picture.hands.map((h, i) => read(i, h.cards.length)),
      labels: { dealer: this.dealerLabel.text, hands: this.handLabels.map((t) => t.text) },
      active: this.picture.active,
    };
  }

  /** The sprite drawing a card — for tests that follow one card through a move. */
  spriteAt(owner: Owner, index: number): Sprite | undefined {
    return this.views.get(key(owner, index))?.sprite;
  }

  /** What the stage is holding on to — a leak shows here first (the perf probe reads it). */
  stats(): { cards: number; sprites: number; tweens: number; playing: boolean } {
    return {
      cards: this.views.size,
      sprites: this.cards.children.length,
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

function label(color: number): Text {
  return new Text({
    text: '',
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: 15,
      fontWeight: '600',
      fill: color,
      lineHeight: 19,
    },
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
