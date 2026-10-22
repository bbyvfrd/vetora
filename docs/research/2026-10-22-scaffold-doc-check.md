# Doc check for the stack scaffold (spec 0001)
Cached: 2026-10-22 · checked against official docs, repos, and npm by a read only research subagent. "not found" means unconfirmed. Reuse while under 30 days old; verify anything marked smoke test.

## 1. DigitalOcean managed Postgres
- New Standard clusters: Postgres 15 to 18; Advanced (a permanent choice): 16 to 18, default 18. `fra1` is available for every Postgres machine type.
- Extensions btree_gist, pg_trgm, unaccent, pgcrypto, uuid-ossp: all available (Standard 14 to 18; Advanced via `CREATE EXTENSION`).
- Pooler is PgBouncer: session, transaction (default), statement; the mode is immutable after creation.
- From 2026-11-30 new Standard clusters are capped at 4 GiB RAM and get no standby or read only nodes (the standby plan needs an Advanced cluster).
- `doadmin` is not superuser (`Create role, Create DB, Replication, Bypass RLS`), so `CREATE ROLE` should work; docs only describe user creation through the panel, doctl, or API: smoke test it.
- `doctl databases create NAME --engine pg --version 18 --region fra1 --size db-s-1vcpu-1gb --num-nodes 1` (Advanced: `--engine advanced_pg`)
- `doctl databases pool create CLUSTER_ID POOL --db defaultdb --mode transaction --size 10 --user doadmin`
- Live check: `doctl databases options versions --engine pg`
- https://docs.digitalocean.com/products/databases/postgresql/how-to/create/ · https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/ · https://docs.digitalocean.com/platform/regional-availability/

## 2. Kamal 2.12.0 (2026-06-18) and kamal-proxy
- kamal-proxy latest v0.10.2; Kamal boots v0.9.2 unless `proxy.run.version` is set.
- Path routing: kamal-proxy v0.9.0 added it; Kamal 2.7.0 added `path_prefix` and `strip_path_prefix`, 2.8.0 `path_prefixes`. Both services need the same `host`; only the `/` service may set `ssl: true`; give the API `forward_headers: false`; the prefix is stripped by default (`strip_path_prefix: false` keeps `/api` for a `basePath('/api')` app); health checks hit the container directly.
- GHSA-g5gj-723m-2f9x (a path routing bypass needing exactly this `/api` plus `/` layout) is fixed in proxy 0.10.1: set `proxy.run.version: v0.10.2` identically in both configs (not yet tested with 2.12.0).
```yaml
# config/deploy.web.yml (service: vetora-web)
proxy: {host: app.example.com, ssl: true, app_port: 80, healthcheck: {path: /up}}
# config/deploy.api.yml (service: vetora-api)
proxy: {host: app.example.com, path_prefix: /api, app_port: 3000, forward_headers: false, healthcheck: {path: /health}}
```
- Secrets: `.kamal/secrets` is dotenv with `$VAR` and `$(cmd)`; with a destination Kamal reads `.kamal/secrets-common` then `.kamal/secrets.<dest>` only. Helpers: `kamal secrets fetch|extract|print` (1password, bitwarden, bitwarden-sm, lastpass, aws_secrets_manager, doppler, gcp, passbolt).
- Destinations: `-d staging` merges `config/deploy.staging.yml`; with `-c config/deploy.api.yml` it is `config/deploy.api.staging.yml`.
- One off command: `kamal app exec -c config/deploy.api.yml -d staging -p 'node dist/migrate.js'` (a new container from the latest image; `--version SHA` pins; `--reuse` runs in the live container).
- Docker image `ghcr.io/basecamp/kamal:latest` (= v2.12.0). macOS alias (no secret adapters inside; pass host env with `-e`):
  `alias kamal='docker run -it --rm -v "${PWD}:/workdir" -v "/run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock" -e SSH_AUTH_SOCK="/run/host-services/ssh-auth.sock" -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/basecamp/kamal:latest'`
  Linux and CI: `-v "${SSH_AUTH_SOCK}:/ssh-agent" -e SSH_AUTH_SOCK=/ssh-agent`.
- https://kamal-deploy.org/docs/configuration/proxy/ · https://kamal-deploy.org/docs/installation/dockerized/ · https://github.com/basecamp/kamal-proxy

## 3. create-hono 0.19.5 (2026-08-30)
- `pnpm create hono@latest apps/api --template nodejs --install --pm pnpm` (omitting `--install` prompts; there is no `--no-install`).
- Template: scripts `dev: tsx watch src/index.ts`, `build: tsc`, `start: node dist/index.js`; deps hono ^4.13.13, @hono/node-server ^2.1.3; dev @types/node ^26 (use ^24), tsx, typescript ^7.0.2; tsconfig ESNext/NodeNext, strict, verbatimModuleSyntax, rootDir src, outDir dist.
- It also ships a `pnpm-workspace.yaml` inside `apps/api` (esbuild build allow list) that makes `apps/api` its own workspace root: delete it.
- TypeScript 7.0.2 is npm latest, but Microsoft says there is no stable compiler JS API before 7.1 and recommends aliasing `typescript` to `npm:@typescript/typescript6@^6.0.0` for tools.
- https://github.com/honojs/starter/tree/v0.19/templates/nodejs · https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/

## 4. create-vite 9.3.1 (2026-10-20), Vite 8.3.5
- Rolldown is Vite 8's single default bundler; no rolldown-vite prompt remains.
- Silence every prompt: `pnpm create vite@latest apps/web --template react-ts --no-interactive --no-immediate --no-eslint` (a non empty directory without `--overwrite` cancels).
- Output: vite ^8.3.4, @vitejs/plugin-react ^6.1.2, react ^19.3.1, typescript ~6.0.3, oxlint by default (`--eslint` swaps it).
- https://github.com/vitejs/vite/tree/main/packages/create-vite · https://vite.dev/blog/announcing-vite8

## 5. Local S3 compatible server
- MinIO community edition: repo archived ("no longer maintained", last push 2026-04-24, last release 2025-10-15); Docker Hub `minio/minio` returns 404. Avoid.
- SeaweedFS 4.48 is the fewest steps (no config file, default command `weed mini`, bucket auto created):
```yaml
s3: {image: "chrislusf/seaweedfs:4.48", ports: ["8333:8333"], volumes: ["./.s3:/data"], environment: {AWS_ACCESS_KEY_ID: dev, AWS_SECRET_ACCESS_KEY: devsecret, S3_BUCKET: vetora}}
```
- Garage v2.4.1 needs a mounted `garage.toml` and the `--single-node --default-bucket` flags (or the manual layout, bucket, and key commands before 2.3).
- https://github.com/minio/minio · https://github.com/seaweedfs/seaweedfs · https://garagehq.deuxfleurs.fr/documentation/quick-start/

## 6. Drizzle ORM and drizzle-kit
- 1.0 is NOT stable: npm `latest` is 0.45.4; `1.0.0-rc.5` (2026-10-21) is tag `rc` and lists breaking changes. Pin `drizzle-orm@rc drizzle-kit@rc` exactly.
- Config: `defineConfig({dialect: 'postgresql', schema, out, dbCredentials: {url}, migrations: {table, schema}})` (defaults `__drizzle_migrations` in schema `drizzle`).
- Two sets: `drizzle-kit generate --config=drizzle.control.config.ts` and a second config with its own `schema`, `out`, and `migrations`.
- `migrate(db, {migrationsFolder, migrationsSchema, migrationsTable})` from `drizzle-orm/node-postgres/migrator`; folders are `<timestamp_name>/migration.sql` (the old `meta/_journal.json` layout throws). In rc.5 all pending migrations run in ONE transaction.
- SQL runs raw and kit emits unqualified names for `public`, so `search_path` applies: the same practice migration folder can be applied to several schemas by setting `search_path` first. Set `migrationsSchema` per target schema (else every schema shares `drizzle.__drizzle_migrations`), and use one direct `pg.Client` (not the pool or PgBouncer) with `SET search_path TO p_x, public`.
- https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.5/drizzle-orm/src/pg-core/async/session.ts · https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.5/drizzle-kit/src/index.ts

## 7. @hono/zod-openapi 1.6.3 (peers zod ^4, hono >=4.10; import `z` from it) and @hono/node-server 2.1.5
```ts
const route = createRoute({method: 'get', path: '/users/{id}', request: {params: z.object({id: z.string()})}, responses: {200: {description: 'ok', content: {'application/json': {schema: User}}}}})
const app = new OpenAPIHono(); app.openapi(route, (c) => c.json(user, 200))
app.doc('/openapi.json', {openapi: '3.0.0', info: {title: 'API', version: '1'}}) // doc31() for 3.1
```
- `const server = serve({fetch: app.fetch, port: 3000})` returns an `http.Server`; no shutdown helper, so `process.on('SIGTERM', () => server.close(() => pool.end()))`.
- https://github.com/honojs/middleware/tree/main/packages/zod-openapi · https://github.com/honojs/node-server

## 8. Sentry JavaScript v11.8.0 (node, react, vite-plugin; Node >= 20.19)
- Node ESM: `instrument.mjs` with `Sentry.init({...})`, run `node --import ./instrument.mjs app.mjs`. `@sentry/hono` (`@sentry/hono/node`, `app.use(sentry(app))`) also exists.
- `sendDefaultPii` was removed in v11; an unset `dataCollection` now collects everything. Restrictive setup: `Sentry.init({dsn, dataCollection: {userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false}, beforeSend: (event, hint) => scrub(event)})`.
- React: `Sentry.init({dsn, integrations: [Sentry.browserTracingIntegration()], tracesSampleRate})`. Vite: `build.sourcemap: 'hidden'`; last plugin `sentryVitePlugin({org, project, authToken: process.env.SENTRY_AUTH_TOKEN, sourcemaps: {filesToDeleteAfterUpload: ['./**/*.map']}})`.
- https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/ · https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/

## 9. TanStack Router (react-router 1.170.45, router-plugin 1.168.47; Vite 8 fine)
- `plugins: [tanstackRouter({target: 'react', autoCodeSplitting: true}), react()]` (before react). The plugin writes `src/routeTree.gen.ts` from `src/routes`.
- `main.tsx`: `const router = createRouter({routeTree})`; `declare module '@tanstack/react-router' {interface Register {router: typeof router}}`; `<RouterProvider router={router}/>`. `__root.tsx`: `createRootRoute({component: () => <Outlet/>})`; `index.tsx`: `createFileRoute('/')({component: Home})`.
- https://github.com/TanStack/router/blob/main/docs/router/installation/with-vite.md

## 10. openapi-typescript 7.13.0 and openapi-fetch 0.17.0
- `openapi-typescript ./openapi.json -o ./src/api.d.ts` (`--check` for CI). `const client = createClient<paths>({baseUrl: '/api'}); await client.GET('/users/{id}', {params: {path: {id}}})`.
- openapi-typescript peers `typescript ^5.x` and fails on TS 7 (open issue #2841): use the TS 6 alias.
- https://openapi-ts.dev/cli · https://openapi-ts.dev/openapi-fetch/

## 11. i18next 26.5.5 and react-i18next 17.1.1 (peer i18next >= 26.2)
- `i18next.use(initReactI18next).init({resources, lng, fallbackLng, interpolation: {escapeValue: false}})` is current (v26 removed `interpolation.format` and `initImmediate`).
- Plurals use `Intl.PluralRules` (mandatory since v24, no plugin). Verified on Node 24.14: `az` gives one/other, `ru` gives one/few/many/other. Note the design system says browsers lack Azerbaijani locale data for dates and numbers, and ships its own formatters.
- https://www.i18next.com/translation-function/plurals · https://www.i18next.com/misc/migration-guide

## 12. GitHub Actions majors (floating tags confirmed)
- actions/checkout@v7 (7.0.1), actions/setup-node@v7 (7.1.0), pnpm/action-setup@v6 (6.1.0), docker/login-action@v4 (4.6.0), docker/build-push-action@v7 (7.4.0), docker/setup-buildx-action@v4 (4.4.1), docker/metadata-action@v6 (6.2.0).
