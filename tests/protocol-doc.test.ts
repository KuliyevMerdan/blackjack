import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENDPOINTS, ERROR_CLASSES, ERROR_CODES, EVENT_TYPES } from '@blackjack/protocol';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lint-runner.js';

/**
 * "The protocol document and `packages/protocol` change together, in one commit, always"
 * (CLAUDE.md). This is the part of that rule a machine can check: the endpoint table in §2, the event
 * table in §2.8 and the error table in §6 name exactly what the schemas accept.
 */
const doc = readFileSync(path.join(ROOT, 'docs/protocol.md'), 'utf8');

function section(heading: string, next: string): string {
  const start = doc.indexOf(heading);
  const end = doc.indexOf(next, start + heading.length);
  if (start < 0 || end < 0) throw new Error(`protocol.md has no section "${heading}"`);
  return doc.slice(start, end);
}

function rows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

const ticked = (cell: string | undefined) =>
  [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('docs/protocol.md and @blackjack/protocol name the same contract', () => {
  it('documents exactly the endpoints in ENDPOINTS (§2)', () => {
    // A row may name several paths under one method: `/health` · `/ready`.
    const documented = rows(section('| Method | Path | What |', '### 2.1')).flatMap((cells) =>
      ticked(cells[2]).map((p) => `${ticked(cells[1])[0]} ${p}`),
    );
    expect(documented.sort()).toEqual(ENDPOINTS.map((e) => `${e.method} ${e.path}`).sort());
  });

  it('documents exactly the event types in the schemas (§2.8)', () => {
    const documented = rows(section('### 2.8 Events', '## 3. The shoe')).map(
      (cells) => ticked(cells[1])[0],
    );
    expect(documented.sort()).toEqual([...EVENT_TYPES].sort());
  });

  it.each(ERROR_CLASSES)('lists exactly the %s codes in §6', (cls) => {
    const row = rows(section('## 6. Errors', '## 7.')).find((cells) => cells[1] === `\`${cls}\``);
    const codes = ticked(row?.[3]).filter((code) => /^[A-Z_]+$/.test(code ?? ''));
    expect(codes.sort()).toEqual([...ERROR_CODES[cls]].sort());
  });
});
