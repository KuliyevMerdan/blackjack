import { gsap } from 'gsap';
import { describe, expect, it } from 'vitest';
import { framesOnDemand } from './stage.js';

/** A ticker this test turns by hand: `tick(ms)` is one frame at that time. */
function ticker(at: number) {
  const listeners: (() => void)[] = [];
  const t = {
    started: true,
    lastTime: at,
    start() {
      t.started = true;
      t.lastTime = now; // as Pixi's: a restart is at the present
    },
    stop() {
      t.started = false;
    },
    add(fn: () => void) {
      listeners.push(fn);
    },
    tick(ms: number) {
      now = ms;
      if (!t.started) return;
      t.lastTime = ms;
      gsap.updateRoot(ms / 1000);
      listeners.forEach((fn) => fn());
    },
  };
  let now = at;
  return { t, setNow: (ms: number) => (now = ms) };
}

describe('framesOnDemand', () => {
  gsap.ticker.remove(gsap.updateRoot);

  it('stops after a few still frames, and starts again on a wake', () => {
    const { t } = ticker(0);
    let idle = false;
    const wake = framesOnDemand(t, () => idle, 3);
    for (let f = 1; f <= 5; f += 1) t.tick(f * 16);
    expect(t.started).toBe(true); // not idle yet
    idle = true;
    for (let f = 6; f <= 9; f += 1) t.tick(f * 16);
    expect(t.started).toBe(false);
    wake();
    expect(t.started).toBe(true);
  });

  it('a tween begun after a quiet minute plays from its start, not a minute in', () => {
    const { t, setNow } = ticker(1_000);
    t.tick(1_000);
    const wake = framesOnDemand(t, () => true, 1);
    t.tick(1_016);
    t.tick(1_032);
    expect(t.started).toBe(false);
    setNow(61_032); // a minute passes with no frames drawn
    wake();
    const target = { x: 0 };
    gsap.to(target, { x: 100, duration: 1, ease: 'none' });
    t.tick(61_532); // half a second later
    expect(target.x).toBeCloseTo(50, 0);
  });
});
