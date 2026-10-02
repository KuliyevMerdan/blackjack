import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes, hmacKey, hmacSha256, sha256, utf8 } from './index.js';

const hex = (bytes: Uint8Array) => bytesToHex(bytes);

describe('sha256 — FIPS 180-4 vectors', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('hashes %j', (message, digest) => {
    expect(hex(sha256(utf8(message)))).toBe(digest);
  });

  it('hashes a million "a"', () => {
    expect(hex(sha256(new Uint8Array(1_000_000).fill(0x61)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('pads correctly at every length around a block boundary', () => {
    // 55 bytes is the longest message whose padding fits its own block; 56 spills into a second.
    const digests = [54, 55, 56, 63, 64, 65].map((n) => hex(sha256(new Uint8Array(n))));
    expect(new Set(digests).size).toBe(6);
    expect(digests[1]).toBe('02779466cdec163811d078815c633f21901413081449002f24aa3e80f0b88ef7');
    expect(digests[2]).toBe('d4817aa5497628e7c77e6b606107042bbba3130888c5f47a375e6179be789fbb');
  });
});

describe('hmacSha256 — RFC 4231 vectors', () => {
  it.each([
    // [case, key, data, mac]
    [
      1,
      '0b'.repeat(20),
      '4869205468657265',
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    ],
    [
      2,
      '4a656665',
      '7768617420646f2079612077616e7420666f72206e6f7468696e673f',
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    ],
    [
      3,
      'aa'.repeat(20),
      'dd'.repeat(50),
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    ],
    [
      4,
      '0102030405060708090a0b0c0d0e0f10111213141516171819',
      'cd'.repeat(50),
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    ],
    [
      6,
      'aa'.repeat(131),
      '54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374',
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    ],
  ])('case %i', (_case, key, data, mac) => {
    expect(hex(hmacSha256(hexToBytes(key), hexToBytes(data)))).toBe(mac);
  });

  it('gives the same MAC from a precomputed key as from raw bytes', () => {
    const key = hexToBytes('11'.repeat(32));
    const prepared = hmacKey(key);
    for (const message of ['', 'a', 'seed:0', 'x'.repeat(200)]) {
      expect(hex(hmacSha256(prepared, utf8(message)))).toBe(hex(hmacSha256(key, utf8(message))));
    }
  });
});

describe('bytes', () => {
  it('round-trips hex', () => {
    const value = '00ff10a0';
    expect(bytesToHex(hexToBytes(value))).toBe(value);
  });

  it.each(['0', 'FF', 'zz', 'abc'])('refuses %j as hex', (value) => {
    expect(() => hexToBytes(value)).toThrow(RangeError);
  });

  it('encodes UTF-8 by hand', () => {
    expect([...utf8('a~')]).toEqual([0x61, 0x7e]);
    expect([...utf8('é€😀')]).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
  });
});
