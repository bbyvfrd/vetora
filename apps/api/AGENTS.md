# apps/api

## Overview

The vetora API: a Hono server on Node 24 that declares every route with a zod schema from `@vetora/contracts`, publishes its OpenAPI document, and reaches Postgres through Drizzle. It grows into a modular monolith with one module per bounded context under `src/modules/` (spec 0001), and the same image later carries the worker and the `migrate` command.

## Stack

- Hono 4 on `@hono/node-server`, routes through `@hono/zod-openapi` 1, zod 4 from the pnpm catalog
- Drizzle ORM 1.0 (pinned exactly to its release candidate) over `pg`, against Postgres 18
- pino for logs, `@sentry/node` 11 for error reports, tsx in development, plain `tsc` for the build (ESM, NodeNext)
- Shipped as a Docker image built from the repository root (`Dockerfile`, Turborepo prune) and rolled out with Kamal (`config/deploy.yml` plus a destination file per environment)

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | Startup: imports `instrument.js` first, validates the config, serves on `0.0.0.0`, and stops cleanly on SIGTERM and SIGINT (10 s cap) |
| `src/app.ts` | The `OpenAPIHono` app: request id and request log middleware, `/up`, `/api/health`, `/api/openapi.json`, the 404 and 500 handlers |
| `src/openapi.ts` | Writes the OpenAPI document to `packages/contracts/openapi.json` (run as `pnpm openapi` at the root) |
| `src/http/` | Route declarations (`createRoute`) and HTTP middleware |
| `src/platform/config.ts` | The zod validated environment behind `loadConfig()`; a `ConfigError` names the missing variables, never their values |
| `src/platform/db.ts` | The pooled and direct `pg` pools and the Drizzle instance: the only place a database client is created |
| `src/platform/log.ts` | The pino logger with redaction, and `scrubError()` for Postgres errors |
| `src/platform/problem.ts` | `problem()`, the problem details JSON (RFC 9457) every error uses |
| `src/modules/` | One folder per bounded context; `README.md` lists the thirteen, the data model feature creates them |
| `.env.example` | Every variable the API reads, with local values; copy it to `.env` |
| `tsconfig.build.json`, `vitest.config.ts` | The build config (tests left out of `dist/`) and the test runner's settings for this workspace (logger silent) |

## Commands

```bash
pnpm --filter @vetora/api dev         # node --watch through tsx, reads .env; needs pnpm local:up at the root
pnpm --filter @vetora/api build       # tsc -p tsconfig.build.json to dist/, tests left out
pnpm --filter @vetora/api typecheck
pnpm exec vitest run --project @vetora/api   # at the root; pnpm test runs every workspace
pnpm openapi                          # at the root: builds, writes openapi.json, regenerates the contracts types
kamal deploy -c apps/api/config/deploy.yml -d staging   # at the root; a destination is always required
```

## Conventions

- A route is a `createRoute` declaration whose schemas come from `@vetora/contracts`, never an inline shape; the API serves its routes under `/api` itself (kamal-proxy keeps the prefix, Vite proxies it in development).
- Every error is problem details JSON through `problem()`: 400 for validation (the `defaultHook`), 404 from `notFound`, 500 from `onError`, which scrubs the error, logs it with the request id, and reports it to Sentry.
- Modules reach each other only through their public interface or domain events, never through each other's tables; only `src/platform/` may import a database client (spec 0001, "Repository layout"). Biome enforces both: `pg` and `drizzle-orm/node-postgres` import only under `src/platform/` (`noRestrictedImports`), and inside `src/modules/` a module's `index.ts` is its public interface while every other export is visible only within that module's folder (`noPrivateImports`, package visibility).
- Request code runs through the pooler in transaction mode: no session state beyond `SET LOCAL`, no named prepared statements, no advisory locks. `direct()` is for LISTEN, the worker, and migrations.
- One JSON log line per request (method, path, status, duration, request id), never a body or a query string; `/up` is not logged.
- A new configuration variable goes into the zod schema in `config.ts`, into `.env.example`, into `config/deploy.yml` (`env.clear` or `env.secret`), and, when secret, into `.kamal/secrets-common`.
- Relative imports end in `.js` (NodeNext ESM with `verbatimModuleSyntax`); there is no bundler.
- Tests sit beside the code as `*.test.ts`: `tsconfig.json` (typecheck) includes them, `tsconfig.build.json` (build) leaves them out of `dist/`, and `vitest.config.ts` here silences the logger while they run.

## Gotchas

- `/up` is the liveness route for kamal-proxy and the uptime check: cheap, no database. `/api/health` is the one that touches the database.
- `instrument.ts` stays the first import of `index.ts`, or Sentry misses errors; without `SENTRY_DSN_API` it does nothing, which is the local setup.
- A route change changes the contract: run `pnpm openapi` and commit `packages/contracts/openapi.json` and `src/generated/api.ts`, or CI fails. The document's `info.version` is fixed at `0.1.0` so the committed file does not change per deploy.
- `@vetora/contracts` resolves from its `dist/`: rebuild it after editing a schema (`pnpm --filter @vetora/contracts build`); `dev` does not watch packages.
- Drizzle is `1.0.0-rc.5` while npm `latest` is still 0.45: bump only after reading the changelog, with `drizzle-kit` on the same version.
- The Dockerfile sets `CI=true`, so `pnpm install` inside the image build skips lefthook's hook installation (the build context has no git repository).
- The Kamal destination files hold placeholders (`STAGING_DROPLET_IP`, `staging.vetora.example`) until `infra/digitalocean.sh` has run, and the staging workflow stays inert until the `STAGING_READY` repository variable is set.

## Agent skills

- [better-auth-best-practices](../../.agents/skills/better-auth-best-practices/): `better-auth/skills`, the Better Auth server and client setup that slice 1 adds here (sign in, stored in the `control` schema)
- [organization-best-practices](../../.agents/skills/organization-best-practices/): `better-auth/skills`, the organization plugin (a practice is an organization): members, roles, permissions

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md): API conventions, tenancy and request context, configuration and secrets, deployment
- [0002 Data model](../../docs/specs/0002-data-model/index.md): the schemas, roles, migrate and provision commands, and the rules Postgres enforces

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
