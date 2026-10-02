/**
 * The smallest browser a Pixi scene graph needs to exist in (borrowed from the sibling slots
 * project's setup, which proved it).
 *
 * `renderer`'s tests build and play scenes — containers, sprites, tweens — but never draw: the
 * atlas is faked and no Pixi renderer is created. Pixi reads two globals at import time; this stubs
 * those and nothing more. A test that needs more wants a real browser, and belongs in Playwright.
 */

const globals = globalThis as unknown as Record<string, unknown>;

globals['navigator'] ??= { userAgent: 'node', platform: 'node', maxTouchPoints: 0 };
globals['self'] ??= globalThis;
