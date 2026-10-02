/** A string key–value store: `localStorage` in the browser, a `Map` anywhere else. */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** A `KeyValue` that forgets everything — the default, and a test's. */
export function inMemory(): KeyValue {
  const map = new Map<string, string>();
  return { get: (key) => map.get(key) ?? null, set: (key, value) => void map.set(key, value) };
}

/** What this browser sent for a round: the verifier holds the server's record to it (§3.4 step 2). */
export interface Sent {
  readonly roundId: string;
  readonly commit: string;
  readonly clientSeed: string;
}

const ROUNDS = 'bj:rounds';
const KEEP = 100;

/**
 * The commits and client seeds this client dealt under, newest last, at most 100 — the
 * history's length. Storage that throws or holds garbage reads as empty: remembering is a
 * convenience for the verifier, never a reason for a deal to fail.
 */
export class SentRounds {
  constructor(private readonly store: KeyValue) {}

  all(): Sent[] {
    try {
      const parsed: unknown = JSON.parse(this.store.get(ROUNDS) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isSent) : [];
    } catch {
      return [];
    }
  }

  find(roundId: string): Sent | null {
    return this.all().find((r) => r.roundId === roundId) ?? null;
  }

  add(sent: Sent): void {
    const kept = [...this.all().filter((r) => r.roundId !== sent.roundId), sent].slice(-KEEP);
    try {
      this.store.set(ROUNDS, JSON.stringify(kept));
    } catch {
      // full or blocked storage: the round is played either way
    }
  }
}

function isSent(value: unknown): value is Sent {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'roundId' in value &&
    typeof value.roundId === 'string' &&
    'commit' in value &&
    typeof value.commit === 'string' &&
    'clientSeed' in value &&
    typeof value.clientSeed === 'string'
  );
}
