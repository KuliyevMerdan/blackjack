import type { Card } from '@blackjack/cards';
import { RANKS, SUITS } from '@blackjack/cards';
import { Container, Graphics, Rectangle, Text, Texture, type Renderer } from 'pixi.js';

/** The card faces and the back, as textures. Everything downstream asks for these and nothing else. */
export interface CardTextures {
  face(card: Card): Texture;
  readonly back: Texture;
  destroy(): void;
}

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL: Record<string, string> = { T: '10' };
const RED = 0xc62828;
const BLACK = 0x1b1b1f;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * The atlas — **drawn at boot into one texture** (CLAUDE.md § Gaps, decided in C1). 52 faces and a
 * back, from `Graphics` and `Text`, rendered once at the device's pixel ratio and sliced into
 * frames that share one source — so the whole card layer batches into one draw call, and the
 * repository ships no art and no licence. Measured in `scripts/perf.mjs`: boot time and the atlas'
 * size at 3× DPR.
 *
 * Thirteen columns by five rows of `width`-wide cells: at 3× and the default width of 96 that is a
 * 3,744 × 2,010 texture, under the 4,096 limit of the weakest mobile GPUs.
 */
export function buildAtlas(renderer: Renderer, width = 96, resolution = 2): CardTextures {
  const height = Math.round(width * (88 / 63));
  const sheet = new Container();
  const cell = (col: number, row: number) => ({ x: col * width, y: row * height });

  RANKS.forEach((rank, col) => {
    SUITS.forEach((suit, row) => {
      const face = drawFace(rank, suit, width, height);
      const at = cell(col, row);
      face.position.set(at.x, at.y);
      sheet.addChild(face);
    });
  });
  const back = drawBack(width, height);
  back.position.set(0, 4 * height);
  sheet.addChild(back);

  const source = renderer.generateTexture({
    target: sheet,
    resolution,
    antialias: true,
    frame: new Rectangle(0, 0, 13 * width, 5 * height),
  });
  sheet.destroy({ children: true });

  const frames = new Map<string, Texture>();
  RANKS.forEach((rank, col) =>
    SUITS.forEach((suit, row) => {
      const at = cell(col, row);
      frames.set(
        `${rank}${suit}`,
        new Texture({ source: source.source, frame: new Rectangle(at.x, at.y, width, height) }),
      );
    }),
  );
  const backTexture = new Texture({
    source: source.source,
    frame: new Rectangle(0, 4 * height, width, height),
  });
  return {
    face(card) {
      const texture = frames.get(card);
      if (texture === undefined) throw new RangeError(`no face for ${card}`);
      return texture;
    },
    back: backTexture,
    destroy() {
      source.destroy(true);
    },
  };
}

function drawFace(rank: string, suit: string, width: number, height: number): Container {
  const color = suit === 'H' || suit === 'D' ? RED : BLACK;
  const card = new Container();
  const radius = width * 0.08;
  card.addChild(
    new Graphics()
      .roundRect(1, 1, width - 2, height - 2, radius)
      .fill({ color: 0xfbfaf7 })
      .stroke({ width: 1.5, color: 0xc9c4b8 }),
  );
  const label = `${RANK_LABEL[rank] ?? rank}`;
  const glyph = SUIT_GLYPH[suit] ?? '?';
  const corner = new Text({
    text: `${label}\n${glyph}`,
    style: {
      fontFamily: FONT,
      fontSize: width * 0.2,
      fontWeight: '700',
      fill: color,
      align: 'center',
      lineHeight: width * 0.2,
    },
  });
  corner.position.set(width * 0.07, height * 0.05);
  card.addChild(corner);
  const pip = new Text({
    text: glyph,
    style: { fontFamily: FONT, fontSize: width * 0.5, fill: color },
  });
  pip.anchor.set(0.5);
  pip.position.set(width * 0.56, height * 0.56);
  card.addChild(pip);
  return card;
}

function drawBack(width: number, height: number): Container {
  const card = new Container();
  const radius = width * 0.08;
  const inset = width * 0.07;
  const g = new Graphics()
    .roundRect(1, 1, width - 2, height - 2, radius)
    .fill({ color: 0xfbfaf7 })
    .stroke({ width: 1.5, color: 0xc9c4b8 })
    .roundRect(inset, inset, width - inset * 2, height - inset * 2, radius * 0.6)
    .fill({ color: 0x8e1b2c });
  // Concentric diamonds — a back that reads as a back at 40 px wide and at 120.
  const cx = width / 2;
  const cy = height / 2;
  for (let r = width * 0.08; r < width * 0.42; r += width * 0.075) {
    g.poly([cx, cy - r * 1.35, cx + r, cy, cx, cy + r * 1.35, cx - r, cy]).stroke({
      width: 1.2,
      color: 0xd9a35b,
      alpha: 0.75,
    });
  }
  card.addChild(g);
  return card;
}
