# apps/api

## Overview

The vetora API: a Hono server on Node 24 that declares every route with a zod schema from `@vetora/contracts`, publishes its OpenAPI document, reaches Postgres through Drizzle, and signs staff in through Better Auth (spec #18). It grows into a modular monolith with one module per bounded context under `src/modules/` (spec 0001); the same image carries the operator commands (`dist/<command>.js`, Commands below) and later the worker.

## Stack

- Hono 4 on `@hono/node-server`, routes through `@hono/zod-openapi` 1, zod 4 from the pnpm catalog
- Drizzle ORM 1.0 (pinned exactly to its release candidate) over `pg`, against Postgres 18
- Better Auth 1.7.12 with `@better-auth/drizzle-adapter` 1.7.12 (its relations v2 entry) and the `auth` CLI 1.7.12, all pinned exactly: the username, admin and organization plugins over hand written control tables (`docs/research/2026-10-26-better-auth-spike.md`)
- pino for logs, `@sentry/node` 11 for error reports, tsx in development, plain `tsc` for the build (ESM, NodeNext)
- Shipped as a Docker image built from the repository root (`Dockerfile`, Turborepo prune) and rolled out with Kamal (`config/deploy.yml` plus a destination file per environment)

## Key files

Each file's own comments say what it owns and why; this index finds the file.

| File | Owns |
|---|---|
| `src/index.ts` | Startup: Sentry first (`instrument.ts`), the config, the server, a clean stop |
| `src/app.ts` | The `OpenAPIHono` app: middleware, every route, the 404 and 500 handlers |
| `src/http/` | Routes and middleware: `auth.ts` the three Better Auth routes (the allowlist), `me.ts` `/api/me`, `practice-context.ts` the request context, then a file per ticket's routes (#21 `registration.ts` to #26 `payments.ts`; `walk.test.ts` the whole visit) |
| `src/openapi.ts` | Writes `packages/contracts/openapi.json` (`pnpm openapi` at the root) |
| `src/migrate.ts`, `provision-practice.ts`, `add-staff.ts`, `reset-password.ts`, `unlock-login.ts`, `load-services.ts` | The operator commands: arguments and exit codes over their engines |
| `src/check-migrations.ts`, `src/platform/db/migration-order.ts` | The order half of `db:check` and its check (ADR 0002) |
| `src/modules/` | One folder per bounded context (`README.md`); `identity-access/` holds the staff service, `client/` and `patient/` registration, `clinical-record/` the visit and its vital signs, `inventory/` prices, `billing/` invoices and payments |
| `src/platform/request-context.ts`, `practice-registry.ts` | `practiceContext()`, what a practice route's code reads; the registry cache (`docs/practice-routes.md`) |
| `src/platform/config.ts` | The validated environment: `loadConfig()`, `loadMigratorConfig()`, `configVariables` |
| `src/platform/auth/` | Better Auth: the instance (`auth.ts`), logins and passwords, the naming rules, the sign in lock, what `auth:check` loads |
| `src/platform/db/index.ts` | `db()` and the pools, the only place the API creates a database client |
| `src/platform/db/migrator.ts`, `provisioning.ts`, `grants.ts` | The migrate engine, the provision engine, the grants pass each practice migration runs |
| `src/platform/db/table-classes.ts` | The table class registry every practice table enters |
| `src/platform/db/control-schema.ts`, `practice-schema.ts`, `platform-tables.ts`, `domains.ts` | The Drizzle declarations: the two sets, the platform tables, the SQL domains |
| `src/platform/db/errors.ts` | The rule errors (`vetora.<rule>`, `VT00n`) and `ruleOf()` |
| `src/platform/db/command-session.ts`, `practice-transaction.ts` | A command's migrator session; `inPractice()`, one transaction in a practice's role |
| `src/platform/db/test-database.ts`, `test-support.ts`, `test-setup.ts`, `src/test-support.ts` | The test database and its reset; the database tests' helpers; the API seam's (`provisionApiPractice()`, `call()`, `runCommand()`) |
| `src/rehearsal.test.ts` | The two practice rehearsal through the shipped commands, one walk in order |
| `src/platform/log.ts`, `problem.ts`, `prompt.ts`, `ids.ts` | The logger (redacted, synchronous, `scrubError()`), problem details, the password prompt, `uuidv7()` |
| `drizzle/control/`, `drizzle/practice/` | The migration sets, their SQL finished by hand (`docs/database.md`) |
| `.env.example` | Every variable the API and its commands read; `pnpm local:setup` writes `.env` from it |

## Commands

```bash
pnpm --filter @vetora/api dev         # node --watch through tsx, reads .env (this checkout's port); needs pnpm local:up at the root
pnpm --filter @vetora/api build       # tsc -p tsconfig.build.json to dist/, tests left out
pnpm --filter @vetora/api typecheck
pnpm exec vitest run --project @vetora/api   # at the root; pnpm test runs every workspace
pnpm exec vitest run --project @vetora/api apps/api/src/rehearsal.test.ts   # the two practice rehearsal through the commands, whole: its cases are one walk
pnpm openapi                          # at the root: builds, writes openapi.json, regenerates the contracts types
pnpm --filter @vetora/api migrate     # reads .env when present; the control set, then every practice schema in registry order, the grants pass inside each schema's transaction; --dry-run lists and changes nothing, --practice <slug> limits the loop
pnpm --filter @vetora/api provision-practice -- --slug alfa --name "Alfa Vet" --manager-handle dr.aliyeva --manager-name "Dr Aliyeva" --location-name "Nərimanov"   # [--time-zone Asia/Baku] [--languages az,ru], the first language is the default; asks the manager's password; prints the id; safe to rerun
pnpm --filter @vetora/api add-staff -- --practice alfa --handle dr.leyla --name "Leyla Həsənova" --roles veterinarian   # several roles comma joined; asks the password; prints the login id; safe to rerun
pnpm --filter @vetora/api reset-password -- --practice alfa --handle dr.leyla   # asks the new password; ends the person's sessions
pnpm --filter @vetora/api unlock-login -- --practice alfa --handle dr.leyla
pnpm --filter @vetora/api auth:check  # auth check schema: Better Auth's configuration against the control tables, no database needed; CI runs it beside db:check
pnpm --filter @vetora/api db:check    # the migration sets in order; db:generate, psql and a run against vetora_test are in docs/database.md, Commands
kamal deploy -c apps/api/config/deploy.yml -d staging   # at the root; a destination is always required
```

## Conventions

- A route is a `createRoute` declaration whose schemas come from `@vetora/contracts`, never an inline shape; the API serves its routes under `/api` itself (kamal-proxy keeps the prefix, Vite proxies it in development).
- Every error is problem details JSON through `problem()`: 400 for validation (the `defaultHook`), 404 from `notFound`, 500 from `onError`, which scrubs the error, logs it with the request id, and reports it to Sentry; a rule the database refuses answers 409 naming it (`ruleProblem()`).
- Modules reach each other only through their public interface or domain events, never through each other's tables; only `src/platform/` may import a database client (spec 0001, "Repository layout"). Biome enforces both (`noRestrictedImports`; `noPrivateImports` inside `src/modules/`, where a module's `index.ts` is its interface and a platform export it imports is tagged `@public`); [src/modules/README.md](src/modules/README.md), "The boundary", has the rest, foreign keys across modules included.
- Database work follows [docs/database.md](docs/database.md): a migration, a table and its registry entry, a trigger or a deferred check, a hand write in psql, or a database test; read it before the first such change in a ticket, and `CODING_STANDARDS.md` holds the change to it at review.
- A route under `/api/p/:practiceId` follows [docs/practice-routes.md](docs/practice-routes.md): its action, the request context it reads, what it answers before the handler, its tests.
- Sign in and staff work follows [docs/auth.md](docs/auth.md): Better Auth's three routes, its server side API, the staff service and commands, passwords; read it before the first such change in a ticket. Its last section is signing in locally.
- Request code runs through the pooler in transaction mode: no session state beyond `SET LOCAL`, no named prepared statements, no advisory locks. `direct()` is for LISTEN and the worker; the commands open their own `pg.Client` on `DATABASE_URL_MIGRATOR`.
- The commands log ids, slugs, schema and role names, counts, and durations: never a practice's name, address, phone, or tax id, which spec 0002 lists as personal data, and never a staff member's name, handle or password.
- One JSON log line per request (method, path, status, duration, request id), never a body or a query string; `/up` is not logged.
- A new configuration variable goes into the zod schema in `config.ts`, `.env.example`, `config/deploy.yml` (`env.clear` or `env.secret`), and when secret into `.kamal/secrets-common` and the `env:` block of `.github/workflows/deploy-staging.yml` (a secret of the GitHub "staging" environment); `src/platform/deploy-secrets.test.ts` fails on the place that misses it.
- Tests sit beside the code as `*.test.ts`: `tsconfig.json` (typecheck) includes them, `tsconfig.build.json` (build) leaves them out of `dist/`, and `vitest.config.ts` here silences the logger while they run. A helper two test files need lives in `test-support.ts`, in one place.

## Gotchas

- `/up` is the liveness route for kamal-proxy and the uptime check: cheap, no database. `/api/health` is the one that touches the database.
- `instrument.ts` stays the first import of `index.ts`, or Sentry misses errors; without `SENTRY_DSN_API` it does nothing, which is the local setup.
- A route change changes the contract: run `pnpm openapi` and commit `packages/contracts/openapi.json` and `src/generated/api.ts`, or CI fails. The document's `info.version` is fixed at `0.1.0` so the committed file does not change per deploy.
- `@vetora/contracts` resolves from its `dist/`: rebuild it after editing a schema (`pnpm --filter @vetora/contracts build`); `dev` does not watch packages.
- Drizzle is `1.0.0-rc.5` while npm `latest` is still 0.45: bump only after reading the changelog, with `drizzle-kit` on the same version. The rc wraps a failed query in a `DrizzleQueryError` whose `cause` is the Postgres error and whose `params` are the request's values: read `cause.code`, and let `scrubError()` see the whole chain (it drops the params from the message, the stack, and the object before anything is logged or reported).
- `noPrivateImports` reads `@vetora/contracts`' exports as package private too (from its `dist/index.d.ts`), so a module takes the staff roles from `platform-tables.ts`, which re-exports them tagged `@public`.
- `pnpm run <script> -- --flag` hands the `--` on to node, which passes it to the script; `migrate` and `provision-practice` drop a leading `--`, so both forms work.
- The Dockerfile sets `CI=true`, so `pnpm install` inside the image build skips lefthook's hook installation (the build context has no git repository).
- The Kamal destination files hold placeholders (`STAGING_DROPLET_IP`, `staging.vetora.example`) until `infra/digitalocean.sh` has run, and the staging workflow stays inert until the `STAGING_READY` repository variable is set.
- `docs/specs/0002-data-model/verify.md` is the walk that provisions practices in `vetora` by hand, with its Clean up; the local reset and `vetora_test` are [docs/database.md](docs/database.md), Database tests.

## Agent skills

- [better-auth-best-practices](../../.agents/skills/better-auth-best-practices/): `better-auth/skills`, the Better Auth server setup (`src/platform/auth/`, sign in stored in the `control` schema)
- [organization-best-practices](../../.agents/skills/organization-best-practices/): `better-auth/skills`, the organization plugin (a practice is an organization): members, roles, permissions

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md): API conventions, tenancy and request context, configuration and secrets, deployment
- [0002 Data model](../../docs/specs/0002-data-model/index.md): the schemas, roles, migrate and provision commands, and the rules Postgres enforces
