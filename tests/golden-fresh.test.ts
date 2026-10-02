import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lint-runner.js';

/**
 * The golden shoes in `@blackjack/fair` are only independent if nobody edited them by hand. This
 * reruns the Python implementation and requires its output, byte for byte — which is also why the
 * fixture is excluded from Prettier.
 */
describe('the golden fixture is what the independent implementation prints', () => {
  it('matches golden/shuffle.py exactly', () => {
    const fair = path.join(ROOT, 'packages/fair');
    const printed = execFileSync('python3', ['golden/shuffle.py'], { cwd: fair, encoding: 'utf8' });
    const committed = readFileSync(path.join(fair, 'src/__fixtures__/golden.ts'), 'utf8');
    expect(committed).toBe(printed);
  });
});
