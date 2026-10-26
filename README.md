# vetora

Practice management software for companion vet clinics, Baku first. The roadmap is `docs/scope/scope.md`, the design records `docs/specs/`, the domain `docs/domain.md` with ADRs in `docs/adr/`, research `docs/research/`, work items on GitHub Issues, and the agent context `AGENTS.md` (`docs/RUNBOOK.md` is the day to day flow).

## Layout

- `apps/api`: Hono API on Node 24 (routes declared with zod and OpenAPI), Drizzle over Postgres.
- `apps/clinic-web`: React + Vite app for clinic staff (TanStack Router and Query, i18next).
- `packages/ui`: the design system as code (ADR 0003): the tokens compiled to CSS variables, Roboto, the component stylesheet and the components.
- `packages/contracts`: zod schemas and the types generated from the API's OpenAPI document.
- `packages/i18n`: `az`, `ru`, and `en` resources.
- `packages/config`: shared TypeScript config.
- `infra/`: the DigitalOcean script and the local Postgres bootstrap.

## Run it locally

Needs Node 24, pnpm 10 (`corepack enable` or `npm i -g pnpm`), and Docker.

```bash
pnpm local:setup                   # this checkout's .env files, .claude/launch.json and dependencies
pnpm local:up                      # Postgres 18 and an S3 compatible server (compose.yaml) on this checkout's ports
pnpm dev                           # API on :3000, web on :5173 in the main folder (the web app proxies /api)
```

Parallel work runs in worktrees under `.claude/worktrees/`, each on its own ports and database (`pnpm local:status` shows which): `docs/agents/worktrees.md`.

Checks: `pnpm build`, `pnpm typecheck`. After changing a route, `pnpm openapi` rewrites `packages/contracts/openapi.json` and the generated types; commit both (CI checks they match).

## Deploy

Docker images, rolled out with [Kamal](https://kamal-deploy.org) to DigitalOcean Frankfurt: `infra/digitalocean.sh` creates the resources, `apps/*/config/deploy.yml` describe the services, `.kamal/secrets-common` names the secrets. Staging deploys from CI on `main` once the `STAGING_READY` repository variable is set; production from a laptop during the pilot. See spec 0001.
