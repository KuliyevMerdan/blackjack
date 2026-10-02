import { describe, expect, it } from 'vitest';
import { playRound, stacked } from './__fixtures__/rounds.js';
import { INSTANT, NORMAL, TURBO } from './pace.js';
import { applyBeat, pictureOf, type Beat } from './picture.js';
import { direct } from './script.js';

const kinds = (beats: readonly { beat: Beat }[]) => beats.map((c) => c.beat.kind);

describe('every script ends in its snapshot’s picture', () => {
  it('over every reply of 5,000 random rounds — and every cue’s picture is the beats so far', () => {
    let steps = 0;
    const wrong: unknown[] = [];
    for (let i = 0; i < 5000; i += 1) {
      for (const step of playRound(i)) {
        steps += 1;
        const script = direct(step.previous, step.events, step.next, step.balance, NORMAL);
        let picture = script.from;
        for (const cue of script.cues) {
          picture = applyBeat(picture, cue.beat);
          if (JSON.stringify(picture) !== JSON.stringify(cue.after)) wrong.push({ i, cue });
        }
        if (JSON.stringify(script.to) !== JSON.stringify(pictureOf(step.next))) {
          wrong.push({ i, to: script.to, expected: pictureOf(step.next) });
        }
        // The HUD climbs only on a payout, never falls inside a script, and ends at the truth.
        let hud = script.hudBefore;
        for (const cue of script.cues) {
          if (cue.hud < hud) wrong.push({ i, hudFell: cue });
          hud = cue.hud;
        }
        if (hud !== step.balance) wrong.push({ i, hud, balance: step.balance });
      }
    }
    expect(wrong.slice(0, 3)).toEqual([]);
    expect(steps).toBeGreaterThan(5000);
  });
});

describe('the deal', () => {
  it('deals in the pinned order, the hole face down, and ends on the decision', () => {
    const [deal] = playRound(0, () => 'stand', stacked('9H', 'KS', '9C', '7D'));
    if (deal === undefined) throw new Error('no deal');
    const script = direct(null, deal.events, deal.next, deal.balance, NORMAL);
    expect(script.cues.map((c) => c.beat)).toEqual([
      { kind: 'clear', stake: 500 },
      { kind: 'card', to: 0, face: '9H' },
      { kind: 'card', to: 'dealer', face: 'KS' },
      { kind: 'card', to: 0, face: '9C' },
      { kind: 'card', to: 'dealer', face: null },
      { kind: 'peek', blackjack: false },
      { kind: 'active', hand: 0 },
      { kind: 'decision' },
    ]);
    expect(script.to.dealer).toEqual(['KS', null]);
    expect(JSON.stringify(script)).not.toContain('7D');
  });

  it('lays the cues end to end, the dealer pausing before each card of their own', () => {
    // 9-7 v 5, stand; the dealer turns a six (11) and draws 2, 3, 4 to 20.
    const steps = playRound(0, () => 'stand', stacked('9H', '5S', '7C', '6D', '2S', '3H', '4C'));
    const last = steps.at(-1);
    if (last === undefined) throw new Error('no steps');
    const script = direct(last.previous, last.events, last.next, last.balance, NORMAL);
    for (const [i, cue] of script.cues.entries()) {
      const prev = script.cues[i - 1];
      const end = prev === undefined ? 0 : prev.at + prev.ms;
      const draw = cue.beat.kind === 'card' && cue.beat.to === 'dealer';
      expect(cue.at).toBe(draw ? end + NORMAL.dealerPause : end);
    }
    expect(kinds(script.cues)).toEqual([
      'stood',
      'active',
      'flip',
      'card',
      'card',
      'card',
      'settle',
    ]);
  });

  it('keeps the payout off the HUD until its result plays', () => {
    const [deal] = playRound(0, () => 'stand', stacked('AH', '9S', 'KC', '7D'));
    if (deal === undefined) throw new Error('no deal');
    const script = direct(null, deal.events, deal.next, deal.balance, NORMAL);
    const settle = script.cues.find((c) => c.beat.kind === 'settle');
    expect(script.hudBefore).toBe(deal.balance - 1250);
    expect(settle?.hud).toBe(deal.balance);
    expect(
      script.cues.filter((c) => c.at < (settle?.at ?? 0)).every((c) => c.hud === script.hudBefore),
    ).toBe(true);
  });
});

describe('pace', () => {
  it('scales, and instant is all zeros', () => {
    const [deal] = playRound(3);
    if (deal === undefined) throw new Error('no deal');
    const normal = direct(null, deal.events, deal.next, deal.balance, NORMAL).duration;
    const turbo = direct(null, deal.events, deal.next, deal.balance, TURBO).duration;
    expect(turbo).toBeLessThan(normal * 0.45);
    expect(direct(null, deal.events, deal.next, deal.balance, INSTANT).duration).toBe(0);
  });

  /**
   * The ROADMAP asks for the median length of a round at normal pace, measured. This is the
   * animation alone — every script of a round end to end, the player's thinking time not counted —
   * over 5,000 rounds of basic-strategy-like play (stand on 17+, hit below, never insure).
   */
  it('a round of animation lasts about four seconds at normal pace', () => {
    const lengths: number[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const steps = playRound(i, (state) => {
        const hand = state.activeHand === null ? null : state.hands[state.activeHand];
        if (hand === null || hand === undefined) return 'noInsurance';
        const total = hand.cards.reduce(
          (t, c) => t + Math.min(10, 'A23456789'.indexOf(c[0] ?? '') + 1 || 10),
          0,
        );
        return total >= 17 ? 'stand' : 'hit';
      });
      lengths.push(
        steps.reduce(
          (sum, s) => sum + direct(s.previous, s.events, s.next, s.balance, NORMAL).duration,
          0,
        ),
      );
    }
    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
    const p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 0;
    expect({ median, p90 }).toEqual({ median: expect.any(Number), p90: expect.any(Number) });
    expect(median).toBeGreaterThan(3000);
    expect(median).toBeLessThan(6000);
    console.info(`round animation at NORMAL: median ${median} ms, p90 ${p90} ms`);
  });
});
