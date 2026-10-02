import { direct, NORMAL, type Script } from '@blackjack/director';
import { act, allowed, deal, view } from '@blackjack/engine';
import { bytesToHex, sha256, shoe, utf8 } from '@blackjack/fair';
import { minor } from '@blackjack/money';
import { PUBLISHED_RULES, rules } from '@blackjack/protocol';
import { Texture } from 'pixi.js';
import type { CardTextures } from '../atlas.js';

/** Every script of one real round, at normal pace: the director's output for each reply. */
export function scriptsOf(index: number): Script[] {
  const serverSeed = bytesToHex(sha256(utf8(`renderer:${index}`)));
  const cards = shoe(serverSeed, 'renderer');
  let seed = index * 2654435761 + 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const first = deal(
    {
      type: 'deal',
      rules: rules.parse(PUBLISHED_RULES),
      seeds: {
        roundId: '01K6H3Z8Q4M2V7XKX0C9T5RB1N',
        commit: 'ab'.repeat(32),
        clientSeed: 'renderer',
        serverSeed,
        forced: false,
      },
      stake: minor(500),
      balance: minor(100_000),
    },
    cards,
  );
  if (!first.ok) throw new Error(first.refusal);
  const scripts = [direct(null, first.events, view(first.state), first.state.balance, NORMAL)];
  let state = first.state;
  while (state.phase !== 'SETTLED') {
    const offered = allowed(state);
    const next = act(state, offered[Math.floor(random() * offered.length)] ?? 'stand', cards);
    if (!next.ok) throw new Error(next.refusal);
    scripts.push(direct(view(state), next.events, view(next.state), next.state.balance, NORMAL));
    state = next.state;
  }
  return scripts;
}

/** Textures with nothing in them — the stage's tests read faces back, not pixels. */
export const BLANK: CardTextures = {
  face: () => Texture.EMPTY,
  back: Texture.EMPTY,
  destroy: () => {},
};
