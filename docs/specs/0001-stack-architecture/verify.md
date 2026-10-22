# Verify: Stack & architecture · spec 0001 · updated 2026-10-22
_Steps derived from spec 0001 and the feature's Done when in `docs/scope/scope.md` (a decision spec carries no numbered acceptance criteria, so the three Done when clauses stand in: DW-1 the stack is recorded in a spec, DW-2 an empty project boots locally, DW-3 it deploys once to a hosted environment). `/check verify` runs these; `/test` locks the durable ones._
_Commands and UI / manual verified on 2026-10-22 on a laptop (Docker 29.2.1, Node 24.14, pnpm 10.33, the compose Postgres); the Hosted section stays open until a server and a domain exist._

## Commands
- [x] `pnpm install && pnpm turbo run build typecheck` → 8 tasks succeed (api, clinic-web, contracts, i18n: build and typecheck) → DW-2
- [x] `pnpm local:up` → both containers report healthy → DW-2
- [x] `docker compose exec -T postgres psql -U postgres -c "select datname, pg_encoding_to_char(encoding), datlocprovider, datlocale from pg_database where datname = 'vetora'"` → `vetora | UTF8 | i | und` → DW-2 (Primary database row)
- [x] `docker compose exec -T postgres psql -U postgres -c "select rolname, rolcanlogin, rolcreaterole from pg_roles where rolname like 'vetora_%' order by 1"` → `vetora_app`, `vetora_backup`, `vetora_migrator`, all can log in, only the migrator can create roles → DW-2 (Database roles row)
- [x] Create a throwaway login role, connect with it to `vetora` → refused with "User does not have CONNECT privilege"; drop the role → DW-2 (CONNECT revoked from PUBLIC)
- [x] `docker compose exec -T -e PGPASSWORD=vetora_app postgres psql -U vetora_app -d vetora -c "select current_setting('TimeZone')"` → `UTC` → DW-2
- [x] `cp apps/api/.env.example apps/api/.env && pnpm --filter @vetora/api build && (cd apps/api && node --env-file=.env dist/index.js)` → logs `api listening` on port 3000 → DW-2
- [x] `curl -i localhost:3000/up` → `200` with body `OK` and an `x-request-id` header → DW-2 (health check on `/up`)
- [x] `curl -s localhost:3000/api/health` → JSON with `status: ok`, `database: ok`, `version: dev`, an ISO time → DW-2
- [x] `curl -i localhost:3000/nope` → `404` with `content-type: application/problem+json` and a body holding `type`, `title`, `status`, `instance`, `requestId` → DW-2 (problem details errors)
- [x] `curl -s localhost:3000/api/openapi.json` → an OpenAPI 3.1 document whose `paths` holds `/api/health` → DW-2 (Contracts row)
- [x] `(cd apps/api && env -u DATABASE_URL_POOLED node dist/index.js)` → exits 1 with a log line naming `DATABASE_URL_POOLED` and no other output → DW-2 (configuration fails loudly)
- [x] Send SIGTERM to the running API → it logs `shutting down` and exits 0 within 10 seconds → DW-2 (clean stop on deploy)
- [x] `pnpm openapi && git diff --exit-code -- packages/contracts/openapi.json packages/contracts/src/generated` → no diff → DW-2 (the contract chain is current)
- [x] `docker build -f apps/api/Dockerfile -t vetora-api:local .` → succeeds; run it with `-p 3100:3000` and the local database URLs pointing at `host.docker.internal` → `/up` and `/api/health` answer 200; `docker exec <id> id` → `uid=1000(node)` → DW-2, DW-3
- [x] `docker build -f apps/clinic-web/Dockerfile -t vetora-web:local .` → succeeds; run it with `-p 3200:80 -e APP_ENV=staging -e KAMAL_VERSION=abc` → `/up` 200, `/config.json` returns `environment: staging` and `release: abc`, `/some/route` 200 (client side routing), the hashed asset carries `Cache-Control: public, max-age=31536000, immutable`, and `<asset>.map` returns 404 → DW-2, DW-3
- [x] `docker run --rm -v "$PWD:/workdir" -e KAMAL_REGISTRY_PASSWORD=x -e DATABASE_URL_POOLED=x -e DATABASE_URL_DIRECT=x -e SENTRY_DSN_API=x -e SENTRY_DSN_WEB=x -e SENTRY_AUTH_TOKEN=x -e SENTRY_ORG=o -e SENTRY_PROJECT=p ghcr.io/basecamp/kamal:latest config -c apps/api/config/deploy.yml -d staging` (and the same for `apps/clinic-web/config/deploy.yml`, and for `-d production`) → prints the resolved config with no `ConfigurationError` → DW-3
- [x] `git check-ignore apps/api/.env .kamal/secrets.staging infra/.state/x` → all three ignored; `git check-ignore .kamal/secrets-common` → not ignored → DW-3 (secrets never committed)

## UI / manual
- [x] With the API running, `pnpm --filter @vetora/clinic-web dev`, open `http://localhost:5173` → heading `vetora`, section `API vəziyyəti`, status line `İşləyir · Versiya dev` (the page calls `/api/health` through the Vite proxy) → DW-2
- [x] Switch the language select to `Русский` → `Состояние API` and `Работает · Версия dev`; to `English` → `API status` and `Up · Version dev`; reload → the last choice is kept → DW-2 (Translations row)
- [x] Stop the API, wait for the next refetch (30 seconds) or reload → the page shows `Əlçatan deyil` (or its translation) instead of crashing → DW-2
- [x] Browser console → no errors on load or after switching languages → DW-2

## Hosted (DW-3, not yet done)
- [ ] `ENVIRONMENT=staging DOMAIN=<your domain> SSH_KEY_NAME=<key> ./infra/digitalocean.sh database`, then `roles`, `droplet`, `firewall`, `dns` → a cluster, the `vetora` database with the three roles and the pooler, a droplet with the `deploy` user, a firewall, and an A record → DW-3
- [ ] Put the droplet IP and host into `apps/api/config/deploy.staging.yml` and `apps/clinic-web/config/deploy.staging.yml`; export the secrets named in `.kamal/secrets-common`; `kamal server bootstrap -c apps/api/config/deploy.yml -d staging` → Docker installed on the droplet → DW-3
- [ ] `kamal deploy -c apps/api/config/deploy.yml -d staging` then `kamal deploy -c apps/clinic-web/config/deploy.yml -d staging` → both roll out; `https://<host>/up` and `https://<host>/api/health` answer 200 over TLS; `https://<host>/` shows the web app with the API status up → DW-3 (one origin, path routing)
- [ ] Set the `STAGING_READY` repository variable and the `staging` environment secrets in GitHub; push to `main` → the "Deploy staging" workflow runs green → DW-3 (staging from CI on main)

## Acceptance-criteria coverage
- DW-1 (stack recorded in a spec): spec 0001 exists, a frozen design record since 2026-10-22; nothing to run.
- DW-2 (boots locally): covered by every Commands step from `pnpm install` to the SIGTERM step, the contract chain step, both image steps, and every UI / manual step.
- DW-3 (deploys once to a hosted environment): image, Kamal config, and ignore steps prove the pieces locally; the Hosted section proves the deploy itself and is still open.
- Value sourcing: spec 0001 has no value sourcing table (a decision spec); the data model spec (0002) carries the first one.
