# vetora

Practice management software for companion vet clinics, Baku first. The plan lives in `docs/scope/`, the decisions in `docs/specs/`, the domain in `docs/domain.md`, and the agent context in `AGENTS.md`.

## Layout

- `apps/api`: Hono API on Node 24 (routes declared with zod and OpenAPI), Drizzle over Postgres.
- `apps/clinic-web`: React + Vite app for clinic staff (TanStack Router and Query, i18next).
- `packages/contracts`: zod schemas and the types generated from the API's OpenAPI document.
- `packages/i18n`: `az`, `ru`, and `en` resources.
- `packages/config`: shared TypeScript config.
- `infra/`: the DigitalOcean script and the local Postgres bootstrap.

## Run it locally

Needs Node 24, pnpm 10 (`corepack enable` or `npm i -g pnpm`), and Docker.

```bash
pnpm install
pnpm local:up                      # Postgres 18 and an S3 compatible server (compose.yaml)
cp apps/api/.env.example apps/api/.env
pnpm dev                           # API on :3000, web on :5173 (the web app proxies /api)
```

Checks: `pnpm build`, `pnpm typecheck`. After changing a route, `pnpm openapi` rewrites `packages/contracts/openapi.json` and the generated types; commit both (CI checks they match).

## Deploy

Docker images, rolled out with [Kamal](https://kamal-deploy.org) to DigitalOcean Frankfurt: `infra/digitalocean.sh` creates the resources, `apps/*/config/deploy.yml` describe the services, `.kamal/secrets-common` names the secrets. Staging deploys from CI on `main` once the `STAGING_READY` repository variable is set; production from a laptop during the pilot. See spec 0001.
