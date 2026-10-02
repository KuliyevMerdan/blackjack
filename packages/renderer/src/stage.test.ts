import { gsap } from 'gsap';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLANK, scriptsOf } from './__fixtures__/scripts.js';
import { cardAt, chipAt, footprint, layout } from './layout.js';
import { Stage } from './stage.js';

/** GSAP on a clock this test turns by hand — the same seam Pixi's ticker drives in the app. */
let now = 10_000;
const advance = (ms: number) => {
  now += ms;
  gsap.updateRoot(now / 1000);
};
beforeAll(() => {
  gsap.ticker.remove(gsap.updateRoot);
  gsap.updateRoot(now / 1000);
});
afterAll(() => gsap.ticker.add(gsap.updateRoot));

const stage = () =>
  new Stage({ textures: BLANK, width: 390, height: 844, format: (m) => `€${m / 100}` });

/** Plays a script to its end in 16 ms frames. */
function watch(s: Stage, cues: Parameters<Stage['play']>[0]): void {
  const playback = s.play(cues);
  for (let frames = 0; !playback.done; frames += 1) {
    if (frames > 2000) throw new Error('the script never ended');
    advance(16);
  }
  advance(1000); // the last tweens outlive the timeline's final cue by their own length
}

describe('Stage — two paths, one picture', () => {
  it('watching a script to its end and snapping to its picture draw the same table', () => {
    const wrong: unknown[] = [];
    for (let round = 0; round < 150; round += 1) {
      const watched = stage();
      const snapped = stage();
      for (const script of scriptsOf(round)) {
        watch(watched, script.cues);
        snapped.render(script.to);
        if (JSON.stringify(watched.describe()) !== JSON.stringify(snapped.describe())) {
          wrong.push({ round, watched: watched.describe(), snapped: snapped.describe() });
        }
        const stats = watched.stats();
        if (stats.tweens !== 0 || stats.playing) wrong.push({ round, leftover: stats });
      }
      watched.destroy();
      snapped.destroy();
    }
    expect(wrong.slice(0, 2)).toEqual([]);
  }, 60_000);

  it('skipping from every cue — and from halfway through it — lands on the same table', () => {
    const wrong: unknown[] = [];
    for (let round = 0; round < 60; round += 1) {
      const scripts = scriptsOf(round);
      for (const [n, script] of scripts.entries()) {
        const expected = stage();
        expected.render(script.to);
        const picture = JSON.stringify(expected.describe());
        expected.destroy();
        for (const [k, cue] of script.cues.entries()) {
          for (const into of [0, 0.5]) {
            const s = stage();
            s.render(script.from);
            const playback = s.play(script.cues);
            advance(cue.at + cue.ms * into + 1);
            playback.skip();
            if (JSON.stringify(s.describe()) !== picture) {
              wrong.push({ round, script: n, cue: k, into, got: s.describe() });
            }
            if (s.stats().tweens !== 0 || !playback.done)
              wrong.push({ round, k, stats: s.stats() });
            s.destroy();
          }
        }
      }
    }
    expect(wrong.slice(0, 2)).toEqual([]);
  }, 60_000);

  it('a resize mid-script snaps to the end of the script, at the new size', () => {
    for (let round = 0; round < 20; round += 1) {
      for (const script of scriptsOf(round)) {
        const s = stage();
        s.render(script.from);
        s.play(script.cues);
        advance(Math.max(1, (script.cues[1]?.at ?? 0) + 1)); // the first cue has played, not all
        s.resize(375, 667);
        const expected = new Stage({
          textures: BLANK,
          width: 375,
          height: 667,
          format: (m) => `€${m / 100}`,
        });
        expected.render(script.to);
        expect(s.describe()).toEqual(expected.describe());
        s.destroy();
        expected.destroy();
      }
    }
  });

  it('keeps nothing behind across 500 rounds: one sprite per card on the table, no tweens', () => {
    const s = stage();
    for (let round = 0; round < 500; round += 1) {
      for (const script of scriptsOf(round)) {
        const playback = s.play(script.cues);
        advance(script.duration / 2);
        playback.skip();
      }
    }
    const last = scriptsOf(499).at(-1);
    const onTable =
      (last?.to.dealer.length ?? 0) + (last?.to.hands.reduce((n, h) => n + h.cards.length, 0) ?? 0);
    expect(s.stats()).toEqual({
      cards: onTable,
      sprites: onTable,
      stacks: last?.to.hands.length,
      chips: last?.to.hands.length,
      pending: 0,
      tweens: 0,
      playing: false,
    });
    s.destroy();
  }, 60_000);

  it('a split moves the pair’s second card to the new hand — it does not deal a new one', () => {
    let checked = 0;
    for (let round = 0; round < 400 && checked < 10; round += 1) {
      for (const script of scriptsOf(round)) {
        const beat = script.cues.find((c) => c.beat.kind === 'split')?.beat;
        if (beat?.kind !== 'split') continue;
        const { hand } = beat;
        const s = stage();
        s.render(script.from);
        const second = s.spriteAt(hand, 1);
        const playback = s.play(script.cues);
        playback.skip();
        expect(second).toBeDefined();
        expect(s.spriteAt(hand + 1, 0)).toBe(second);
        s.destroy();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('reports the cue it has reached, for the decision gate', () => {
    const [deal] = scriptsOf(1);
    if (deal === undefined) throw new Error('no script');
    const s = stage();
    const heard: number[] = [];
    const playback = s.play(deal.cues, (_cue, i) => heard.push(i));
    expect(playback.cue).toBe(-1);
    advance((deal.cues[2]?.at ?? 0) + 1);
    expect(playback.cue).toBe(2);
    expect(playback.done).toBe(false);
    playback.skip();
    expect(heard).toEqual(deal.cues.map((_c, i) => i));
    expect(playback.done).toBe(true);
  });
});

/** The first script of a round that splits, and the round's scripts. */
function splitting(from = 0): { at: number; scripts: ReturnType<typeof scriptsOf>; n: number } {
  for (let round = from; round < from + 400; round += 1) {
    const scripts = scriptsOf(round);
    const n = scripts.findIndex((sc) => sc.cues.some((c) => c.beat.kind === 'split'));
    if (n >= 0) return { at: round, scripts, n };
  }
  throw new Error('no split in 400 rounds');
}

describe('optimistic chips (ADR-0002)', () => {
  it('a split’s chips leave at the press and become the new hand’s stake when the reply plays', () => {
    const { scripts, n } = splitting();
    const script = scripts[n];
    const beat = script?.cues.find((c) => c.beat.kind === 'split')?.beat;
    if (script === undefined || beat?.kind !== 'split') throw new Error('no split');
    const s = stage();
    s.render(script.from);
    const before = s.describe();
    s.propose({ kind: 'split', hand: beat.hand, stake: 500, ms: 260 });
    advance(100);
    expect(s.describe().hands).toEqual(before.hands); // no card moved ahead of the reply
    expect(s.stats().pending).toBe(1);
    s.play(script.cues).skip();
    advance(1000);
    expect(s.stats().pending).toBe(0);
    expect(s.stats().chips).toBe(script.to.hands.length);
    const snapped = stage();
    snapped.render(script.to);
    expect(s.describe()).toEqual(snapped.describe());
    s.destroy();
    snapped.destroy();
  });

  it('a refusal sends the chips back, and the table is as it was', () => {
    const [deal] = scriptsOf(2);
    if (deal === undefined) throw new Error('no script');
    const s = stage();
    s.render(deal.to);
    const before = JSON.stringify(s.describe());
    const proposal = s.propose({ kind: 'double', hand: 0, stake: 500, ms: 260 });
    advance(130);
    proposal.withdraw();
    proposal.withdraw(); // twice is once
    advance(400);
    expect(s.stats()).toMatchObject({ pending: 0, chips: 1, tweens: 0 });
    expect(JSON.stringify(s.describe())).toBe(before);
    s.destroy();
  });

  it('a skip lands the chips; a snap to another truth sweeps them away', () => {
    const [deal] = scriptsOf(2);
    if (deal === undefined) throw new Error('no script');
    const s = stage();
    s.render(deal.to);
    s.propose({ kind: 'double', hand: 0, stake: 500, ms: 260 });
    s.finish();
    expect(s.stats()).toMatchObject({ pending: 1, tweens: 0 });
    s.render(deal.to); // a conflict: the truth as it stands, and nothing of the guess
    expect(s.stats()).toMatchObject({ pending: 0, chips: 1 });
    s.destroy();
  });
});

describe('the active hand', () => {
  it('is lit and ringed; every other hand is dimmed while a decision is open', () => {
    const { scripts, n } = splitting(10);
    const script = scripts[n];
    if (script === undefined) throw new Error('no split');
    const s = stage();
    s.render(script.to);
    const active = script.to.active;
    if (active === null) {
      expect(s.describe().dimmed).toEqual([]);
    } else {
      script.to.hands.forEach((_h, i) =>
        expect(s.tintAt(i, 0)).toBe(i === active ? 0xffffff : 0x8c8c8c),
      );
      expect(s.describe().dimmed).toHaveLength(script.to.hands.length - 1);
    }
    s.destroy();
  });
});

describe('turbo', () => {
  it('is a timeScale: the same script ends in a fraction of the time, mid-play too', () => {
    const [deal] = scriptsOf(5);
    if (deal === undefined) throw new Error('no script');
    const s = stage();
    const playback = s.play(deal.cues);
    advance(deal.duration / 4);
    s.setSpeed(2.5);
    advance(((deal.duration * 3) / 4 / 2.5) * 1.05);
    expect(playback.done).toBe(true);
    s.setSpeed(1);
    s.destroy();
  });
});

describe('layout', () => {
  const VIEWPORTS = [
    [360, 640],
    [375, 667],
    [375, 812],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1280, 800],
    [1440, 900],
    [812, 375],
  ] as const;

  /** Every rectangle a hand of `cards` covers, for `count` hands of `cards` each. */
  const boxes = (w: number, h: number, count: number, cards: number, dealer: number) => {
    const l = layout(w, h, { dealer, hands: Array.from({ length: count }, () => cards) });
    return { l, hands: Array.from({ length: count }, (_x, i) => footprint(l, i, cards)) };
  };
  const apart = (
    a: { left: number; right: number; top: number; bottom: number },
    b: { left: number; right: number; top: number; bottom: number },
  ) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

  it('four hands of six cards, a dealer row and a shoe: all on the felt, none overlapping', () => {
    const wrong: unknown[] = [];
    for (const [w, h] of VIEWPORTS) {
      for (let count = 1; count <= 4; count += 1) {
        for (const cards of [2, 6, 9]) {
          const { l, hands } = boxes(w, h, count, cards, 7);
          const dealerLast = cardAt(l, 'dealer', 6);
          const dealerRow = {
            left: l.dealer.x - l.cardWidth / 2,
            right: dealerLast.x + l.cardWidth / 2,
            top: l.dealer.y - l.cardHeight / 2,
            bottom: l.dealer.y + l.cardHeight / 2 + 40,
          };
          const shoe = {
            left: l.shoe.x - l.cardWidth / 2,
            right: l.shoe.x + l.cardWidth / 2,
            top: l.shoe.y - l.cardHeight / 2,
            bottom: l.shoe.y + l.cardHeight / 2,
          };
          if (!apart(dealerRow, shoe)) wrong.push({ w, h, count, cards, dealerOverShoe: true });
          for (const [i, box] of hands.entries()) {
            const onFelt =
              box.left >= 0 && box.right <= w && box.top >= l.top && box.bottom <= l.bottom;
            if (!onFelt)
              wrong.push({ w, h, count, cards, hand: i, box, top: l.top, bottom: l.bottom });
            if (!apart(box, dealerRow))
              wrong.push({ w, h, count, cards, hand: i, underDealer: true });
            for (const [j, other] of hands.entries()) {
              if (j > i && !apart(box, other)) wrong.push({ w, h, count, cards, overlap: [i, j] });
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 3)).toEqual([]);
  });

  it('upright phones take four hands in two rows, with cards still a readable size', () => {
    for (const [w, h, least] of [
      [360, 640, 44],
      [375, 667, 48],
      [375, 812, 60],
      [390, 844, 64],
    ] as const) {
      const l = layout(w, h, { dealer: 2, hands: [6, 6, 6, 6] });
      expect({ w, h, rows: l.rows }).toEqual({ w, h, rows: 2 });
      expect(l.cardWidth).toBeGreaterThanOrEqual(least);
      // Two hands keep one row and grow: a split is not a reason to shrink the table.
      expect(layout(w, h, { dealer: 2, hands: [2, 2] }).rows).toBe(1);
    }
    expect(layout(1280, 800, { dealer: 2, hands: [6, 6, 6, 6] }).rows).toBe(1);
  });

  it('places a hand by the number of hands alone, so a split’s stake can go there first', () => {
    const before = layout(390, 844, { dealer: 2, hands: [1, 2] });
    const after = layout(390, 844, { dealer: 2, hands: [1, 7] });
    expect(after.hands).toEqual(before.hands);
    expect(chipAt(after, 1)).toEqual(chipAt(before, 1));
  });
});
