# apps/api

## Overview

The vetora API: a Hono server on Node 24 that declares every route with a zod schema from `@vetora/contracts`, publishes its OpenAPI document, and reaches Postgres through Drizzle. It grows into a modular monolith with one module per bounded context under `src/modules/` (spec 0001); the same image carries the `migrate` command (`dist/migrate.js`) and later the worker.

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
| `src/migrate.ts` | The `migrate` command: parses `--dry-run`, loads `DATABASE_URL_MIGRATOR` through `loadMigratorConfig()`, maps the migrator's outcome to exit codes 0 (current), 1 (failed), 2 (lock held) |
| `src/http/` | Route declarations (`createRoute`) and HTTP middleware |
| `src/platform/config.ts` | The zod validated environment behind `loadConfig()` (the API) and `loadMigratorConfig()` (the commands); a `ConfigError` names the missing variables, never their values |
| `src/platform/db/index.ts` | The pooled and direct `pg` pools and the Drizzle instance: the only place the API creates a database client (the migrator and the test support open their own `pg.Client`) |
| `src/platform/db/migrator.ts` | The migrate engine: one direct `pg.Client` as `vetora_migrator`, the advisory lock (`MIGRATE_LOCK_KEY`), the control set through Drizzle's `migrate()` with `control.__drizzle_migrations` as the truth, the registry read in apply order (`created_at`, `id`); the practice set and the grants pass arrive with the next data model tickets |
| `src/platform/db/control-schema.ts`, `practice-schema.ts` | The Drizzle declarations drizzle-kit reads: `control.practice` (the registry) in the control set; the practice set gathers the modules' `schema.ts` files (empty until the first practice tables land) |
| `src/platform/db/test-support.ts` | The `vetora_test` URLs derived from `DATABASE_URL_MIGRATOR` and `DATABASE_URL_DIRECT`, the reset (`control`, `ext`, every `p_*` schema with its `p_*_role`), and the Vitest `globalSetup`; left out of `dist/` by `tsconfig.build.json` |
| `src/platform/log.ts` | The pino logger with redaction, and `scrubError()` for Postgres errors, down the `cause` chain Drizzle wraps them in |
| `src/platform/problem.ts` | `problem()`, the problem details JSON (RFC 9457) every error uses |
| `src/modules/` | One folder per bounded context; `README.md` lists the thirteen, the data model feature creates them |
| `drizzle.control.config.ts`, `drizzle.practice.config.ts` | The two drizzle-kit configs behind `db:generate:control` and `db:generate:practice`: the schema file, the `out` folder, and the migrations table per set |
| `drizzle/control/`, `drizzle/practice/` | The migration sets, one folder per migration (`<timestamp_name>/migration.sql` beside drizzle-kit's `snapshot.json`), copied into the image beside `dist/`; the SQL is finished by hand (extensions, functions, grants), so a later `generate` is empty |
| `.env.example` | Every variable the API and its commands read, with local values; copy it to `.env` |
| `tsconfig.build.json`, `vitest.config.ts` | The build config (tests and the test support left out of `dist/`) and the test runner's settings for this workspace (logger silent, `.env` loaded, the test database reset in `globalSetup`) |

## Commands

```bash
pnpm --filter @vetora/api dev         # node --watch through tsx, reads .env; needs pnpm local:up at the root
pnpm --filter @vetora/api build       # tsc -p tsconfig.build.json to dist/, tests left out
pnpm --filter @vetora/api typecheck
pnpm exec vitest run --project @vetora/api   # at the root; pnpm test runs every workspace
pnpm openapi                          # at the root: builds, writes openapi.json, regenerates the contracts types
pnpm --filter @vetora/api migrate     # reads .env when present; the control set, then the registry; add --dry-run to list and change nothing (no `--`: pnpm 10 passes it to node)
pnpm --filter @vetora/api db:generate:control --name <name>   # after editing control-schema.ts; finish the SQL by hand
pnpm --filter @vetora/api db:generate:practice --name <name>  # the practice set (first migration with the next ticket)
kamal deploy -c apps/api/config/deploy.yml -d staging   # at the root; a destination is always required
```

## Conventions

- A route is a `createRoute` declaration whose schemas come from `@vetora/contracts`, never an inline shape; the API serves its routes under `/api` itself (kamal-proxy keeps the prefix, Vite proxies it in development).
- Every error is problem details JSON through `problem()`: 400 for validation (the `defaultHook`), 404 from `notFound`, 500 from `onError`, which scrubs the error, logs it with the request id, and reports it to Sentry.
- Modules reach each other only through their public interface or domain events, never through each other's tables; only `src/platform/` may import a database client (spec 0001, "Repository layout"). Biome enforces both: `pg` and `drizzle-orm/node-postgres` import only under `src/platform/` (`noRestrictedImports`), and inside `src/modules/` a module's `index.ts` is its public interface while every other export is visible only within that module's folder (`noPrivateImports`, package visibility).
- Request code runs through the pooler in transaction mode: no session state beyond `SET LOCAL`, no named prepared statements, no advisory locks. `direct()` is for LISTEN and the worker; the commands open their own `pg.Client` on `DATABASE_URL_MIGRATOR`.
- Migrations are forward only and generated in order (`db:generate:*`), one folder per migration under `drizzle/<set>/`; Drizzle applies every pending migration of a set in one transaction, so none may use `CREATE INDEX CONCURRENTLY`. drizzle-kit models tables only: extensions, functions, triggers, and grants are appended by hand to the generated `migration.sql`, each statement after a `--> statement-breakpoint` line; a new control table grants SELECT to `vetora_backup` there (dumps read everything). The migrate command exits 0 when current, 1 when the run did not complete (a batch failed and was rolled back, or the configuration or connection failed), 2 when another run holds the lock.
- One JSON log line per request (method, path, status, duration, request id), never a body or a query string; `/up` is not logged.
- A new configuration variable goes into the zod schema in `config.ts`, into `.env.example`, into `config/deploy.yml` (`env.clear` or `env.secret`), and, when secret, into `.kamal/secrets-common`.
- Relative imports end in `.js` (NodeNext ESM with `verbatimModuleSyntax`); there is no bundler.
- Tests sit beside the code as `*.test.ts`: `tsconfig.json` (typecheck) includes them, `tsconfig.build.json` (build) leaves them out of `dist/`, and `vitest.config.ts` here silences the logger while they run.
- Database tests (`migrator.test.ts`) run when `DATABASE_URL_MIGRATOR` and `DATABASE_URL_DIRECT` are set (`vitest.config.ts` loads the workspace `.env`; CI sets them after `docker compose up -d --wait postgres`) and are skipped otherwise. They use `vetora_test`, created by the compose init script with the same grants as `vetora` and emptied by the `globalSetup` before each run, so they never touch `vetora`'s schemas; roles are cluster wide, so the reset drops only the `p_*_role` of a `p_*` schema it found in `vetora_test`. With `CI` set, missing variables fail the setup instead of skipping the suite.

## Gotchas

- `/up` is the liveness route for kamal-proxy and the uptime check: cheap, no database. `/api/health` is the one that touches the database.
- `instrument.ts` stays the first import of `index.ts`, or Sentry misses errors; without `SENTRY_DSN_API` it does nothing, which is the local setup.
- A route change changes the contract: run `pnpm openapi` and commit `packages/contracts/openapi.json` and `src/generated/api.ts`, or CI fails. The document's `info.version` is fixed at `0.1.0` so the committed file does not change per deploy.
- `@vetora/contracts` resolves from its `dist/`: rebuild it after editing a schema (`pnpm --filter @vetora/contracts build`); `dev` does not watch packages.
- Drizzle is `1.0.0-rc.5` while npm `latest` is still 0.45: bump only after reading the changelog, with `drizzle-kit` on the same version. The rc wraps a failed query in a `DrizzleQueryError` whose `cause` is the Postgres error and whose `params` are the request's values: read `cause.code`, and let `scrubError()` see the whole chain (it drops the params from the message, the stack, and the object before anything is logged or reported).
- Drizzle's `migrate()` creates the migrations schema before it runs the batch, so the control set's first migration says `CREATE SCHEMA IF NOT EXISTS "control"`; drizzle-kit generates a plain `CREATE SCHEMA`.
- A compose volume created before `vetora_test` existed lacks it: `pnpm local:down -v`, then `pnpm local:up` reruns the init script (the local `vetora` data goes with it).
- The Dockerfile sets `CI=true`, so `pnpm install` inside the image build skips lefthook's hook installation (the build context has no git repository).
- The Kamal destination files hold placeholders (`STAGING_DROPLET_IP`, `staging.vetora.example`) until `infra/digitalocean.sh` has run, and the staging workflow stays inert until the `STAGING_READY` repository variable is set.

## Agent skills

- [better-auth-best-practices](../../.agents/skills/better-auth-best-practices/): `better-auth/skills`, the Better Auth server and client setup that slice 1 adds here (sign in, stored in the `control` schema)
- [organization-best-practices](../../.agents/skills/organization-best-practices/): `better-auth/skills`, the organization plugin (a practice is an organization): members, roles, permissions

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md): API conventions, tenancy and request context, configuration and secrets, deployment
- [0002 Data model](../../docs/specs/0002-data-model/index.md): the schemas, roles, migrate and provision commands, and the rules Postgres enforces

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
