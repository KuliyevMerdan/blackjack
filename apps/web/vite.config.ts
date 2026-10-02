import { defineConfig } from 'vite';

/**
 * The web shell. In development Vite serves it and proxies `/api` and `/fair` to `apps/server` on
 * :8080 (`pnpm dev` runs both); `BJ_SERVER` points the proxy elsewhere. `--mode perf` is a minified
 * build that keeps the dev hooks, for `scripts/perf.mjs`.
 */
const server = process.env['BJ_SERVER'] ?? 'http://127.0.0.1:8080';
const proxy = { '/api': server, '/fair': server };

export default defineConfig({
  server: { port: 5173, proxy },
  preview: { proxy },
  build: { target: 'es2022', sourcemap: true },
});
