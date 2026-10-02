# Rule fixtures

These files are **deliberately illegal**. They exist so that [`tests/`](../../tests) can prove the
project's structural rules actually fire — a rule nobody has seen fail is a rule you are trusting,
not enforcing. `pnpm lint:boundaries` scanning the real workspace and finding nothing tells you
nothing on its own; these are the other half.

| Fixture | Proves | Enforced by |
| --- | --- | --- |
| `packages/renderer/src/illegal-protocol.ts` | the renderer cannot see a reply — S0's "Done when" | [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) |
| `apps/web/src/table/illegal-engine.ts` | the game screen cannot run the engine — S0's "Done when" | `.dependency-cruiser.cjs` |
| `apps/web/src/verify/legal.ts` | the verification page *may* replay through the engine | `.dependency-cruiser.cjs` |
| `apps/web/src/legal.ts` | the web shell's allow-list, Pixi and GSAP included, is *not* flagged | `.dependency-cruiser.cjs` |
| `packages/renderer/src/legal.ts` | the renderer reading cards and driving Pixi and GSAP is *not* flagged | `.dependency-cruiser.cjs` |
| `packages/director/src/illegal-{pixi,gsap}.ts` | the director writes beats as data, without the stage's libraries | `.dependency-cruiser.cjs` |
| `packages/director/src/legal.ts` | the director's whole allow-list is *not* flagged | `.dependency-cruiser.cjs` |
| `packages/engine/src/illegal-fair.ts` | the engine is handed its shoe; it does not shuffle one | `.dependency-cruiser.cjs` |
| `packages/engine/src/illegal-client-core.ts` | the engine knows nothing of the client | `.dependency-cruiser.cjs` |
| `packages/engine/src/illegal-fastify.ts` | no package imports the HTTP server | `.dependency-cruiser.cjs` |
| `packages/engine/src/illegal-fs.ts` | no package imports a Node builtin | `.dependency-cruiser.cjs` |
| `packages/engine/src/illegal-deep-import.ts` | a unit is reached through its entry point, never its `src/` | `.dependency-cruiser.cjs` |
| `packages/engine/src/legal.ts` | the engine's whole allow-list is *not* flagged | `.dependency-cruiser.cjs` |
| `packages/fair/src/illegal-{slots,crash}-{package,path}.ts` | nothing from `../slots` or `../crash`, by package name or relative path | `.dependency-cruiser.cjs` |
| `packages/client-core/src/illegal-react.ts` | there is no React in this repository | `.dependency-cruiser.cjs` |
| `apps/server/src/illegal-web.ts` | nothing imports an app | `.dependency-cruiser.cjs` |
| `tools/sim/src/illegal-server.ts` | the sim measures the engine, not the server | `.dependency-cruiser.cjs` |
| `tools/load/src/illegal-engine.ts` | the load tool plays over the wire, as a client does | `.dependency-cruiser.cjs` |
| `packages/{engine,cards,fair,money,strategy,director}/src/impure.ts` | each pure package is held to the purity rules | [`eslint.config.mjs`](../../eslint.config.mjs) |
| `packages/cards/src/unsafe.ts` | no `any`, no `!`, no `as` in source — and `as const` stays legal | `eslint.config.mjs` |
| `packages/protocol/src/index.ts` | (legal) the target the deep-import fixture reaches into | — |

They are excluded from TypeScript and ESLint in normal runs, and `pnpm lint:boundaries`
scans only `packages/`, `apps/` and `tools/`. Nothing here is compiled or shipped. The paths mirror
the real workspace because both rule sets match on path.

The sibling path fixtures point at modules that do not exist, on purpose: they must resolve the same
way on a machine with `../slots` and `../crash` checked out beside this one and on CI, where they are
not.
