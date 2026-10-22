# Tool Discovery Cache: Vetora Tech Stack
Cached: 2026-10-02

## Agent Skills by Technology

### Turborepo (monorepo build orchestration)
- **turborepo** | vercel/turborepo | Turborepo-specific build, caching, and monorepo patterns | High confidence
- monorepo-management | wshobson/agents | Monorepo structure and multi-package workflow guidance | Medium confidence
- turborepo-caching | wshobson/agents | Caching strategies for Turborepo | Medium confidence

### Drizzle ORM
- **drizzle** | lobehub/lobehub | Drizzle schema design, migrations, and query patterns | High confidence (5.2K installs)
- drizzle-orm-patterns | giuseppe-trisciuoglio/developer-kit | Advanced Drizzle patterns with database best practices | High confidence (4.8K installs)
- drizzle | bobmatnyc/claude-mpm-skills | Core Drizzle ORM usage | Medium confidence (4.4K installs)
- drizzle-migrations | bobmatnyc/claude-mpm-skills | Migration management with Drizzle | Low-medium confidence (1.3K installs)
- postgres-drizzle | ccheney/robust-skills | PostgreSQL + Drizzle integration | Low confidence (1.5K installs)

### TanStack Router
- **tanstack-router-best-practices** | deckardger/tanstack-agent-skills | Router configuration, navigation patterns, nested routes | Medium-high confidence (6.8K installs)

### TanStack Query (React Query)
- **tanstack-query-best-practices** | deckardger/tanstack-agent-skills | Query caching, data fetching patterns, stale-while-revalidate | High confidence (11.9K installs)
- tanstack-query | tanstack-skills/tanstack-skills | Core TanStack Query usage | Medium-high confidence (9K installs)

### Vite
- **vite** | antfu/skills | Build config, HMR, plugin development, performance optimization | High confidence (37K installs)
- vite-patterns | affaan-m/ecc | Common Vite patterns and workflows | Medium confidence (6K installs)
- react-vite-best-practices | asyrafhussin/agent-skills | React + Vite stack specific guidance | Medium confidence (2.7K installs)

### Better Auth
- **better-auth-best-practices** | better-auth/skills | Setup, OAuth flows, multi-provider configuration | High confidence (116.5K installs)
- better-auth-security-best-practices | better-auth/skills | Security hardening, session management, CSRF protection | High confidence (39.2K installs)
- email-and-password-best-practices | better-auth/skills | Email/password auth patterns | High confidence (38.5K installs)
- organization-best-practices | better-auth/skills | Multi-tenant/org patterns in Better Auth | Medium-high confidence (34.2K installs)

### React + Vite combined
- react-vite-best-practices | google-labs-code/stitch-skills | Dashboard and React component patterns | Low-medium confidence (4.3K installs)

### PostgreSQL
- supabase-postgres-best-practices | supabase/agent-skills | PostgreSQL best practices (EXCLUDED: supabase already installed)

### React Native / Expo (future, not in core stack yet)
- react-native-patterns | affaan-m/ecc | General React Native patterns | Low confidence (3.3K installs)

---

## MCP Servers by Technology

### PostgreSQL
- **@modelcontextprotocol/server-postgres** (Official) | https://www.npmjs.com/package/@modelcontextprotocol/server-postgres | Query execution, schema introspection, DDL/DML/read-only modes | Recommended
- **postgres-mcp-server** (Community) | https://github.com/ahmedmustahid/postgres-mcp-server | Basic PostgreSQL operations | Community
- **mcp-postgres** (Community) | https://github.com/helloscoopa/mcp-postgres | Read/DDL/DML permissions, schema inspection | Community

### Sentry (error monitoring)
- **sentry-mcp-stdio** (Official) | https://github.com/getsentry/sentry-mcp-stdio | Error retrieval, issue analysis, Seer AI root cause | Official (Sentry)
- **mcp-sentry** (Community) | https://github.com/mcp-100/mcp-sentry | Sentry.io issue analysis and debugging | Community

### DigitalOcean (hosting)
- **digitalocean-mcp** (Official) | https://docs.digitalocean.com/reference/mcp/ | Droplets, Spaces, App Platform, Databases (9 services, 48 tools) | Official (DigitalOcean)
- **digitalocean-mcp-server** (Community) | https://github.com/rohit-kaundal/digitalocean-mcp-server | Droplet management, Kubernetes, registries | Community
- **digitalocean-mcp** (Community) | https://github.com/amranu/digitalocean-mcp | DigitalOcean API endpoints | Community

### Better Auth (authentication)
- **@better-auth/mcp** (Official) | https://www.npmjs.com/package/@better-auth/mcp | OAuth server, protected resource, auth management | Official (Better Auth)
- **better-auth-mcp-server** (Community) | https://github.com/dabhivijay2478/better-auth-mcp-server | Auth configuration and integration | Community

### Expo / React Native (future mobile app)
- **mcp-react-native-expo** (Community) | https://github.com/Divagnz/mcp-react-native-expo | Automated refactoring, testing, analysis tools | Community
- **react-native-mcp** (Community) | https://github.com/ohah/react-native-mcp | App automation and monitoring | Community
- **react-native-expo-mcp** (Community) | https://github.com/ZaharGusyatin/react-native-expo-mcp | Scaffolding, architecture guidance, CI/CD | Community
- **Expo Official (Remote)** | Launched late 2025; provides SDK knowledge, simulator interaction, EAS workflows | Community/Official (Expo)

### GitHub (version control, CI/CD)
- **github-mcp-server** (Official) | https://github.com/github/github-mcp-server | PRs, issues, code search, workflow automation | Official (GitHub)
- Remote deployment | https://api.githubcopilot.com/mcp/ | Hosted, always up-to-date | Official (GitHub)

### Drizzle ORM
- **drizzle-docs** (Community) | https://github.com/Michael-Obele/drizzle-docs | Real-time Drizzle ORM documentation via semantic search | Community
- **drizzle-mcp** (Community) | https://github.com/defrex/drizzle-mcp | Database operations, migrations, schema introspection, query execution | Community
- **drizzle-sentinel-mcp** (Community) | https://github.com/akmalkhaniub/drizzle-sentinel-mcp | Database governance, schema linting, migration safety checks | Community

### Kamal (deployment)
None found as dedicated MCP server. Kamal deployment guidance available as Agent Skills only.

---

## Technologies with No Credible Candidates

- **Node.js / TypeScript** — no stack-specific skill found (general TS guidance exists elsewhere)
- **pnpm** — no dedicated skill found
- **Hono framework** — no dedicated skill found
- **Zod** — no dedicated skill found
- **Graphile Worker** — no dedicated skill found
- **React PDF** (@react-pdf/renderer) — no dedicated skill found
- **i18next / react-i18next** — no dedicated skill found
- **React Hook Form** — no dedicated skill found
- **Kamal** — only deployment guidance; no MCP server

---

## Already Installed (Excluded)

**Installed Skills** (from ~/.claude/skills):
- brand-naming-strategies
- humanizer
- impeccable
- second-brain, second-brain-ingest, second-brain-lint, second-brain-query
- supabase
- svg-logo-designer

**Connected MCP Servers** (excluded from search):
- context7
- figma
- playwright
- claude-in-chrome
- miro

---

## Summary Stats

- **Agent Skills found:** 23 credible candidates across 8 technology areas
- **MCP Servers found:** 16+ candidates (official + community) across 7 core tech areas
- **Search effort:** 11 CLI calls, 8 web searches
- **Coverage:** Good for ORM, auth, build tools, query libs; gaps in framework-specific (Hono, Zod), infrastructure (Graphile Worker), and deployment (Kamal)
