/**
 * The dependency graph in CLAUDE.md § Dependency rules, enforced.
 *
 * Every workspace unit has two spellings that must both be matched, because one that has not been
 * built yet cannot be resolved to a file: `packages/<name>/…` (resolved) and `@blackjack/<name>`
 * (unresolved). The leading `(\.\./)*` is what lets `config/fixtures/` prove these rules fire: a
 * cruise rooted there reports a unit as `../../packages/<name>/…`, and a rule that only matched the
 * unprefixed spelling would pass the fixtures for the wrong reason.
 */
const WORKSPACE = '^(\\.\\./)*((packages|apps|tools)/[^/]+/|@blackjack/[^/]+$)';

/** Matches only the named workspace units, in either spelling. */
const only = (...names) =>
  `^(\\.\\./)*((packages|apps|tools)/(${names.join('|')})/|@blackjack/(${names.join('|')})$)`;

/** Test code: a `*.test.ts` file, or anything under a `__fixtures__/` directory. */
const TEST_CODE = '(\\.test\\.ts$|/__fixtures__/)';

const list = (names) => names.map((n) => `@blackjack/${n}`).join(', ') || '(nothing)';

/**
 * `from` a unit, `to` anywhere in the workspace that is not on its allow-list. A unit may always
 * reach its own modules; the rule is about what crosses a boundary.
 */
const mayOnlyDependOn = (where, name, ...allowed) => ({
  name: `${name}-deps`,
  comment: `@blackjack/${name} may only depend on: ${list(allowed)} — CLAUDE.md § Dependency rules.`,
  severity: 'error',
  from: { path: `^${where}/${name}/src/` },
  to: { path: WORKSPACE, pathNot: only(name, ...allowed) },
});

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle between units means the boundary is not real.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // The graph, one allow-list per unit.
    mayOnlyDependOn('packages', 'money'),
    mayOnlyDependOn('packages', 'cards'),
    mayOnlyDependOn('packages', 'protocol', 'money', 'cards'),
    mayOnlyDependOn('packages', 'fair', 'cards'),
    /**
     * The engine deals from an array it is handed; where the array came from is the server's
     * business and the verifier's. Its allow-list leaving out `fair` IS that rule.
     */
    mayOnlyDependOn('packages', 'engine', 'protocol', 'money', 'cards'),
    mayOnlyDependOn('packages', 'strategy', 'cards'),
    /**
     * What `client-core` ships may reach only the contract and money. Its tests drive it against a
     * fake server built from the real engine and shuffle — the client tested against the real
     * rules, not against a second implementation of them written for a test — so test code alone
     * gets the wider list.
     */
    {
      ...mayOnlyDependOn('packages', 'client-core', 'protocol', 'money'),
      from: { path: '^packages/client-core/src/', pathNot: TEST_CODE },
    },
    {
      ...mayOnlyDependOn('packages', 'client-core', 'protocol', 'money', 'engine', 'fair', 'cards'),
      name: 'client-core-test-deps',
      from: { path: '^packages/client-core/src/(__fixtures__/|[^/]+\\.test\\.ts$)' },
    },
    mayOnlyDependOn('packages', 'director', 'protocol', 'money', 'cards'),
    /**
     * `renderer` plays beats and does not know what a reply is — the seam that lets the table be
     * tested without a server. Its allow-list leaving out `protocol` IS that rule.
     */
    mayOnlyDependOn('packages', 'renderer', 'cards'),
    mayOnlyDependOn('apps', 'server', 'engine', 'protocol', 'money', 'cards', 'fair'),
    mayOnlyDependOn(
      'apps',
      'web',
      'client-core',
      'director',
      'renderer',
      'protocol',
      'money',
      'cards',
      'fair',
      'strategy',
      'engine',
    ),
    mayOnlyDependOn('tools', 'sim', 'engine', 'strategy', 'fair', 'cards', 'money', 'protocol'),
    /** The load tool plays as a client does — through `client-core`, never the engine. */
    mayOnlyDependOn('tools', 'load', 'client-core', 'strategy', 'protocol', 'money', 'cards'),

    // The hard rules on top of the graph.
    {
      name: 'engine-only-in-verify',
      comment:
        'The verification page replays a settled hand through the engine; the game screen never runs it. A table that ran the engine could start deciding things (CLAUDE.md).',
      severity: 'error',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/verify/' },
      to: { path: only('engine') },
    },
    {
      name: 'stage-libs-stay-on-stage',
      comment:
        'Pixi and GSAP belong to the renderer and the web shell. The director writes choreography as data — timing is a number in a beat, not a tween (ADR-0002).',
      severity: 'error',
      from: { path: '^(packages|tools|apps/server)/', pathNot: '^packages/renderer/' },
      to: { path: '(^|/)(pixi\\.js|@pixi/[^/]+|gsap)(/|$)' },
    },
    {
      name: 'no-react',
      comment:
        'No React anywhere: the shell is small enough that a framework would be the largest thing in it (CLAUDE.md § Packages).',
      severity: 'error',
      from: {},
      to: { path: '(^|/)(react|react-dom)(/|$)' },
    },
    {
      name: 'nothing-imports-apps',
      comment:
        'An app composes packages; nothing composes an app. Not a package, a tool, or the other app.',
      severity: 'error',
      from: { path: '^(packages|tools|apps)/([^/]+)/' },
      to: {
        path: '^(\\.\\./)*(apps/[^/]+/|@blackjack/(server|web)$)',
        pathNot: '^apps/$2/',
      },
    },
    {
      name: 'no-siblings',
      comment:
        'This repository is standalone: nothing from ../slots or ../crash, by path or by package name. A "just this one type" copy is how standalone projects quietly become one.',
      severity: 'error',
      from: {},
      to: { path: '^(\\.\\./)+(slots|crash)(/|$)|^@(slot|crash)/' },
    },
    {
      name: 'packages-no-node-builtins',
      comment:
        'Every package either runs in the browser or must be able to — fair, cards and engine on the verification page, the rest under purity rules that forbid I/O. Node belongs to apps/server and tools/*.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'packages-no-server-libs',
      comment:
        'The HTTP framework, the logger and the database belong to apps/server. The engine returns events; it never writes (CLAUDE.md).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '(^|/)(fastify|@fastify|pino|better-sqlite3)(/|$)' },
    },
    {
      name: 'no-cross-package-deep-imports',
      comment:
        'Reach another unit through its entry point, never into its src/. A unit with a real public surface is a unit with a real boundary.',
      severity: 'error',
      from: { path: '^(packages|apps|tools)/([^/]+)/' },
      to: { path: '^(\\.\\./)*(packages|apps|tools)/[^/]+/src/', pathNot: '^$1/$2/' },
    },
  ],
  options: {
    /**
     * `doNotFollow` rather than `exclude` for `dist/`, and the difference is the whole enforcement: a
     * workspace import resolves to the target's built entry point, and excluding `dist` would delete
     * that edge — so an illegal import would be caught only while it was undeclared, and adding the
     * dependency to package.json (the normal way anyone introduces one) would silence the rule.
     */
    doNotFollow: { path: '(^|/)(node_modules|dist)(/|$)' },
    exclude: { path: '(^|/)\\.turbo(/|$)' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
  },
};
