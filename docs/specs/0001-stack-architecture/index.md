# 0001. Stack and architecture for vetora

**Date**: 2026-10-02
**Status**: Design record, frozen on 2026-10-22 (built and amended through GitHub issues from here on)

## Summary

vetora is built in TypeScript as one monorepo: a separate API service on Postgres, a React app for clinic staff that runs in the browser, and later a React Native app for pet owners. Each clinic (a practice) gets its own schema (a named section of one Postgres database), so its data stays separate and exports with one command, while a small control schema handles sign in and routing. Everything ships as Docker images to DigitalOcean in Frankfurt with Kamal (a deploy tool for plain servers), and the scaffold only sets up what the first slice needs. Your lawyer confirms the terms for keeping Azerbaijani personal data abroad before real client data goes in.

## Decision

**Chosen option**: Option 1: TypeScript modular API with React clients, a schema per practice, on DigitalOcean with Kamal

Build vetora as a pnpm and Turborepo monorepo holding a Hono API (one module per bounded context) on one Postgres database per country with a control schema plus one schema per practice, a client rendered React clinic app served from the same origin as the API, and an Expo owner app after the pilot, deployed as Docker images to DigitalOcean Frankfurt with Kamal.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`) · `organization-best-practices` (`better-auth/skills`, `.agents/skills/organization-best-practices/`) · `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `vite` (`antfu/skills`, `.agents/skills/vite/`) · `tanstack-query-best-practices` (`deckardger/tanstack-agent-skills`, `.agents/skills/tanstack-query-best-practices/`)

## Rationale

Reasoning, options, the landscape check, and the cross check: see [rationale.md](rationale.md).

## Proposed stack

**Arrives** says when each piece is built. The scaffold (this feature's build step) sets up only the rows marked *Scaffold*; every other row arrives with the slice that first needs it.

| Layer | Choice | Reason | Arrives |
|---|---|---|---|
| Architecture | A modular monolith API (one module per bounded context in `docs/domain.md`) plus separate client apps | One deployable backend for one developer, with one contract for two client apps (basis: monolith first; `docs/domain.md` §6) | Scaffold |
| Repository | One monorepo: pnpm workspaces + Turborepo | A contract change and every app that uses it land in one commit | Scaffold |
| Language | TypeScript, strict, everywhere | One language across API, web, mobile, and shared packages | Scaffold |
| Runtime | Node.js 24 LTS, pinned through the pilot; Node 26 LTS after | Every library below targets Node first | Scaffold |
| API framework | Hono on Node (`@hono/node-server`), routes declared with `@hono/zod-openapi` | One zod schema gives validation and an OpenAPI document (a standard API description) | Scaffold |
| Contracts | zod schemas in `packages/contracts`; the API publishes its OpenAPI document; both apps call it through types generated from that document (`openapi-typescript`) and `openapi-fetch` | One source of truth that scales across 13 modules and works the same in Expo | Scaffold |
| Primary database | PostgreSQL 18 if DigitalOcean offers it (native UUID v7), else 17; the major is pinned; databases created as UTF8 with an ICU collation (root `und-x-icu` by default) | Enforces domain rules in the database (RS-1, CR-1, RX-3, IN-3); Russian and Azerbaijani sort order is hard to change later (basis: a relational database as the default) | Scaffold |
| Data access | Drizzle ORM 1.0, pinned exactly to its release candidate until 1.0.0 ships (npm `latest` was still 0.45 on 2026-10-22), with the `node-postgres` driver; `drizzle-kit` migrations plus hand written SQL for triggers, functions, and exclusion constraints | SQL first, so database features stay first class; the data model spec is written against the 1.0 API so nothing is rewritten at 1.0.0 (basis: ORM for CRUD, SQL for complexity) | Scaffold |
| Tenancy | One database per country: a `control` schema plus one schema per practice, and one shared `graphile_worker` schema | Per clinic separation and one command export at a constant operational cost; details under *Tenancy and data topology* | Scaffold (control plus one dev practice) |
| Database roles | `vetora_migrator` owns tables, `vetora_app` runs the app (never owner, insert only on append only tables), `vetora_backup` reads for dumps | Append only rules (CR-1, RX-4, IN-1) become impossible to break, not just conventions (basis: least privilege) | Scaffold |
| Request context | Practice ID in the API path, membership checked on every request, one transaction per request that sets the practice schema and the acting person | The wrong clinic can never be read or written by accident | Slice 1 |
| Auth | Better Auth in the API, stored in the `control` schema: practice code plus handle sign in, organization plugin (a practice is an organization), admin plugin for you only, two factor (TOTP) enforced for managers and the platform admin (receptionists rely on the device session plus PIN switching); PIN switching as a custom plugin | Self hosted, no per user fees, identity stays where you host (basis: a proven auth library, never built from scratch) | Slice 1 (PIN switching before go live) |
| Sessions | An `httpOnly`, `Secure`, `SameSite=Lax` cookie on the single origin; sessions last hours on shared computers until PIN switching exists; cookie cache off; sign in rate limits stored in the database per account. Owner app later: Better Auth's Expo integration | A clinic shares one IP address and one reception computer | Slice 1 |
| Domain events | Synchronous handlers inside the same transaction for money and stock; an append only event table with one job per consumer when the first asynchronous consumer appears | Charges and stock never drift (RX-3, HS-3, IN-3) (basis: transactional outbox) | Slice 2 (sync); first async consumer (outbox) |
| Background jobs | Graphile Worker in a separate worker process, one runner for the whole database, practice ID in every job; clean stop on deploy | Jobs live in Postgres and join the transaction that creates them; no Redis (basis: database backed queue first) | Slice 6 |
| Live updates | Polling with TanStack Query until slice 5; then server sent events (a one way stream to open screens) fed by Postgres `LISTEN/NOTIFY`, IDs only, as refetch hints | No extra service; polling is enough until the first live screen | Slice 5 |
| Clinic web app | React + Vite, TanStack Router, TanStack Query, React Hook Form + zod; client rendered, behind login | A dense internal app of lists and forms; nothing public, so no server rendering | Scaffold (forms in slice 1) |
| UI kit | The vetora design system, already built as a Claude Design System artifact (three brand colours and 63 colour tokens, Roboto, a React component bundle with seven page templates and five print documents, plus a glossary, voice, messages, and formats in Azerbaijani, Russian, and English; link in the rationale's References); how the web app consumes it is chosen by the design system spec (scope feature 4) | The design exists; only the way the code consumes it is left to decide | Design system feature |
| Translations | `i18next` + `react-i18next`; `az`, `ru`, and `en` resources in `packages/i18n` (three languages, settled 2026-10-22 to match the design system; clients and documents carry a language from the same set) | Same library on web and mobile; Russian plural forms through the built in plural rules | Scaffold |
| Time and money | Instants stored in UTC (`timestamptz`), shown in the clinic's time zone (`Asia/Baku` today) with `date-fns` v4 + `@date-fns/tz`; money as integer minor units with a currency code (IN-4) | No floats, no time zone baked in | Slice 1 |
| Documents | `@react-pdf/renderer` components, rendered only in the worker, with fonts covering Cyrillic and Azerbaijani Latin; each issued PDF stored with its bytes, `SHA-256` hash, and template version, never rendered again | The stored document is the record, since output differs across library versions | Slice 6 |
| File storage | S3 compatible object storage (DigitalOcean Spaces, FRA1): one private bucket per environment, a folder (prefix) per practice, short lived signed links | The S3 API exists at every provider (basis: object storage, never files in the database) | Slice 6 |
| Search | Postgres full text search with `pg_trgm` and `unaccent` (through an immutable wrapper so it can be indexed); Cyrillic and Latin transliteration in app code | Database search first; nothing extra to run | Slice 6 |
| Owner app | React Native with Expo (Expo Router, EAS Build, `expo-notifications`), sharing `packages/contracts` and `packages/i18n` | Store builds and push handled; the same React model as the web app | After the pilot |
| Hosting | DigitalOcean Frankfurt (FRA1): droplets (virtual servers), managed Postgres with its connection pooler, Spaces | One simple provider for everything this stack needs | Scaffold (staging) |
| Backups | Managed Postgres backups and point in time recovery, plus nightly encrypted per schema dumps kept 30 days and 12 months, copied to a second provider | A single clinic can be restored, and one account problem cannot take everything (basis: point in time recovery plus rehearsed restores) | Slice 7 (before real data) |
| Deployment | Docker images in GitHub Container Registry, rolled out with Kamal (`kamal-proxy` handles TLS, path routing, and zero downtime switches); migrations run on the server before traffic switches | The same command works on any provider with plain servers | Scaffold |
| Environments | Local (Docker Compose: Postgres plus a local S3 compatible server), staging (FRA1, made up data only, mirrors production), production (FRA1) | Deploys and restores get rehearsed on the real shape | Scaffold (production in slice 7) |
| Domain and DNS | Domain from online.az; DNS hosted at DigitalOcean; one host per environment (app at `/`, API at `/api`) | DNS with an API; one origin removes CORS and CSRF traps | Scaffold |
| Errors | Sentry in its EU data region, SDKs in API, worker, and web; `sendDefaultPii` off; request bodies, query strings, names, phones, and clinical text scrubbed; source maps uploaded from CI | You know it from work; only stack traces and internal IDs leave | Scaffold |
| Logs, uptime, metrics | `pino` JSON logs with no personal data, kept 14 days on the host; DigitalOcean alerts (CPU, memory, disk, database connections at 70%) and an uptime check on `/up`; key product events counted in Postgres | Problems reach you in minutes; product numbers never leave your database | Scaffold (logs); slice 7 (alerts, events) |
| CI | GitHub Actions; the checks themselves are chosen by `/audit` | The repo already lives on GitHub | Scaffold |
| Email and SMS | None in the pilot; the SMS provider for owner sign in is chosen with the owner app | No provider until a feature needs one | After the pilot |

### Repository layout

```
apps/
  api/            Hono server plus the worker entrypoint and the migrate command (one image)
    src/modules/  one folder per bounded context in docs/domain.md (13)
    src/platform/ request context, database access, events, jobs, auth, files, PDFs, live updates
    config/       Kamal config (staging and production destinations)
  clinic-web/     React + Vite app for clinic staff, with its own Kamal config
  owner-mobile/   Expo app for pet owners (after the pilot; not scaffolded now)
packages/
  contracts/      zod schemas, roles, and the types generated from the OpenAPI document
  i18n/           az, ru, and en translation resources
  config/         shared TypeScript and lint config (contents chosen by /audit)
infra/            doctl script for DigitalOcean resources, restore runbook
```

Modules reach each other only through their public interface or domain events, never through each other's tables; `/audit` picks the lint rule that enforces this. Only `src/platform/` may import a database client.

### Tenancy and data topology

- **One database per country** (`vetora`), holding:
  - **`control` schema**: Better Auth tables (users, sessions, organizations as practices, members with roles) and the practice registry (practice ID equal to the organization ID, schema name, status); later the owner accounts. Deleting an organization is disabled.
  - **One schema per practice** (`p_<practiceId>`): every clinical, stock, money, and schedule table of that practice, `location_id` on location scoped rows (IN-5), a `staff_member` table mirrored from `control` (synced idempotently on membership changes, keeping a name and role snapshot), and the append only audit log (IN-1).
  - **`graphile_worker` schema**: one shared job queue; every job carries the practice ID.
- **Request context**: API paths carry the practice (`/api/p/:practiceId/…`). Middleware checks membership on every request, resolves the location from a validated header (a query parameter for event streams), and opens one transaction that runs `SET LOCAL search_path` to the practice schema and `set_config('app.actor_id', …, true)` for the acting person. Handlers read `ctx {practice, location, actor, db, log}` from `AsyncLocalStorage` (Node's per request storage). The default `search_path` holds no practice tables, so a query outside the wrapper fails instead of leaking. The registry cache lives at most 30 seconds and is cleared on change. A test with two practices proves neither sees the other.
- **Acting person**: `ctx.actor` is whoever unlocked with their PIN, not necessarily the session's user, and a PIN unlock never carries the manager role (Auth details); audit rows record the actor, written by a generic trigger that reads `app.actor_id`. Jobs carry `{practiceId, actorId, occurredAt, version}` and set the same context; there are no anonymous system actors.
- **Roles**: `vetora_migrator` owns schemas and tables and runs migrations. `vetora_app` gets data access only, with insert and select only on append only tables (audit log, ledgers, drug register); triggers reject edits after finalisation. `vetora_backup` reads for dumps. `CONNECT` is revoked from `PUBLIC`; `doadmin` is used only by provisioning.
- **Provisioning**: one idempotent script (safe to rerun) creates the practice schema, runs the practice migrations into it, grants roles, and registers it. It is the only code that calls DigitalOcean APIs.
- **Migrations**: forward only, in two steps (add first; remove old columns a release later, after a fresh dump). `drizzle-kit` keeps two sets (control, practice). The API image's `migrate` command runs on the server through `kamal app exec` before traffic switches, under one advisory lock, applying control first and then each practice schema. Drizzle's migration table in each schema is the truth; the app refuses to serve a practice whose schema is behind. Rollback means redeploying the previous image, which the two step rule keeps compatible. CI rejects migration files out of order (Drizzle skips them silently), and staging compares a schema only dump hash across practices. Drizzle runs pending migrations in one transaction, so none may use `CREATE INDEX CONCURRENTLY`.
- **Connections**: DigitalOcean's pooler (transaction mode) carries request traffic from day one, so request code uses no session state beyond `SET LOCAL`, no named prepared statements, and no advisory locks. Direct connections serve only `LISTEN`, the worker, migrations, and dumps. Defaults: API pool 10 per process through the pooler, worker concurrency 4, one `LISTEN` connection per API process; alert at 70% of the cluster's limit.
- **Reads across practices** (the owner app, your reporting): loop over practice schemas with qualified names in the worker or API; never by switching a request's practice.
- **Scale path**: a practice that outgrows the shared database moves to its own database (dump its schema, restore elsewhere, update the registry).

### Events and jobs

- **Now**: money and stock reactions run as synchronous handlers inside the request's transaction (RX-3, HS-3, IN-3).
- **From slice 6**: Graphile Worker in the `worker` role runs PDF rendering, imports, and the nightly dumps (its crontab). On `SIGTERM` the runner stops taking jobs and finishes running ones within Kamal's drain timeout, set above the longest job. Exhausted jobs and a growing queue alert through Sentry.
- **First asynchronous consumer** (messaging, later): an append only `domain_event` table written in the same transaction, one job per event and consumer with a `job_key`, each consumer recording `(event_id, consumer)` in its own transaction so a repeat is harmless, and versioned payloads.

### Live updates (from slice 5)

Screens poll with TanStack Query's `refetchInterval` until slice 5. From then on, the API streams server sent events on the same origin. `NOTIFY` carries IDs only (its payload limit is 8 kB), and clients treat them as hints to refetch. Clients refetch everything on each reconnect and show a "live updates paused" badge while disconnected. The `LISTEN` client reconnects with keepalive; deploys drop streams, and reconnect covers it.

### API conventions

- **Contract chain**: zod schemas in `packages/contracts` → `@hono/zod-openapi` routes → the OpenAPI document → generated types (`openapi-typescript`) → `openapi-fetch` in both apps.
- **Safe retries**: creates for money, stock, and clinical records use a UUID v7 generated by the client and `PUT /…/:id`, so a retry or a double click changes nothing.
- **No silent overwrites**: updates carry a `version`; a stale one is rejected (`If-Match`, status 412).
- **Drafts survive bad connections**: a note autosaves to the server every few seconds and mirrors to IndexedDB (the browser's database); after a dropped connection the mirror is offered back.
- **No personal data in URLs**: names and phones travel in request bodies (search uses POST); URL search parameters hold only non personal filters (status, dates, location).
- **Errors**: problem details JSON (a standard error shape); a Postgres error's `detail` (which can contain the conflicting value) is dropped before logging or responding.

### Auth details

- **Sign in**: practice code plus a handle, stored as the username `handle@practice-slug`. Better Auth requires an email, so each staff account stores a placeholder that cannot receive mail.
- **Staff accounts** are created only through custom endpoints guarded by practice permissions (a manager adds staff); email invitations are not used. Roles (manager, veterinarian, assistant, receptionist, groomer; spec 0002 and domain.md §3) are defined once in `packages/contracts` and mapped to the organization plugin's access control; the plugin's creator role is mapped to `manager`, so the first member's membership passes spec 0002's roles check.
- **Two factor** (TOTP, codes from an authenticator app) is required for every member holding the manager role and for the platform admin, enforced by a hook after sign in. Receptionists sign in on shared desk computers and rely on the device session plus PIN switching; administrator is the Russian and Azerbaijani word for the front desk, not a level of access (domain.md §3).
- **PIN switching** (designed in the first visit spec): a device session, a PIN unlock per person, and automatic lock when idle; the unlocked person becomes `ctx.actor` with their roles except manager. Manager only actions (settings, prices, staff, reports) need a session the manager signed in to with TOTP, never a PIN unlock (runner up: a TOTP step up at the first manager only action after an unlock).
- **Recovery**: a break glass script you run restores manager access and bootstraps the first manager of a new practice.
- **Versions**: Better Auth and its plugins are pinned exactly; read the changelog before upgrading.

### Documents

Print layouts are React PDF components sharing design tokens with the web app (the design system spec defines both), not HTML. They render only in the worker, never in the API process that serves live streams. Each issued document stores its PDF bytes, hash, and template version, and is never rendered again. The embedded font family covers Cyrillic and Azerbaijani Latin (ə, ğ, ı, ş, ç, ö, ü); the design system spec picks it.

### Backups and recovery

- **Managed Postgres**: daily backups and point in time recovery, which restores into a new cluster (one practice can be copied back from it, more slowly).
- **Nightly dumps** (worker crontab, with a `pg_dump` client matching the server major in the worker image): the `control` schema and each practice schema (`pg_dump -n`), encrypted, kept 30 daily plus 12 monthly, written to Spaces in a second region with a key that can write but not delete, and copied to a second provider.
- **Files**: Spaces versioning if available, otherwise a nightly copy.
- **Runbook** in `infra/`: restore one practice's dump into a new schema and swap it in the registry; rehearsed in feature 18 in the production account, never against staging. A Sentry cron monitor alerts when a dump is missed.
- **Targets**: data loss of minutes (point in time recovery) or at most 24 hours (dumps); one practice restored within hours.
- **Standby**: add a standby node to the cluster once real client data arrives.

### Runtime and deployment topology

- **Per environment at the start**: one droplet running `kamal-proxy`, the `api` service, and the `web` service; the `worker` role joins in slice 6. Managed Postgres with its pooler and a Spaces bucket sit beside it.
- **One origin**: `kamal-proxy` routes `/api` to the API and everything else to the web image on the same host (confirm path routing support in the scaffold spike). Fallback: `app.` and `api.` subdomains with a strict CORS allowlist, Hono's CSRF check, event streams opened with credentials, and the API address read at runtime from `config.json` rather than baked in at build.
- **Kamal**: one config per deployable (`apps/api`, `apps/clinic-web`), each with `staging` and `production` destinations; health check on `/up`; a pre deploy hook runs `migrate` on the server with the new image through `kamal app exec`.
- **Who deploys**: staging from CI on `main`; production from your laptop during the pilot (approval gates on private repos need a paid GitHub plan). CI reaches droplets as a key only SSH deploy user; the database accepts connections only from the droplets and trusted sources.
- **Infrastructure as a script**: a `doctl` script in `infra/` records how droplets, the database (with pooler and roles), Spaces, DNS, and alerts are created; the console is for reading.
- **Upkeep**: droplets run automatic security updates; one droplet means a short outage on reboot.

### Configuration and secrets

Validated with zod at startup, never committed, grouped by who needs them.

- **Runtime** (droplet, through Kamal secrets): `DATABASE_URL_POOLED` (app role through the pooler), `DATABASE_URL_DIRECT` (app role, for `LISTEN` and the worker), `BETTER_AUTH_SECRET`, `PUBLIC_ORIGIN`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SENTRY_DSN_API`, `SENTRY_DSN_WEB`
- **Migrations** (server, through `kamal app exec`): `DATABASE_URL_MIGRATOR`
- **Backups** (worker): `DATABASE_URL_BACKUP`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (write only), `OFFSITE_BACKUP_URL` and its credentials
- **Build** (CI): `SENTRY_AUTH_TOKEN` (source maps), `KAMAL_REGISTRY_PASSWORD`
- **Deploy**: an SSH deploy key and `KAMAL_REGISTRY_PASSWORD`; staging's in GitHub, production's only on your laptop during the pilot
- **Admin scripts** (your laptop only): `DATABASE_URL_ADMIN` (`doadmin`), `DIGITALOCEAN_TOKEN`

### Data location and compliance

Clinic data holds personal data of Azerbaijani clients, so Azerbaijan's Law on Personal Data applies: systems holding personal data must be registered, and cross border transfer has conditions that are not yet clear (basis: the MoFo and DLA Piper summaries in References). Production runs in Frankfurt by your decision. Before real client data reaches production, your lawyer confirms the transfer terms and the registration; ask early, because the answer gates go live. Staging only ever holds made up data. The app runs on any host, but point in time recovery, the pooler, and Spaces are DigitalOcean features: the in country fallback is self run Postgres with change log archiving (pgBackRest or WAL-G), PgBouncer, and an S3 compatible server. A second country is decided at expansion; Russia and Kazakhstan require in country storage, which points to its own deployment.

## Consequences

**Positive**:
- One language, one contract, and one set of translations across API, web, and mobile.
- The hardest rules (append only records, dispense and stock in one transaction, no double booked cage) are enforced by Postgres and its roles, not only by screens.
- Each clinic's data sits in its own schema: one command export, and a clear path to its own database.
- A constant operational surface: one database, one pool, one job runner, and one `LISTEN` connection per process, however many clinics join.
- Few vendors (DigitalOcean, Sentry, GitHub, plus a second provider for backup copies), and no Redis, search engine, or browser engine to run.
- The scaffold stays small: it builds only the rows marked *Scaffold*.

**Negative / tradeoffs**:
- Migrations still run once per practice schema; a failure midway relies on the protocol above.
- Schema isolation depends on the request context wrapper; a query outside it fails safely, but a routing bug could pick the wrong schema, which the two practice test guards.
- React rather than your daily Vue means a ramp up on the largest part of the work.
- Better Auth needs custom work: practice code sign in, staff creation endpoints, PIN switching, and two factor enforcement.
- React PDF supports a subset of CSS (flexbox layout), and its output changes across versions, which is why issued bytes are stored.
- Production holds Azerbaijani personal data abroad until the lawyer confirms the terms; a negative answer means a move to self run equivalents.
- Droplets need patching, and a single droplet means a short outage on reboot.
- Audit logging (IN-1) is mandatory for this data, so every module writes it.
- More conventions up front: client generated IDs, versions on updates, no personal data in URLs.

**Neutral**:
- The owner app is decided now (Expo) but built after the pilot; nothing for it is scaffolded.
- `/audit` chooses lint, format, type strictness, tests, and CI checks; the design system spec chooses the UI kit and fonts.
- Kamal runs as a Ruby gem or through its Docker image, on your laptop and in CI.

## Follow-up

- [ ] Ask your lawyer early (it gates go live): the cross border terms for Azerbaijani personal data and the registration of the system with the data protection authority; recorded in `docs/domain.md` as OPEN-13 on 2026-10-22.
- [ ] Data model spec (scope feature 3): the `control` and practice schema split, UUID v7 IDs (native in Postgres 18), extensions (`btree_gist`, `pg_trgm`, `unaccent` with its immutable wrapper), the collation details, the `staff_member` mirror, the audit trigger, and how a future owner account links to client records across practices.
- [ ] First visit spec (scope feature 5): PIN switching as a custom Better Auth plugin, practice code sign in, staff creation endpoints, and the two factor hook.
- [ ] Scaffold spike, proving each seam once: path routing in `kamal-proxy` (one origin), sign in through the full stack, two practice isolation, a migration failing at practice 2 of 2, Better Auth's Drizzle adapter on Drizzle 1.0, and DigitalOcean Postgres (version, extensions, pooler in transaction mode with `node-postgres`).
- [ ] Slice 6 spike: Graphile Worker (`add_job` inside the caller's transaction, lock expiry after a crashed worker, refusal when the schema is newer than the code), React PDF fonts, and clean job drain on deploy.
- [ ] Before real data: choose the second provider for backup copies and add a standby database node.
- [ ] Pin Node 24 through the pilot; move to Node 26 LTS after it.
- [ ] Enroll the pet owner app in the scope (`/scope pet owner app`; today "Client portal and online booking" sits in Deferred), choose the SMS provider for owner sign in with it, and verify Expo's pnpm monorepo setup then.
- [ ] Connect the MCP servers you picked in your MCP settings: DigitalOcean, Sentry, GitHub (all official).
- [ ] `turborepo` conventions are not yet in a root `AGENTS.md`; they apply repo wide and belong at root level.
- [ ] `vite` and `tanstack-query-best-practices` conventions belong in `apps/clinic-web/AGENTS.md` (only the web app uses them), with a pointer line in root `AGENTS.md`.
- [ ] `better-auth-best-practices` and `organization-best-practices` conventions belong in `apps/api/AGENTS.md` (auth lives in the API), with a pointer line in root `AGENTS.md`.
- [ ] Record for the `## Agent skills` section of `AGENTS.md`: MCP servers DigitalOcean, Sentry, GitHub; declined `better-auth-security-best-practices`, `drizzle` (lobehub), `drizzle-orm-patterns`, `tanstack-router-best-practices`.
- [ ] Before a second country, revisit one deployment per country.
- [ ] Design system spec (scope feature 4): turn the vetora design system into the project's `design.md` and decide how the web app consumes it (the published React bundle `window.Vetora`, or its source components vendored into the repo); reconcile its print documents (HTML `PrintSheet` pages for the browser's print dialog) with the React PDF decision above (for example render the same sheet to PDF in the worker, or keep browser print for drafts and stored PDFs for issued documents); decide whether its formatters (`Vetora.formatMoney`, `formatDate`, `formatCount`, `formatPhone`, `compareText`, built for Azerbaijani, Russian, and English because browsers lack Azerbaijani locale data) replace `date-fns` formatting and the i18next plural helpers in the web app. English joins Russian and Azerbaijani as a UI language (settled 2026-10-22; the Translations row now names all three).
- [ ] Scaffold notes from the 2026-10-22 doc check (`docs/research/2026-10-22-scaffold-doc-check.md`): pin TypeScript 6 (or alias `typescript` to `@typescript/typescript6`) until `openapi-typescript` and `drizzle-kit` support the TypeScript 7 compiler API; Sentry v11 replaced `sendDefaultPii` with `dataCollection`, so set every collection option off; kamal-proxy path routing needs Kamal 2.7 or later with `proxy.run.version: v0.10.2` in both configs (a path routing bypass was fixed in 0.10.1), both services on one host and `ssl` only on the `/` service; MinIO's community edition is archived, so the local S3 server is SeaweedFS; DigitalOcean Standard clusters created after 2026-11-30 get no standby node, so the standby plan needs an Advanced cluster.
- [ ] Drizzle: move from the 1.0 release candidate to 1.0.0 when it ships, reading the changelog first (the 2026-10-02 landscape check called 1.0 stable; on 2026-10-22 npm `latest` was 0.45.4 and 1.0 stood at release candidate 5).

## Change log

| Date | Change |
|---|---|
| 2026-10-02 | Written and cross checked. |
| 2026-10-22 | Updated in place: Drizzle pinned to the 1.0 release candidate; the UI kit row points at the existing vetora design system; two follow ups added (design system reconciliation, Drizzle 1.0.0). |
| 2026-10-22 | Updated in place from the grilling of the same day (`docs/research/2026-10-22-grilling-domain-terms.md`): two factor sign in is for managers and the platform admin, not receptionists; staff role names follow spec 0002 and domain.md §3 (manager, assistant, receptionist); the owner app keeps its name, it is the pet owner's app; OPEN-13 is recorded in domain.md; the repository layout names the three translation languages. |
| 2026-10-22 | Cross check of the update: the sign in plugin's creator role maps to manager; two factor is tied to the manager role; a PIN unlock never carries the manager role, so manager only actions need a TOTP session. |
