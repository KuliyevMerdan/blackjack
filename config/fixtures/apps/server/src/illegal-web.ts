// FIXTURE — must be rejected by `nothing-imports-apps`: an app is composed of packages, not apps.
import { start } from '@blackjack/web';

export const leak = start;
