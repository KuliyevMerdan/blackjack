// FIXTURE — must be rejected by `no-siblings`: nor is a relative path that walks out into ../slots.
import { sha256Hex } from '../../../../../../slots/packages/game-math/src/not-a-real-module';

export const leak = sha256Hex;
