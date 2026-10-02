import type { Faults as Settings, FaultsRequest } from '@blackjack/protocol';

/**
 * Injected faults (docs/protocol.md §9, `BJ_FAULTS=on`), per session and in memory only — a restart
 * clears them. Each session breaks only its own connection, so the live demo's network lab cannot
 * touch anyone else's table.
 *
 * The table never sees any of this: a fault happens around a request (a wait, a refusal before it,
 * a reply thrown away after it), never inside one — so a dropped reply is always one whose action
 * applied and was stored, exactly the case `actionId` replay exists for (§7).
 */
export const NO_FAULTS: Settings = {
  latencyMs: 0,
  dropRate: 0,
  unavailableRate: 0,
  dropNext: 0,
  stormNext: 0,
};

export class Faults {
  private readonly sessions = new Map<string, Settings>();

  constructor(private readonly random: () => number = Math.random) {}

  get(token: string): Settings {
    return this.sessions.get(token) ?? NO_FAULTS;
  }

  set(token: string, patch: FaultsRequest): Settings {
    const next: Settings = { ...this.get(token), ...definedOf(patch) };
    if (sameAs(next, NO_FAULTS)) this.sessions.delete(token);
    else this.sessions.set(token, next);
    return next;
  }

  /** Before a game request: how long to hold it, and whether to refuse it unapplied. */
  before(token: string): { readonly delayMs: number; readonly unavailable: boolean } {
    const f = this.get(token);
    if (f === NO_FAULTS) return { delayMs: 0, unavailable: false };
    let unavailable = false;
    if (f.stormNext > 0) {
      this.sessions.set(token, { ...f, stormNext: f.stormNext - 1 });
      unavailable = true;
    } else if (f.unavailableRate > 0 && this.random() < f.unavailableRate) {
      unavailable = true;
    }
    return { delayMs: f.latencyMs, unavailable };
  }

  /** After a deal or an act applied: whether its reply goes missing. */
  drop(token: string): boolean {
    const f = this.get(token);
    if (f === NO_FAULTS) return false;
    if (f.dropNext > 0) {
      this.sessions.set(token, { ...this.get(token), dropNext: f.dropNext - 1 });
      return true;
    }
    return f.dropRate > 0 && this.random() < f.dropRate;
  }
}

function definedOf(patch: FaultsRequest): Partial<Settings> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
}

function sameAs(a: Settings, b: Settings): boolean {
  return (
    a.latencyMs === b.latencyMs &&
    a.dropRate === b.dropRate &&
    a.unavailableRate === b.unavailableRate &&
    a.dropNext === b.dropNext &&
    a.stormNext === b.stormNext
  );
}
