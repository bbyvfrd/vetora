Cached: 2026-10-02

## 1. Azerbaijan Data Protection & Localization

**Findings:** Law on Personal Data No. 998-IIIQ (2010) requires **registration of information systems holding personal data** with the Data Protection Authority. **Data localization requirement unclear** — sources mention the law "forms the Section of personal data in national information space" and addresses "cross-border transfer of personal data," but fetched legal summaries (MoFo, others) do not confirm whether in-country storage is mandatory or transfer is merely restricted.

**Russia (152-FZ):** Requires personal data of Russian citizens stored inside Russia (hard localization mandate). **Kazakhstan:** Requires in-country processing/storage for citizen data (hard localization).

**Source:** Morrison Foerster privacy library; DLAPiper data protection laws; CIS Legislation. | **Freshness note:** Law from 2010; legal interpretations may have 2024–2026 amendments not fully captured. **Confidence:** Medium on registration requirement, Low on localization specifics.

**URLs:** https://www.mofo.com/privacy-library/azerbaijan | https://www.dlapiperdataprotection.com/index.html?t=law&c=AZ

---

## 2. Nuxt & Next.js Stable Versions

**Nuxt:** **v4.5.1** (released July 27, 2026) is current stable. Includes Vite 8, Rspack 2, experimental SSR streaming, stable error codes. Nuxt 3 reached EOL July 31, 2026. Nuxt 5 scheduled Q4 2026.

**Next.js:** **Not searched** (5-search limit used). Recommend checking Next.js official releases.

**Source:** Nuxt blog (July 2026). | **Freshness note:** July 2026 release date. **Confidence:** High for Nuxt.

**URLs:** https://nuxt.com/blog

---

## 3. Better Auth: Status, Nuxt Support & Plugins

**Version:** v1.6.9 (April 2026, latest); v1.7.0-beta.2 available.

**Drizzle Adapter:** `@better-auth/drizzle-adapter` published April 24, 2026. Supports database joins via `advanced.database.joins` config (v1.4.0+).

**Plugins (50+ available):** 
- ✓ Username sign-in
- ✓ Two-factor authentication  
- ✓ Organizations (org, team, member management)
- ✓ Admin plugin
- ✓ SSO  
- ✓ Passkeys, magic links, phone auth, API keys, JWT, bearer tokens

**Nuxt Support:** Multiple community integrations exist (@leamsigc/nuxt-better-auth-drizzle, others) but **Nuxt framework support not explicitly confirmed in official docs fetch**. Lucia auth status **not found in sources**.

**Source:** better-auth.com/docs (plugins, adapters); npmjs.com (version dates); GitHub integrations. | **Freshness note:** April 2026 release. **Confidence:** High on plugin list, Medium on Nuxt/Lucia.

**URLs:** https://better-auth.com/docs/adapters/drizzle | https://npmx.dev/package/@better-auth/drizzle-adapter

---

## 4. Postgres-Backed Job Queues

**Graphile Worker:** High performance (10k jobs/sec), low latency (LISTEN/NOTIFY), supports immediate/delayed jobs, max attempts, deduplication, recurring tasks. **SQL add_job capability mentioned** but `graphile_worker.add_job()` same-transaction behavior **not confirmed** in fetched sources.

**pg-boss:** SKIP LOCKED queries, transactional enqueue, cron scheduling, retries w/ backoff, priorities, dead-letter queues, dashboard, ORM adapters.

Both actively maintained as PostgreSQL-only alternatives to Redis. Graphile Worker Rust variant also available.

**Source:** DEV Community, LibHunt comparisons, GitHub repos (mitchellderijcke/graphile-worker). | **Freshness note:** 2026 references in comparisons. **Confidence:** High on general features, Low on SQL transaction guarantees.

**URLs:** https://github.com/mitchellderijcke/graphile-worker | https://www.libhunt.com/compare-pg-boss-vs-worker

---

## 5. Drizzle ORM & Gotenberg

**Drizzle ORM:** **v1.0 stable** released. **✓ Supports Postgres Row-Level Security (RLS):** `pgTable.withRLS()`, `pgPolicy()` with select/insert/update/delete options, role definitions, integration w/ Neon & Supabase. **Check constraints support — not confirmed** in fetched docs.

**Gotenberg:** **v8 current stable.** MIT-licensed, Docker-based API for PDF conversion. Features: Chromium (HTML/Markdown/URL→PDF), LibreOffice (Office formats), PDF engines (merge/split/encrypt). 88M+ Docker pulls, 12k+ GitHub stars, active maintenance.

**Source:** orm.drizzle.team/docs (RLS); gotenberg.dev (features). | **Freshness note:** Drizzle docs current, Gotenberg v8 stable. **Confidence:** High on RLS, High on Gotenberg.

**URLs:** https://orm.drizzle.team/docs/rls | https://gotenberg.dev
