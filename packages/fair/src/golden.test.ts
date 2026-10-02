import { describe, expect, it } from 'vitest';
import { GOLDEN, GOLDEN_FULL } from './__fixtures__/golden.js';
import { commit, shoe, verifyCommit } from './index.js';

/**
 * ROADMAP S1: the shuffle is pinned by an independent implementation. If one of these changes, every
 * round ever dealt changes with it — the test is the contract, and the code is what has to move back.
 */
describe('the shoe matches the independent implementation', () => {
  it('pins 30 seed pairs', () => {
    expect(GOLDEN).toHaveLength(30);
  });

  it.each(GOLDEN.map((g, i) => [i, g] as const))('golden #%i', (_i, golden) => {
    expect(commit(golden.serverSeed)).toBe(golden.commit);
    expect(verifyCommit(golden.serverSeed, golden.commit)).toBe(true);
    expect(shoe(golden.serverSeed, golden.clientSeed).slice(0, 20)).toEqual(golden.top);
  });

  it('matches at every one of the 312 positions, not only the top', () => {
    const golden = GOLDEN[0];
    if (golden === undefined) throw new Error('no golden vectors');
    expect(shoe(golden.serverSeed, golden.clientSeed)).toEqual(GOLDEN_FULL);
  });
});
