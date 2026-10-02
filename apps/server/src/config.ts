import { minor, type Minor } from '@blackjack/money';
import { PUBLISHED_RULES, gameConfig, type GameConfig } from '@blackjack/protocol';
import { z } from 'zod';

/**
 * The server's configuration, read once from the environment.
 *
 * **The boot contract:** a production server refuses every development convenience, and names all
 * of the violations at once. A demo that boots with forced shoes or an in-memory wallet is a demo
 * whose fairness claim and whose balances are fiction.
 */
export interface ServerConfig {
  readonly env: 'development' | 'production';
  readonly host: string;
  readonly port: number;
  /** A file path, or `:memory:` (development and tests only). */
  readonly database: string;
  /** `BJ_DEV=on` — `forceShoe` on deals (docs/protocol.md §9). Never in production. */
  readonly dev: boolean;
  /**
   * `BJ_FAULTS=on` — sessions may inject faults into their own requests (§9). Allowed in production:
   * a player can only break their own connection, with faults the protocol recovers from — it is
   * how the live demo's network lab works.
   */
  readonly faults: boolean;
  readonly game: GameConfig;
  /** What a new session's wallet starts with — play money. */
  readonly startingBalance: Minor;
  readonly logLevel: string;
}

/** The demo's table (docs/protocol.md §2.2). */
export const DEFAULT_GAME: GameConfig = gameConfig.parse({
  currency: 'EUR',
  betUnit: 100,
  minBet: 100,
  maxBet: 10_000,
  rules: PUBLISHED_RULES,
});

const int = (fallback: number) => z.coerce.number().int().default(fallback);

const env = z.object({
  BJ_ENV: z.enum(['development', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(8080),
  BJ_DB: z.string().optional(),
  BJ_DEV: z.enum(['on', 'off']).optional(),
  BJ_FAULTS: z.enum(['on', 'off']).optional(),
  BJ_STARTING_BALANCE: int(100_000),
  BJ_MIN_BET: int(DEFAULT_GAME.minBet),
  BJ_MAX_BET: int(DEFAULT_GAME.maxBet),
  LOG_LEVEL: z.string().default('info'),
});

export class BootError extends Error {
  override readonly name = 'BootError';
  constructor(readonly violations: readonly string[]) {
    super(`refusing to boot:\n  - ${violations.join('\n  - ')}`);
  }
}

export function readConfig(source: Record<string, string | undefined>): ServerConfig {
  const parsed = env.safeParse(source);
  if (!parsed.success) {
    throw new BootError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const production = e.BJ_ENV === 'production';
  const violations: string[] = [];

  if (production && e.BJ_DB === undefined) violations.push('BJ_DB must name a database file');
  if (production && e.BJ_DB === ':memory:') {
    violations.push('BJ_DB=:memory: loses every wallet and every open hand on restart');
  }
  if (production && e.BJ_DEV === 'on') {
    violations.push('BJ_DEV=on lets a client choose the cards it is dealt');
  }
  if (e.BJ_STARTING_BALANCE < 0) violations.push('BJ_STARTING_BALANCE must not be negative');

  const game = gameConfig.safeParse({
    ...DEFAULT_GAME,
    minBet: e.BJ_MIN_BET,
    maxBet: e.BJ_MAX_BET,
  });
  if (!game.success) {
    for (const issue of game.error.issues)
      violations.push(`${issue.path.join('.')}: ${issue.message}`);
  }
  if (violations.length > 0 || !game.success) throw new BootError(violations);

  return {
    env: e.BJ_ENV,
    host: e.HOST,
    port: e.PORT,
    database: e.BJ_DB ?? ':memory:',
    dev: (e.BJ_DEV ?? 'off') === 'on',
    faults: (e.BJ_FAULTS ?? 'off') === 'on',
    game: game.data,
    startingBalance: minor(e.BJ_STARTING_BALANCE),
    logLevel: e.LOG_LEVEL,
  };
}
