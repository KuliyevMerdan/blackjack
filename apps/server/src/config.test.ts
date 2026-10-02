import { describe, expect, it } from 'vitest';
import { BootError, DEFAULT_GAME, readConfig } from './config.js';

describe('readConfig', () => {
  it('boots a development server with no environment at all', () => {
    const config = readConfig({});
    expect(config).toMatchObject({ env: 'development', database: ':memory:', dev: false });
    expect(config.game).toEqual(DEFAULT_GAME);
  });

  it('refuses every development convenience in production, naming them all at once', () => {
    const boot = () => readConfig({ BJ_ENV: 'production', BJ_DB: ':memory:', BJ_DEV: 'on' });
    expect(boot).toThrow(BootError);
    try {
      boot();
    } catch (error) {
      expect(error instanceof BootError && error.violations).toHaveLength(2);
    }
    expect(() => readConfig({ BJ_ENV: 'production' })).toThrow(/BJ_DB must name/);
    expect(readConfig({ BJ_ENV: 'production', BJ_DB: '/data/bj.db' }).dev).toBe(false);
  });

  it('allows faults in production — a session can only break its own connection (§9)', () => {
    const config = readConfig({ BJ_ENV: 'production', BJ_DB: '/data/bj.db', BJ_FAULTS: 'on' });
    expect(config.faults).toBe(true);
    expect(readConfig({}).faults).toBe(false);
  });

  it('names the built web app’s directory, or none', () => {
    expect(readConfig({ BJ_STATIC_DIR: '/app/web' }).staticDir).toBe('/app/web');
    expect(readConfig({}).staticDir).toBeNull();
    expect(() => readConfig({ BJ_STATIC_DIR: '' })).toThrow(/BJ_STATIC_DIR/);
  });

  it('refuses a table whose stakes could make an inexact payout', () => {
    expect(() => readConfig({ BJ_MIN_BET: '150' })).toThrow(/multiple of betUnit/);
  });
});
