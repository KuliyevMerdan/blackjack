import type { Action } from '@blackjack/protocol';

/** The action bar's keys — printed on each button and announced with it (`aria-keyshortcuts`). */
export const KEYS: Readonly<Record<Action, string>> = {
  hit: 'H',
  stand: 'S',
  double: 'D',
  split: 'P',
  insurance: 'I',
  noInsurance: 'N',
};

export type Intent =
  | { readonly kind: 'act'; readonly action: Action }
  | { readonly kind: 'deal' }
  | { readonly kind: 'skip' };

export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /** The press landed on the page itself, not on a control that handles keys of its own. */
  readonly onPage: boolean;
}

/**
 * A key to what the player means. Letters act; Enter deals and Space skips only from the page itself
 * — on a focused button they are that button's own keys. Escape always skips. A key with a modifier
 * is the browser's.
 */
export function intentOf(press: KeyPress): Intent | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  if (press.key === 'Escape') return { kind: 'skip' };
  if (press.key === ' ') return press.onPage ? { kind: 'skip' } : null;
  if (press.key === 'Enter') return press.onPage ? { kind: 'deal' } : null;
  const letter = press.key.toUpperCase();
  for (const [action, key] of Object.entries(KEYS)) {
    if (key === letter && isAction(action)) return { kind: 'act', action };
  }
  return null;
}

function isAction(value: string): value is Action {
  return value in KEYS;
}
