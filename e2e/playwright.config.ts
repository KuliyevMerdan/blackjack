import { defineConfig, devices } from '@playwright/test';

/**
 * The E2E suite (ROADMAP P1). Two ways to run it:
 *
 * - **Against a local server** (`pnpm e2e`, and CI): `apps/server` in development — so a shoe can be
 *   forced — with the network lab on, serving the production build of the web app from its own
 *   origin: the one-origin shape the deploy has (ADR-0003). Both specs run.
 * - **Against any deployed copy** (`E2E_BASE_URL=https://… pnpm e2e:live`): no server is started,
 *   and only the stranger spec runs — it touches nothing but the page, as a visitor would. A
 *   production server forces nothing, so the forced spec cannot.
 */
const live = process.env['E2E_BASE_URL'];
const PORT = 8096;

export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  outputDir: '../test-results',
  ...(live ? { testMatch: 'stranger.spec.ts' } : {}),
  use: {
    baseURL: live ?? `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  // An upright phone: the table's hardest layout, and the shape most strangers will open it in.
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  ...(live
    ? {}
    : {
        webServer: {
          command: 'node apps/server/dist/main.js',
          cwd: '..',
          url: `http://127.0.0.1:${PORT}/ready`,
          timeout: 30_000,
          reuseExistingServer: false,
          env: {
            BJ_ENV: 'development',
            BJ_DEV: 'on',
            BJ_FAULTS: 'on',
            BJ_STATIC_DIR: 'apps/web/dist',
            HOST: '127.0.0.1',
            PORT: String(PORT),
            LOG_LEVEL: 'warn',
          },
        },
      }),
});
