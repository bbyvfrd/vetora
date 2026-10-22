# 0001. Stack and architecture for vetora: rationale

The decision record behind [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: strong per clinic isolation was chosen for a solo, part time builder. The conventional default for a small team is shared tables with a practice ID on every row, guarded by row level security. This spec uses one schema per practice: it keeps a one command export per clinic and a path to a dedicated database, while the operational surface stays one database, one pool, and one job runner. A database per practice was chosen first and dropped after the cross check (below), because it multiplied migrations, workers, and connections by the number of clinics.

vetora is practice management software for companion vet clinics, Azerbaijan first and CIS countries later (`docs/scope/scope.md`). One developer builds it part time, aiming at a pilot with one design partner clinic in about six months. Every foundation feature (scaffold, data model, design system) waits on this decision.

The forces that shaped it:

- **Rules live in the data.** `docs/domain.md` requires finalised records to be append only (CR-1), dispensing and stock to move in one transaction (RX-3, IN-3), resources never to be double booked (RS-1), balances to come from a ledger (BL-6), every action to be attributed (IN-1), and every record to know its location from day one (IN-5).
- **Two client apps.** Clinic staff use desktop and tablet browsers, in Russian and Azerbaijani, behind a login, with printed documents. After the pilot, pet owners get an iOS and Android app.
- **Data location.** Client personal data falls under Azerbaijan's Law on Personal Data (registration, cross border conditions). Russia and Kazakhstan require in country storage.
- **Shared reception computers.** Per person attribution only survives if switching user is fast.
- **Solo operations.** Every service to run is time taken from features.
- **Your experience.** Vue and Nuxt daily at work (with Sentry and Nuxt's i18n module); React, Next.js, Drizzle, Prisma, and Supabase in personal projects.

## Options considered

Full stacks compared, not single tools.

### Option 1: TypeScript modular API with React clients, a schema per practice, DigitalOcean with Kamal

A Hono API with Drizzle on Postgres (a control schema plus one schema per practice), a React + Vite + TanStack clinic app on the same origin, an Expo owner app later, a pnpm + Turborepo monorepo, Graphile Worker for jobs, Better Auth for sign in, Docker images deployed with Kamal to DigitalOcean.

**Pros**:
- One language and one typed contract across every app
- The domain rules sit in Postgres features and roles (basis: `docs/domain.md` §8)
- The app runs on any provider with plain servers; few vendors

**Cons**:
- Assembled from libraries, so more wiring than a batteries included framework
- Per practice schemas need a migration loop and a strict request context wrapper; React is a ramp up from your daily Vue

### Option 2: Postgres BaaS (Supabase style) with React and Expo

A hosted backend for database, auth, storage, and live updates, with rules in SQL and row level security, React and Expo clients calling it directly, and edge functions for server logic.

**Pros**:
- Fastest start, and you have used it; auth, storage, and realtime included
- Still Postgres underneath, so the rules stay enforceable

**Cons**:
- Hosted regions do not cover your countries, and self hosting means running several services (basis: Russia and Kazakhstan localization rules)
- Much business logic ends up in SQL functions and edge functions, harder to test and keep modular; PIN switching does not fit its auth model

### Option 3: Nuxt full stack with Vue, and a Capacitor owner app

A Nuxt 4 app whose built in server (Nitro) is the API in the same deployable, with the owner app as Vue inside Capacitor (a native wrapper for web code).

**Pros**:
- Your daily framework and its i18n module; one deployable
- Vue components shared with the owner app

**Cons**:
- Nitro is thin for a 13 module backend with separate workers
- A web view owner app feels less native than Expo; Nuxt 5 is planned for late 2026, an early upgrade (basis: Nuxt blog)

### Option 4: Django with HTMX, plus a separate mobile app

A Python monolith with Django's ORM, admin, auth, and translations, HTMX for interactivity, and a mobile app against a Django REST API later.

**Pros**:
- Batteries included (admin, auth, migrations, translations); excellent for form heavy business apps

**Cons**:
- A new language, and no code shared with a TypeScript mobile app
- The live ward board and booking calendar fight its server rendered model

## Rationale

Option 1 fits the forces best. The domain's rules need a relational database with first class features (exclusion constraints, triggers, transactions) and an ORM that stays close to SQL. Two client apps need one API with a typed, documented contract. The data location rules need a stack that runs on any provider with plain servers. Every moving part runs inside Postgres or your own processes, so the operational surface is one database cluster, one bucket, and a few droplets (basis: boring technology; monolith first; database backed queue first).

Where you chose differently from my recommendation, stated plainly:

- **React for both apps, rather than Vue for both.** Vue would have been faster for the clinic app, given your daily work. React buys Expo's mobile tooling and one UI model across web and mobile. A fair trade, paid as a ramp up on the clinic app.
- **Per clinic isolation, rather than shared tables with row level security.** You first chose one database per practice. The cross check showed it would multiply migrations, workers, connections, and pooler setup by the number of clinics, so you moved to one schema per practice, which keeps the export and the path to a dedicated database at a constant operational cost. Shared tables remain the simplest fallback if the schema count ever becomes a burden.
- **One origin and a generated client.** After the cross check, the web app and API share one host (path routing), which removes CORS, CSRF, and event stream cookie traps; and both apps use types generated from the OpenAPI document with `openapi-fetch`, rather than Hono's `hc`, which slows type checking across 13 modules and ties clients to the server's code.
- **Countries decided at expansion, rather than one deployment per country now.** Nothing here prevents per country deployments later, and Russia and Kazakhstan make them likely.
- **Production in Frankfurt now.** Reasonable for the pilot, given the managed Postgres and storage it unlocks. It rests on your lawyer confirming the transfer terms before real data arrives.

Runner up: Option 3, had the owner app been a simple web portal.

### Smaller calls made in this spec (pick, why, runner up)

- **Typed client**: `openapi-typescript` with `openapi-fetch`, generated from the API's OpenAPI document; runner up Hono's `hc` (no codegen, but slow type checking at this size and clients coupled to server code).
- **One origin**: path routing in `kamal-proxy` (`/api` and `/` on one host); runner up subdomains with a CORS allowlist, a CSRF check, and runtime config.
- **Postgres driver**: `node-postgres`, the most proven with Drizzle and `LISTEN`; runner up `postgres.js`.
- **Forms**: React Hook Form with zod, mature and widely known; runner up TanStack Form.
- **Dates**: `date-fns` v4 with `@date-fns/tz`, stable today; runner up the Temporal polyfill.
- **Logs**: `pino`, fast structured JSON; runner up plain JSON console logs.
- **Image registry**: GitHub Container Registry, next to the repo; runner up DigitalOcean Container Registry.
- **DNS**: DigitalOcean DNS, scriptable and free; runner up the registrar's DNS at online.az.
- **Static web serving**: the built clinic app in its own small static file server image, routed by `kamal-proxy`; runner up serving the built app from the API image.
- **Local object storage**: a local S3 compatible server in Docker Compose (SeaweedFS or Garage; MinIO's community edition changed in 2025, verify); runner up LocalStack.
- **Per clinic restores**: nightly encrypted per schema dumps; runner up point in time recovery into a new cluster and copying one practice back (works, but slower).
- **Deploy trigger**: staging from CI on `main`, production from your laptop during the pilot; runner up an approved CI run (needs a paid GitHub plan for a private repo).
- **Infrastructure**: a `doctl` script in the repo; runner up Terraform or OpenTofu (more power, more to learn for one person).

### Landscape check (2026-10-02)

One capped web check before the stack questions (cache: `docs/research/2026-10-02-stack-architecture-landscape.md`):

- **Azerbaijan**: systems holding personal data must be registered with the data protection authority (medium confidence); whether storage must stay in the country is unclear (low confidence). Russia and Kazakhstan require in country storage.
- **Nuxt**: 4.5.1 current (July 2026), Nuxt 3 end of life July 2026, Nuxt 5 planned for late 2026. Next.js was not checked.
- **Better Auth**: 1.6.x (April 2026), a Drizzle adapter, plugins for username, two factor, organization, admin, phone number, and passkeys.
- **Job queues**: Graphile Worker and `pg-boss` both maintained; `pg-boss` confirms transactional enqueue; Graphile Worker's SQL `add_job` exists, and its same transaction behavior is a scaffold spike.
- **Drizzle**: 1.0 stable with Postgres row level security support. *Correction (2026-10-22): 1.0 was not stable on npm; `latest` was 0.45.4 and 1.0 stood at release candidate 5, published 2026-10-21. The spec pins the release candidate.* Check constraints have long been supported (the check did not confirm it, the cross check did); exclusion constraints need hand written SQL. Its migrator runs pending files in one transaction and skips files out of order (cross check, verify on 1.0).
- **Gotenberg** (runner up for documents): v8, maintained.
- **Not checked**: `@react-pdf/renderer`, Expo with pnpm monorepos, DigitalOcean's Postgres versions and extensions, current TanStack Router and Kamal versions, `kamal-proxy` path routing.

### Cross check (2026-10-02)

An independent read of the first draft on a different model found 14 decision gaps (request context, database roles, migration protocol, identity across schemas, events and jobs, scaffold boundary, backups, connection budget, staff accounts without email, database creation settings, web to API origin, deploy plumbing, retry safety, documents) and five soundness concerns (the database per practice cost, one failure domain, personal data in URLs and logs, premature live updates, session settings on shared computers). You chose to apply every recommended fix and to switch to one schema per practice; index.md reflects both. Wording corrections taken from it: point in time recovery can restore one practice through a new cluster, `unaccent` needs an immutable wrapper for indexes, React PDF output is not byte stable across versions, and Node 24 stays pinned through the pilot.

## References

**Project sources**:
- `docs/domain.md`: §6 bounded contexts, §8 invariants, §10 cross cutting concerns, §11 out of scope
- `docs/scope/scope.md`: feature 1 and the product decisions (pilot, languages, devices, monitoring)
- Installed skills: `better-auth-best-practices`, `organization-best-practices`, `turborepo`, `vite`, `tanstack-query-best-practices` (in `.agents/skills/`)
- The vetora design system, a Claude Design System artifact (added 2026-10-22): https://claude.ai/artifact/1q8EqTdSMXAx7J2nh7yPYS
- Your other projects' stacks (Vue and Nuxt at work; Next.js, Drizzle, Prisma, Supabase in personal projects)
- `docs/research/2026-10-02-stack-architecture-landscape.md`

**Practices & standards**:
- Monolith first; a relational database as the default; ORM for CRUD, SQL for complexity
- Database backed queue first; transactional outbox with idempotent consumers
- Object storage for files, never the database; a proven auth library, never built from scratch
- Boring technology; point in time recovery plus rehearsed restores, with written data loss and restore time targets
- Least privilege database roles; forward only migrations in two steps (expand, then contract)
- Idempotent creates with client generated IDs; optimistic concurrency with versions
- No personal data in URLs or logs
- Data localization rules (Russia's 152-FZ, Kazakhstan)

**Links** (web verified on 2026-10-02):
- Azerbaijan, Morrison Foerster privacy library: https://www.mofo.com/privacy-library/azerbaijan
- Azerbaijan, DLA Piper Data Protection Laws of the World: https://www.dlapiperdataprotection.com/index.html?t=law&c=AZ
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Drizzle ORM row level security: https://orm.drizzle.team/docs/rls
- Nuxt blog (4.5 current, 5 planned): https://nuxt.com/blog
- Gotenberg: https://gotenberg.dev
- DigitalOcean MCP server: https://docs.digitalocean.com/reference/mcp/
- GitHub MCP server: https://github.com/github/github-mcp-server
- Skills: https://github.com/better-auth/skills · https://github.com/vercel/turborepo · https://github.com/antfu/skills · https://github.com/deckardger/tanstack-agent-skills
