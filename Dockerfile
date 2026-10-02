# The live demo, containerised (ROADMAP P1, ADR-0003). One image, one origin: `apps/server` serves
# the API (`/api/*`), the public fairness records (`/fair/*`) and the built web app (`/`) from one
# port, so the deployed page needs no CORS, no second host and no proxy.
#
#   docker build -t blackjack .
#   docker run --rm -p 8080:8080 -e BJ_FAULTS=on blackjack     →  http://localhost:8080/
#
# A production server: no forced shoes, no in-memory wallet — the boot contract refuses both. The
# network lab's faults are a host's choice (`BJ_FAULTS=on` — render.yaml makes it), since they touch
# only the session that asks for them (docs/protocol.md §9).

# Debian, not Alpine: better-sqlite3 ships prebuilt binaries for glibc, so the install downloads
# one instead of compiling SQLite — no python, make or g++ in the image.
FROM node:22-bookworm-slim AS build
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000
WORKDIR /repo

# The pnpm that package.json pins (`packageManager`), as its own layer. Through npm, not corepack:
# corepack's download has no retry, and one connection cut mid-tarball fails the build.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" && pnpm --version

# The layer-cache split: the install depends on the lockfile and the manifests, which change
# rarely, not on source, which changes daily. Every manifest is listed because --frozen-lockfile
# checks the lockfile against the whole workspace.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/cards/package.json packages/cards/
COPY packages/client-core/package.json packages/client-core/
COPY packages/director/package.json packages/director/
COPY packages/engine/package.json packages/engine/
COPY packages/fair/package.json packages/fair/
COPY packages/money/package.json packages/money/
COPY packages/protocol/package.json packages/protocol/
COPY packages/renderer/package.json packages/renderer/
COPY packages/strategy/package.json packages/strategy/
COPY tools/load/package.json tools/load/
COPY tools/sim/package.json tools/sim/
RUN pnpm install --frozen-lockfile --filter "@blackjack/server..." --filter "@blackjack/web..."

COPY . .
# Each unit and everything under it, in dependency order. The web app is the production build:
# the probes' `__bj` handle is compiled out.
RUN pnpm --filter "@blackjack/server..." --filter "@blackjack/web..." run build
# A standalone production tree for the server (its workspace packages as their built `dist/`),
# with the web app's static bundle beside it.
RUN pnpm --filter @blackjack/server --prod --legacy deploy /out \
 && cp -r apps/web/dist /out/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    BJ_ENV=production \
    BJ_STATIC_DIR=/app/web \
    BJ_DB=/app/data/blackjack.db
WORKDIR /app
COPY --from=build --chown=node:node /out .
# The database's directory. A host with a disk mounts one here and wallets, open rounds and the
# history survive a restart; one without (Render's free tier) starts each boot with a fresh table
# (ADR-0003).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
# 8080 unless the host says otherwise: a platform that injects PORT (Render) is obeyed.
EXPOSE 8080
# /ready answers once the store answers.
HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
