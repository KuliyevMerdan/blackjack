import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionReply } from '@blackjack/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { build, testConfig } from './__fixtures__/harness.js';
import { BootError } from './config.js';

const dir = mkdtempSync(path.join(tmpdir(), 'bj-web-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('one origin: the page, the API and the proof (ADR-0003)', () => {
  it('serves the built web app from / with the API beside it, never shadowed by a file', async () => {
    const web = path.join(dir, 'web');
    mkdirSync(path.join(web, 'assets'), { recursive: true });
    mkdirSync(path.join(web, 'fair', 'rounds'), { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>blackjack</title>');
    writeFileSync(path.join(web, 'assets', 'index-AbC123.js'), 'export {};');
    writeFileSync(path.join(web, 'ready'), 'a file that must not win');
    writeFileSync(path.join(web, 'fair', 'rounds', 'x'), 'nor this one');
    const { server } = build(testConfig({ BJ_STATIC_DIR: web }));
    const get = (url: string) => server.app.inject({ method: 'GET', url });

    const page = await get('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>blackjack</title>');
    // The page names the current assets, so it is never cached; the assets are named by content.
    expect(page.headers['cache-control']).toBe('no-cache');
    const asset = await get('/assets/index-AbC123.js');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    expect((await get('/ready')).json()).toEqual({ ready: true });
    expect((await get('/fair/rounds/x')).statusCode).toBe(400);
    const session = await server.app.inject({ method: 'POST', url: '/api/session', payload: {} });
    expect(sessionReply.parse(session.json()).round).toBeNull();
    expect((await get('/no-such-file.js')).statusCode).toBe(404);
    await server.close();
  });

  it('refuses to boot on a directory with no index.html', () => {
    expect(() => build(testConfig({ BJ_STATIC_DIR: path.join(dir, 'nowhere') }))).toThrow(
      BootError,
    );
  });
});
