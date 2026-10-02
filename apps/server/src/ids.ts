import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULIDs, monotonic — 48 bits of millisecond time, 80 bits of CSPRNG — the `roundId`s, which sort by
 * time (docs/protocol.md §2). Two ids in one millisecond would otherwise order at random, and
 * history pages by `roundId`; so within a millisecond (or a clock that stepped back) the random
 * part of the previous id is incremented instead, as the ULID spec's monotonic mode does.
 */
export function ulidFactory(): (now: number) => string {
  let lastTime = -1;
  let last: number[] = [];
  return (now) => {
    if (now <= lastTime) {
      last = increment(last);
    } else {
      lastTime = now;
      last = [...randomBytes(16)].map((byte) => byte % 32);
    }
    let time = '';
    let t = lastTime;
    for (let i = 0; i < 10; i += 1) {
      time = CROCKFORD.charAt(t % 32) + time;
      t = Math.floor(t / 32);
    }
    return time + last.map((digit) => CROCKFORD.charAt(digit)).join('');
  };
}

function increment(digits: readonly number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const digit = next[i] ?? 0;
    if (digit < 31) {
      next[i] = digit + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new RangeError('ULID random part overflowed within one millisecond');
}

/** A session token: 32 bytes of CSPRNG as hex (docs/protocol.md §2). It names a wallet. */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** The next round's server seed: 32 bytes of CSPRNG as hex (§3.1). Secret until settlement. */
export function newServerSeed(): string {
  return randomBytes(32).toString('hex');
}
