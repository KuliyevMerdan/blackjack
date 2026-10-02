import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, runForJson } from './lint-runner.js';

/**
 * Proves the dependency rules fire.
 *
 * `pnpm lint:boundaries` scans the real workspace and (correctly) finds nothing — which says nothing
 * about whether the rules work. These are known-illegal imports that must each be rejected by a
 * named rule, and legal ones that must not be.
 */

const FIXTURES = path.join(ROOT, 'config/fixtures');
const CONFIG = path.join(ROOT, '.dependency-cruiser.cjs');

function ruleNamesFor(fixture: string): string[] {
  const report = runForJson(
    'depcruise',
    [fixture, '--config', CONFIG, '--output-type', 'json'],
    FIXTURES,
  ) as { summary: { violations: Array<{ rule: { name: string } }> } };
  return report.summary.violations.map((v) => v.rule.name);
}

describe('dependency boundaries', () => {
  it.each([
    ['packages/renderer/src/illegal-protocol.ts', 'renderer-deps'],
    ['apps/web/src/table/illegal-engine.ts', 'engine-only-in-verify'],
    ['packages/director/src/illegal-pixi.ts', 'stage-libs-stay-on-stage'],
    ['packages/director/src/illegal-gsap.ts', 'stage-libs-stay-on-stage'],
    ['packages/engine/src/illegal-fair.ts', 'engine-deps'],
    ['packages/engine/src/illegal-client-core.ts', 'engine-deps'],
    ['packages/engine/src/illegal-fastify.ts', 'packages-no-server-libs'],
    ['packages/engine/src/illegal-fs.ts', 'packages-no-node-builtins'],
    ['packages/engine/src/illegal-deep-import.ts', 'no-cross-package-deep-imports'],
    ['packages/fair/src/illegal-slots-package.ts', 'no-siblings'],
    ['packages/fair/src/illegal-slots-path.ts', 'no-siblings'],
    ['packages/fair/src/illegal-crash-package.ts', 'no-siblings'],
    ['packages/fair/src/illegal-crash-path.ts', 'no-siblings'],
    ['packages/client-core/src/illegal-react.ts', 'no-react'],
    ['apps/server/src/illegal-web.ts', 'nothing-imports-apps'],
    ['tools/sim/src/illegal-server.ts', 'sim-deps'],
    ['tools/sim/src/illegal-server.ts', 'nothing-imports-apps'],
    ['tools/load/src/illegal-engine.ts', 'load-deps'],
  ])('rejects %s — %s', (fixture, rule) => {
    expect(ruleNamesFor(fixture)).toContain(rule);
  });

  it.each([
    'packages/renderer/src/legal.ts',
    'packages/director/src/legal.ts',
    'packages/engine/src/legal.ts',
    'apps/web/src/legal.ts',
    'apps/web/src/verify/legal.ts',
  ])('accepts %s', (fixture) => {
    expect(ruleNamesFor(fixture)).toEqual([]);
  });
});
