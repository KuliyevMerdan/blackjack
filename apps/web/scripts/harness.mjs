// The table the browser probes play against: the minified `--mode perf` build of the web app (it
// keeps the dev hooks) behind `vite preview`, and the built server behind it. Shared by
// `perf.mjs` (C1) and `decisions.mjs` (C2). Needs a built server (`pnpm build`).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../../..');
const vite = path.join(root, 'apps/web/node_modules/vite/bin/vite.js');

export async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // not up yet — ask again
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Builds the page, starts the server on `server` and the preview on `web`, and waits for both.
 * `env` is the server's — `BJ_DEV: 'on'` for forced shoes. Returns the page's URL and the stop.
 */
export async function startTable({ server, web, env = {} }) {
  const children = [];
  const run = (args, extra, cwd = root) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...extra },
      stdio: 'ignore',
    });
    children.push(child);
  };
  const stop = () => children.forEach((c) => c.kill('SIGTERM'));
  process.on('exit', stop);

  await new Promise((resolve, reject) => {
    const build = spawn(
      process.execPath,
      [vite, 'build', '--mode', 'perf', '--outDir', 'dist-perf', '--logLevel', 'warn'],
      { cwd: path.join(root, 'apps/web'), stdio: 'inherit' },
    );
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`)),
    );
  });
  run(['apps/server/dist/main.js'], {
    PORT: String(server),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    BJ_STARTING_BALANCE: '10000000',
    ...env,
  });
  run(
    [
      vite,
      'preview',
      '--outDir',
      'dist-perf',
      '--host',
      '127.0.0.1',
      '--port',
      String(web),
      '--strictPort',
    ],
    { BJ_SERVER: `http://127.0.0.1:${server}` },
    path.join(root, 'apps/web'),
  );
  await until(
    () => fetch(`http://127.0.0.1:${server}/ready`).then((r) => r.ok),
    20_000,
    'the server',
  );
  await until(() => fetch(`http://127.0.0.1:${web}/`).then((r) => r.ok), 20_000, 'the web preview');
  return { url: `http://127.0.0.1:${web}/`, stop };
}
