// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GOLDEN, GOLDEN_FULL } from './__fixtures__/golden.js';
import { bytesToHex, commit, sha256, shoe, utf8 } from './index.js';

/**
 * ROADMAP S1: `fair` runs under both Node and a DOM environment. The rest of this package's suite
 * runs in Node; this file runs in happy-dom, with `window` and `document` present, and must reach
 * the same answers — the verification page's situation exactly.
 */
describe('fair in a DOM environment', () => {
  it('really is one', () => {
    // Read through globalThis: the package has no DOM lib, which is the point of it.
    expect('window' in globalThis).toBe(true);
    expect(typeof Reflect.get(globalThis, 'document')).toBe('object');
  });

  it('hashes the NIST "abc" vector', () => {
    expect(bytesToHex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each(GOLDEN.map((g, i) => [i, g] as const))('deals golden #%i', (_i, golden) => {
    expect(commit(golden.serverSeed)).toBe(golden.commit);
    expect(shoe(golden.serverSeed, golden.clientSeed).slice(0, 20)).toEqual(golden.top);
  });

  it('deals the whole golden shoe', () => {
    const golden = GOLDEN[0];
    if (golden === undefined) throw new Error('no golden vectors');
    expect(shoe(golden.serverSeed, golden.clientSeed)).toEqual(GOLDEN_FULL);
  });
});
