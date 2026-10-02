/**
 * @blackjack/renderer — the stage: the felt, the shoe, the cards, and the beats that move them, with
 * Pixi v8 and GSAP on Pixi's ticker (ADR-0002). It knows cards and positions, never replies.
 */
export { buildAtlas, type CardTextures } from './atlas.js';
export {
  layout,
  cardAt,
  chipAt,
  footprint,
  CARD_RATIO,
  type Insets,
  type Layout,
  type Point,
  type Shape,
} from './layout.js';
export {
  EMPTY_PICTURE,
  type StageBeat,
  type StageCue,
  type StageHand,
  type StagePicture,
} from './picture.js';
export {
  Stage,
  driveGsapFromTicker,
  framesOnDemand,
  type Described,
  type Playback,
  type Proposal,
  type Proposed,
  type StageOptions,
} from './stage.js';
