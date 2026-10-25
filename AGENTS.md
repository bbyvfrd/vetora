# vetora

Agent context for this repo, read by the Matt Pocock engineering skills (`/ask-matt` picks the skill, `docs/RUNBOOK.md` is the day to day flow) and by any other agent that opens the repo.

## Stack

- **Language / Runtime**: TypeScript, strict and ESM everywhere; Node 24 LTS, pinned through the pilot (`.nvmrc`, `engines`)
- **Workspaces**: pnpm 10 workspaces with a version catalog (`pnpm-workspace.yaml`) and Turborepo 2 (`turbo.json`): `apps/api` (Hono 4 and Drizzle 1.0 on Postgres 18), `apps/clinic-web` (React 19 on Vite 8), `packages/ui` (the design system, ADR 0003), `packages/contracts`, `packages/i18n`, `packages/config`
- **Runs as**: Docker images (Turborepo prune) rolled out with Kamal to DigitalOcean Frankfurt; Postgres 18 and an S3 compatible server come from `compose.yaml` locally
- **Source of truth**: the Proposed stack table in `docs/specs/0001-stack-architecture/index.md`; each row names the slice that builds it, and each workspace doc below lists its own dependencies

## Where things live

- **Roadmap**: `docs/scope/scope.md`, the feature list with each feature's done when and status. A feature starts with `/grill-with-docs`, becomes a `/to-spec` issue and `/to-tickets` tickets on GitHub, and is built with `/implement`.
- **Design records**: `docs/specs/0001-stack-architecture/` (the stack and its rules) and `docs/specs/0002-data-model/` (tables, roles, constraints, build plan), frozen on 2026-10-22. New specs are GitHub issues; a change to these two is an ADR that names the section it amends.
- **Decisions and vocabulary**: ADRs in `docs/adr/`; `GLOSSARY.md` points at `docs/domain.md` §7 and §8 (`docs/agents/domain.md` says how to use them).
- **Research**: `docs/research/`, one cited file per question (`/research` writes there).
- **Work items**: GitHub Issues through `gh` (`docs/agents/issue-tracker.md`), with the triage labels in `docs/agents/triage-labels.md`.
- **Standards read at review**: `CODING_STANDARDS.md`, the judgement calls; the mechanical rules live in `biome.jsonc`, the tests, and CI.

## Commands

```bash
pnpm install && pnpm local:up            # Node 24, pnpm 10, Docker; Postgres 18 and an S3 server from compose.yaml
cp apps/api/.env.example apps/api/.env   # local values only
pnpm dev                                 # API on :3000, web on :5173 (Vite proxies /api); builds the packages first
pnpm build && pnpm typecheck             # every workspace, through Turborepo
pnpm lint                                # Biome, read only: format, lint, import order (pnpm lint:fix applies the safe fixes, pnpm format only formats)
pnpm test                                # Vitest in every workspace, after building contracts, i18n and ui; pnpm test:watch keeps it running
pnpm openapi                             # after a route change; commit openapi.json and src/generated (CI diffs them)
```

## Rules

- Build in tracer bullets: a ticket cuts one thin path through every layer it touches (schema, API, UI, tests), can be demoed on its own, and names its test seam; no layer shaped tickets.
- The rule IDs in `docs/domain.md` §8 (CR-1 append only finalised records, RX-3 dispense and stock movement in one transaction, BL-6 debt derived from a ledger, IN-1 a named actor on every write, IN-4 money as integer minor units with a currency, IN-5 a location on every scoped row, and the rest) are the shared vocabulary for code comments, test names, spec criteria, and reviews; a rule is enforced as close to the data as possible (spec 0002), never only in a screen. Instants are stored in UTC and shown in the clinic's time zone (§10).
- One contract chain: zod schemas in `packages/contracts` declare the routes, the API publishes its OpenAPI document, both apps call it through the generated types and `openapi-fetch`. `openapi.json` and `src/generated/` are never edited by hand.
- Errors are problem details JSON (RFC 9457) from every route, and no personal data leaves in URLs, logs, or error reports: names and phones travel in request bodies, logs carry ids and durations only, Sentry's collection options stay off, and Postgres `detail`, `hint`, and `where` are scrubbed before logging or reporting.
- Screen text lives only in the `packages/i18n` locale files (`az`, `ru`, `en`), every key in all three; `en.json` is the typed source.
- Shared tool versions come from the pnpm catalog (`typescript`, `zod`, `@types/node`, `@types/react`, `@types/react-dom`); TypeScript stays on 6.x until openapi-typescript and drizzle-kit support 7; Drizzle, and later Better Auth, are pinned exactly, and a changelog is read before a bump.
- Secrets never enter git: `.env` files are ignored (`.env.example` stays current), `.kamal/secrets-common` holds references only, and each app validates its configuration with zod at startup and fails loudly.
- Lint and format: Biome from the root `biome.jsonc` (`pnpm lint`, `pnpm lint:fix`, `pnpm format`), run on the staged files by the lefthook pre commit hook; tests: Vitest (`pnpm test`), one root config with a project per workspace, tests beside the code as `*.test.ts` and kept out of the builds by each package's `tsconfig.build.json`; database rules get proven against the compose Postgres from the data model on. Chosen and installed on 2026-10-22; spec 0001's module and database client boundaries are Biome rules, described in `apps/api/AGENTS.md`.

## Git

- Work lands on `main` during the pilot: no feature branches, one commit per milestone or ticket with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), and `Closes #N` in the message when a ticket is done, so a review can find its spec.
- Before `/implement` on a ticket, note `git rev-parse HEAD`: `/mattpocock-skills:code-review` diffs from that fixed point to HEAD, so the order is commit the ticket, review, fold the review's fixes into that commit with `--amend`, then push.
- Agents never push; you push.

## Agent skills

### Issue tracker

Bugs, tickets, specs from `/to-spec`, and wayfinder maps live in this repo's GitHub Issues (`gh` CLI); the roadmap stays in `docs/scope/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. The vocabulary lives in `docs/domain.md` §7 and §8 (pointed at by the root `GLOSSARY.md`), decisions in `docs/adr/` and the two frozen design records in `docs/specs/`. See `docs/agents/domain.md`.

### How we use the skills

- Grilling: front load the fact finding and put a grounded recommendation on every question, so a whole round can be answered at once.
- Keep `/grill-with-docs`, `/to-spec`, and `/to-tickets` in one window, and take the `ready-for-agent` label off the spec issue once it is ticketed.
- A ticket's acceptance criteria and demo are the contract: at `/to-tickets`, check each trigger or constraint line against the class of the table it attaches to and the criterion that cites it; at `/implement`, when the path contradicts them, build to the criteria and record the reading in the commit message.
- `/code-review` collides with a built in command: call `/mattpocock-skills:code-review`.
- `/setup-matt-pocock-skills` edits this file, never `CLAUDE.md` (a pointer).
- `/research` writes to `docs/research/`; `/retro` runs in the session it reviews, before `/clear`.

### Installed skills

In `.agents/skills/` (`.claude/skills/` symlinks there). Only repo wide skills are listed here; the web and API skills are listed in those workspaces' docs.

- [turborepo](.agents/skills/turborepo/): `vercel/turborepo`, task pipelines, caching, filtering, and `turbo prune` for the Docker builds
- [vitest](.agents/skills/vitest/): `antfu/skills`, Vitest tests, mocks, coverage, filtering, and fixtures

MCP servers: DigitalOcean (recommended), Sentry (recommended), GitHub (recommended)

## Context files

- [apps/api/AGENTS.md](apps/api/AGENTS.md): the Hono API, its platform layer, error and log rules, Kamal deploy
- [apps/clinic-web/AGENTS.md](apps/clinic-web/AGENTS.md): the React and Vite staff app, file routes, typed client, i18n, runtime config
- [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md): zod schemas and the generated OpenAPI types
- [packages/i18n/AGENTS.md](packages/i18n/AGENTS.md): the az, ru, and en resources and their plural rules
- [packages/config/AGENTS.md](packages/config/AGENTS.md): the shared TypeScript configs
