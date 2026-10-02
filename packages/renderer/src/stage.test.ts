import { gsap } from 'gsap';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLANK, scriptsOf } from './__fixtures__/scripts.js';
import { cardAt, layout } from './layout.js';
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
  });

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
    expect(s.stats()).toEqual({ cards: onTable, sprites: onTable, tweens: 0, playing: false });
    s.destroy();
  });

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

describe('layout', () => {
  it('keeps every hand on screen and apart, from one hand to four, portrait and landscape', () => {
    for (const [w, h] of [
      [375, 667],
      [390, 844],
      [1280, 800],
    ] as const) {
      for (let count = 1; count <= 4; count += 1) {
        const l = layout(w, h, count);
        for (let i = 0; i < count; i += 1) {
          const first = cardAt(l, i, 0);
          const fifth = cardAt(l, i, 4);
          expect(first.x - l.cardWidth / 2).toBeGreaterThanOrEqual(0);
          expect(fifth.x + l.cardWidth / 2).toBeLessThanOrEqual(w);
          const next = i + 1 < count ? cardAt(l, i + 1, 0) : null;
          if (next) expect(next.x - first.x).toBeGreaterThan(l.cardWidth);
        }
      }
    }
  });
});
