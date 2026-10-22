# vetora

Agent context for this repo. The anthropic workflow (`docs/scope/`, `docs/specs/`) and the Matt Pocock engineering skills both read this file; `/audit` extends it later.

## Stack

- **Language / Runtime**: TypeScript, strict and ESM everywhere; Node 24 LTS, pinned through the pilot (`.nvmrc`, `engines`)
- **Workspaces**: pnpm 10 workspaces with a version catalog (`pnpm-workspace.yaml`) and Turborepo 2 (`turbo.json`): `apps/api` (Hono 4 and Drizzle 1.0 on Postgres 18), `apps/clinic-web` (React 19 on Vite 8), `packages/contracts`, `packages/i18n`, `packages/config`
- **Runs as**: Docker images (Turborepo prune) rolled out with Kamal to DigitalOcean Frankfurt; Postgres 18 and an S3 compatible server come from `compose.yaml` locally
- **Source of truth**: the Proposed stack table in `docs/specs/0001-stack-architecture/index.md`; each row names the slice that builds it, and each workspace doc below lists its own dependencies

## Build approach

Tracer Bullet: thin vertical slices, each working end to end through every layer before the next one starts (the `docs/scope/scope.md` header).

## Commands

```bash
pnpm install && pnpm local:up            # Node 24, pnpm 10, Docker; Postgres 18 and an S3 server from compose.yaml
cp apps/api/.env.example apps/api/.env   # local values only
pnpm dev                                 # API on :3000, web on :5173 (Vite proxies /api); builds the packages first
pnpm build && pnpm typecheck             # every workspace, through Turborepo
pnpm openapi                             # after a route change; commit openapi.json and src/generated (CI diffs them)
```

## Specs

`docs/specs/NNNN-<slug>/index.md` holds the decision and build plan, `rationale.md` the options, `verify.md` the checklist `/check verify` runs; the feature plan is `docs/scope/scope.md`, and small decisions are ADRs in `docs/adr/`.

## Rules

- The rule IDs in `docs/domain.md` §8 (CR-1 append only finalised records, RX-3 dispense and stock movement in one transaction, BL-6 debt derived from a ledger, IN-1 a named actor on every write, IN-4 money as integer minor units with a currency, IN-5 a location on every scoped row, and the rest) are the shared vocabulary for code comments, test names, spec criteria, and reviews; a rule is enforced as close to the data as possible (spec 0002), never only in a screen. Instants are stored in UTC and shown in the clinic's time zone (§10).
- One contract chain: zod schemas in `packages/contracts` declare the routes, the API publishes its OpenAPI document, both apps call it through the generated types and `openapi-fetch`. `openapi.json` and `src/generated/` are never edited by hand.
- Errors are problem details JSON (RFC 9457) from every route, and no personal data leaves in URLs, logs, or error reports: names and phones travel in request bodies, logs carry ids and durations only, Sentry's collection options stay off, and Postgres `detail`, `hint`, and `where` are scrubbed before logging or reporting.
- Screen text lives only in the `packages/i18n` locale files (`az`, `ru`, `en`), every key in all three; `en.json` is the typed source.
- Shared tool versions come from the pnpm catalog (`typescript`, `zod`, `@types/node`); TypeScript stays on 6.x until openapi-typescript and drizzle-kit support 7; Drizzle, and later Better Auth, are pinned exactly, and a changelog is read before a bump.
- Secrets never enter git: `.env` files are ignored (`.env.example` stays current), `.kamal/secrets-common` holds references only, and each app validates its configuration with zod at startup and fails loudly.
- Lint and format: Biome, one config at the repository root, with a `noRestrictedImports` pattern for the module boundary rule; pre commit: lefthook on staged files; tests: Vitest, one root config with a project per workspace, database rules proven against the compose Postgres. Chosen on 2026-10-22 for scope feature 2; `/develop tooling` installs them, and until then CI runs build, typecheck, and the OpenAPI diff.

## Git

- integration: on
- branch prefix: none (work lands on `main` during the pilot)
- commit: per-milestone, with conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`)

## Agent skills

### Issue tracker

Bugs, tickets, and wayfinder maps live in this repo's GitHub Issues (`gh` CLI); the feature plan stays in `docs/scope/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. The vocabulary lives in `docs/domain.md` §7 and §8 (pointed at by the root `GLOSSARY.md`), decisions in `docs/specs/` and `docs/adr/`. See `docs/agents/domain.md`.

### Installed skills

In `.agents/skills/` (`.claude/skills/` symlinks there). Only repo wide skills are listed here; the web and API skills are listed in those workspaces' docs.

- [turborepo](.agents/skills/turborepo/): `vercel/turborepo`, task pipelines, caching, filtering, and `turbo prune` for the Docker builds

Declined: better-auth-security-best-practices, drizzle (lobehub), drizzle-orm-patterns, tanstack-router-best-practices
MCP servers: DigitalOcean (recommended), Sentry (recommended), GitHub (recommended)

## Context files

- [apps/api/AGENTS.md](apps/api/AGENTS.md): the Hono API, its platform layer, error and log rules, Kamal deploy
- [apps/clinic-web/AGENTS.md](apps/clinic-web/AGENTS.md): the React and Vite staff app, file routes, typed client, i18n, runtime config
- [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md): zod schemas and the generated OpenAPI types
- [packages/i18n/AGENTS.md](packages/i18n/AGENTS.md): the az, ru, and en resources and their plural rules
- [packages/config/AGENTS.md](packages/config/AGENTS.md): the shared TypeScript configs
