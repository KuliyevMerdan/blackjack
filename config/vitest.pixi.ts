import { defineConfig } from 'vitest/config';

/** `vitest.package.ts` plus the two globals Pixi touches when it is imported (`pixi-headless.ts`). */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    setupFiles: ['../../config/pixi-headless.ts'],
  },
});
