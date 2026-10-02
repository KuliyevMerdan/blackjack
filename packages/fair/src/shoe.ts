import { canonicalShoe, type Card } from '@blackjack/cards';
import { bytesToHex, hexToBytes, utf8 } from './bytes.js';
import { hmacKey, hmacSha256, sha256 } from './sha256.js';

/** A server seed on the wire: 32 bytes as 64 lowercase hex characters (docs/protocol.md §3.1). */
export const SERVER_SEED = /^[0-9a-f]{64}$/;

/** A client seed: 1–64 printable ASCII characters, space to tilde (docs/protocol.md §3.1). */
export const CLIENT_SEED = /^[\x20-\x7e]{1,64}$/;

export const DECKS = 6;

function seedBytes(serverSeed: string): Uint8Array {
  if (!SERVER_SEED.test(serverSeed)) {
    throw new RangeError('a server seed is 64 lowercase hex characters');
  }
  return hexToBytes(serverSeed);
}

function checkClientSeed(clientSeed: string): void {
  if (!CLIENT_SEED.test(clientSeed)) {
    throw new RangeError('a client seed is 1–64 printable ASCII characters');
  }
}

/** `SHA-256(serverSeed)` over the 32 raw bytes, as bare lowercase hex — what the server publishes. */
export function commit(serverSeed: string): string {
  return bytesToHex(sha256(seedBytes(serverSeed)));
}

export function verifyCommit(serverSeed: string, published: string): boolean {
  return SERVER_SEED.test(serverSeed) && commit(serverSeed) === published;
}

/**
 * The shuffle's randomness (docs/protocol.md §3.2, step 2): block `k` is
 * `HMAC-SHA256(serverSeed, "<clientSeed>:<k>")`, read as consecutive big-endian 32-bit words.
 * Returned as a function so the shuffle pulls exactly as many words as rejection asks for and no
 * block is computed that is not read.
 */
export function wordStream(serverSeed: string, clientSeed: string): () => number {
  const key = hmacKey(seedBytes(serverSeed));
  checkClientSeed(clientSeed);
  let block: Uint8Array = new Uint8Array(0);
  let counter = 0;
  let offset = 32;
  return () => {
    if (offset === 32) {
      block = hmacSha256(key, utf8(`${clientSeed}:${counter}`));
      counter++;
      offset = 0;
    }
    const word =
      (((block[offset] ?? 0) << 24) |
        ((block[offset + 1] ?? 0) << 16) |
        ((block[offset + 2] ?? 0) << 8) |
        (block[offset + 3] ?? 0)) >>>
      0;
    offset += 4;
    return word;
  };
}

const TWO_32 = 0x1_0000_0000;

/**
 * A uniform integer in `[0, n)` from a stream of uniform 32-bit words, by rejection: words at or
 * above the largest multiple of `n` below 2³² are discarded. Without that step, `2³² mod n` values
 * of `word mod n` would come up once more than the rest — small, and exactly the kind of bias a
 * verifier exists to rule out.
 */
export function below(n: number, next: () => number): number {
  if (!Number.isSafeInteger(n) || n < 1 || n > TWO_32) {
    throw new RangeError(`n must be an integer from 1 to 2^32: ${n}`);
  }
  const limit = TWO_32 - (TWO_32 % n);
  for (;;) {
    const word = next();
    if (word < limit) return word % n;
  }
}

/**
 * Fisher–Yates from the top, in place (docs/protocol.md §3.2, step 3): for `i` from the last index
 * down to 1, swap position `i` with a uniform position in `[0, i]`. Every permutation of the input
 * is equally likely given uniform words.
 */
export function shuffleInPlace<T>(items: T[], next: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = below(i + 1, next);
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) throw new RangeError('shuffle index out of range');
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/**
 * The round's shoe: the canonical six decks, shuffled from both seeds (ADR-0001). Dealing takes
 * index 0, then 1, and so on. Pure: the same seeds give the same shoe on every runtime, which is
 * the whole of what the verification page relies on.
 */
export function shoe(serverSeed: string, clientSeed: string, decks: number = DECKS): Card[] {
  return shuffleInPlace(canonicalShoe(decks), wordStream(serverSeed, clientSeed));
}
