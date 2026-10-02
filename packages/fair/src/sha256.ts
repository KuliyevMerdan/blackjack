/**
 * SHA-256 (FIPS 180-4) and HMAC-SHA256 (RFC 2104) in plain TypeScript.
 *
 * Not `crypto.subtle`: it is asynchronous, absent from some contexts the verifier runs in, and the
 * engine path that deals a shoe must be synchronous and identical everywhere. Not `node:crypto`:
 * this package runs in the browser (ADR-0001). Correctness is pinned by the NIST and RFC 4231
 * vectors in `sha256.test.ts`, and the shuffle built on it by an independent Python implementation.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const W = new Uint32Array(64);

/** One compression of a 64-byte block at `offset` into `state`, in place. */
function compress(state: Uint32Array, block: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    W[i] =
      ((block[j] ?? 0) << 24) |
      ((block[j + 1] ?? 0) << 16) |
      ((block[j + 2] ?? 0) << 8) |
      (block[j + 3] ?? 0);
  }
  for (let i = 16; i < 64; i++) {
    const w15 = W[i - 15] ?? 0;
    const w2 = W[i - 2] ?? 0;
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = ((W[i - 16] ?? 0) + s0 + (W[i - 7] ?? 0) + s1) | 0;
  }
  let a = state[0] ?? 0;
  let b = state[1] ?? 0;
  let c = state[2] ?? 0;
  let d = state[3] ?? 0;
  let e = state[4] ?? 0;
  let f = state[5] ?? 0;
  let g = state[6] ?? 0;
  let h = state[7] ?? 0;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + (K[i] ?? 0) + (W[i] ?? 0)) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = ((state[0] ?? 0) + a) | 0;
  state[1] = ((state[1] ?? 0) + b) | 0;
  state[2] = ((state[2] ?? 0) + c) | 0;
  state[3] = ((state[3] ?? 0) + d) | 0;
  state[4] = ((state[4] ?? 0) + e) | 0;
  state[5] = ((state[5] ?? 0) + f) | 0;
  state[6] = ((state[6] ?? 0) + g) | 0;
  state[7] = ((state[7] ?? 0) + h) | 0;
}

/**
 * Finishes a hash that has already absorbed `prefixBlocks` full blocks into `state`: absorbs
 * `message`, pads, and returns the digest. `sha256` is this from the IV with no prefix; HMAC starts
 * from the key's precomputed inner and outer states, which is what makes a shuffle's ~40 HMACs cost
 * two compressions each instead of four.
 */
function finish(start: Uint32Array, prefixBlocks: number, message: Uint8Array): Uint8Array {
  const state = Uint32Array.from(start);
  const full = Math.floor(message.length / 64);
  for (let i = 0; i < full; i++) compress(state, message, i * 64);

  const rest = message.length - full * 64;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(message.subarray(full * 64));
  tail[rest] = 0x80;
  const bits = (prefixBlocks * 64 + message.length) * 8;
  const view = new DataView(tail.buffer);
  view.setUint32(tail.length - 8, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(tail.length - 4, bits >>> 0);
  for (let offset = 0; offset < tail.length; offset += 64) compress(state, tail, offset);

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, state[i] ?? 0);
  return out;
}

export function sha256(message: Uint8Array): Uint8Array {
  return finish(IV, 0, message);
}

/** A key, absorbed once: the inner and outer states HMAC resumes from for every message. */
export interface HmacKey {
  readonly inner: Uint32Array;
  readonly outer: Uint32Array;
}

export function hmacKey(key: Uint8Array): HmacKey {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const ipad = block.map((byte) => byte ^ 0x36);
  const opad = block.map((byte) => byte ^ 0x5c);
  const inner = Uint32Array.from(IV);
  const outer = Uint32Array.from(IV);
  compress(inner, ipad, 0);
  compress(outer, opad, 0);
  return { inner, outer };
}

export function hmacSha256(key: HmacKey | Uint8Array, message: Uint8Array): Uint8Array {
  const k = key instanceof Uint8Array ? hmacKey(key) : key;
  return finish(k.outer, 1, finish(k.inner, 1, message));
}
