import type { KeyValue } from '@blackjack/client-core';

/** The player's choices about the table's pace and help, remembered between visits. */
export interface Settings {
  /** Everything plays faster — a `timeScale` on the stage (ADR-0002). */
  readonly turbo: boolean;
  /** Nothing travels: cards appear where they land, one at a time (`REDUCED`). */
  readonly reducedMotion: boolean;
  /** Basic strategy's choice marked on the action bar — the table `tools/sim` measured. */
  readonly hint: boolean;
}

const KEY = 'bj:settings';

/** How much faster turbo plays. */
export const TURBO_SPEED = 2.5;

/**
 * What the player chose last time; the system's reduced-motion preference until they choose. A
 * stored value that is not ours — another version's, a hand edit — is ignored field by field.
 */
export function loadSettings(storage: KeyValue, prefersReducedMotion: boolean): Settings {
  const fallback: Settings = { turbo: false, reducedMotion: prefersReducedMotion, hint: false };
  let raw: unknown;
  try {
    const text = storage.get(KEY);
    if (text === null || text === '') return fallback;
    raw = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (typeof raw !== 'object' || raw === null) return fallback;
  const turbo = 'turbo' in raw && typeof raw.turbo === 'boolean' ? raw.turbo : fallback.turbo;
  const reducedMotion =
    'reducedMotion' in raw && typeof raw.reducedMotion === 'boolean'
      ? raw.reducedMotion
      : fallback.reducedMotion;
  const hint = 'hint' in raw && typeof raw.hint === 'boolean' ? raw.hint : fallback.hint;
  return { turbo, reducedMotion, hint };
}

export function saveSettings(storage: KeyValue, settings: Settings): void {
  try {
    storage.set(KEY, JSON.stringify(settings));
  } catch {
    // blocked storage: the choice holds for this visit
  }
}
