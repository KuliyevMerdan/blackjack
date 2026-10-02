import { RANKS, card, type Card } from '@blackjack/cards';
import { describe, expect, it } from 'vitest';
import { ROWS } from './chart.js';
import { recommend, type Decision } from './recommend.js';

const cards = (...codes: string[]): Card[] => codes.map((c) => card(c));
const OPEN: Decision[] = ['hit', 'stand', 'double', 'split'];
const NO_SPLIT: Decision[] = ['hit', 'stand', 'double'];
const LATER: Decision[] = ['hit', 'stand'];

describe('recommend — the chart, read', () => {
  it.each([
    // [hand, up card, allowed, expected]
    [['9S', '7H'], 'TD', LATER, 'hit'], // 16 v T: no surrender, hit
    [['9S', '7H'], '6D', LATER, 'stand'],
    [['TS', '2H'], '3D', LATER, 'hit'], // 12 v 3
    [['TS', '2H'], '4D', LATER, 'stand'],
    [['6S', '5H'], 'AD', NO_SPLIT, 'hit'], // 11 v A at S17
    [['6S', '5H'], 'TD', NO_SPLIT, 'double'],
    [['5S', '4H'], '2D', NO_SPLIT, 'hit'], // 9 v 2
    [['5S', '4H'], '3D', NO_SPLIT, 'double'],
    [['AS', '7H'], '6D', NO_SPLIT, 'double'], // soft 18 v 6
    [['AS', '7H'], '2D', NO_SPLIT, 'stand'],
    [['AS', '7H'], '9D', NO_SPLIT, 'hit'],
    [['AS', '2H', '4C'], '6D', LATER, 'hit'], // soft 17, three cards: no double, so hit
    [['AS', '3H', '4C'], '6D', LATER, 'stand'], // soft 18 doubles only on two cards: stand
    [['AS', '8H'], '6D', NO_SPLIT, 'stand'], // soft 19 at S17
    [['AS', 'AH'], 'TD', OPEN, 'split'],
    [['8S', '8H'], 'AD', OPEN, 'split'],
    [['8S', '8H'], 'TD', LATER, 'hit'], // four hands already: 8-8 is a hard 16
    [['9S', '9H'], '7D', OPEN, 'stand'],
    [['9S', '9H'], '8D', OPEN, 'split'],
    [['5S', '5H'], '9D', OPEN, 'double'], // fives are a hard ten
    [['KS', 'TH'], '6D', OPEN, 'stand'], // a ten-value pair splits by value, and never should
    [['4S', '4H'], '5D', OPEN, 'split'],
    [['4S', '4H'], '4D', OPEN, 'hit'],
    [['AS', '5H'], 'AD', ['stand'], 'stand'], // a split ace, hit not offered
  ] as const)('%j v %s, allowed %j → %s', (hand, up, allowed, expected) => {
    expect(recommend(cards(...hand), card(up), allowed)).toBe(expected);
  });

  it('never takes insurance', () => {
    expect(recommend(cards('AS', 'KH'), card('AD'), ['insurance', 'noInsurance'])).toBe(
      'noInsurance',
    );
  });

  it('always answers with something allowed, for every two-card hand, up card and offer', () => {
    const offers: Decision[][] = [OPEN, NO_SPLIT, LATER, ['stand'], ['hit', 'stand', 'split']];
    const wrong: string[] = [];
    for (const a of RANKS) {
      for (const b of RANKS) {
        for (const up of RANKS) {
          for (const allowed of offers) {
            const choice = recommend(cards(`${a}S`, `${b}H`), card(`${up}D`), allowed);
            if (!allowed.includes(choice)) wrong.push(`${a}${b} v ${up}: ${choice}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('has ten cells in every row, each a code', () => {
    for (const rows of Object.values(ROWS)) {
      for (const row of Object.values(rows)) expect(row).toMatch(/^[HSDdP]{10}$/);
    }
  });
});
