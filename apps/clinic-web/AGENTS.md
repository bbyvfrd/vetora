# apps/clinic-web

## Overview

The web app for clinic staff: React 19 on Vite 8, rendered in the browser and served from the same origin as the API (`/api`). Routes are files under `src/routes/`, server state goes through TanStack Query, the API is called through the typed client from `@vetora/contracts`, and every piece of screen text comes from `@vetora/i18n`. The design system comes from `@vetora/ui` (ADR 0003): its stylesheet is imported once in `src/main.tsx` and the app has no stylesheet of its own; the frame of every screen is the design system's shell (ticket #12), and its formatters are the display layer for every date, number, amount and count (`docs/design.md`, "Formatters"). A component fix is made in `packages/ui` and synced up to the artifact; a token, word or icon change is made in the artifact and re-copied (ADR 0005).

## Stack

- React 19, Vite 8 with `@vitejs/plugin-react`, TypeScript project references (`tsc -b`, `erasableSyntaxOnly`)
- TanStack Router 1 (file routes; `@tanstack/router-plugin` writes `src/routeTree.gen.ts`) and TanStack Query 5
- `openapi-fetch` over the generated `paths` type; i18next 26 with react-i18next 17; `@sentry/react` 11 and `@sentry/vite-plugin`
- Static files behind nginx 1.29 in the image (`Dockerfile`, `docker/`), rolled out with Kamal (`config/deploy.yml` and a destination file per environment)

## Key files

| File | Owns |
|---|---|
| `src/main.tsx` | Mounts the app: the `QueryClient`, the router from `createAppRouter()`, the i18n side effect import, error reporting |
| `src/router.ts` | `createAppRouter(queryClient, history?)`: the route tree with the query client in its context, and the session's end handled once: a 401 from a vetora route after `/api/me` had answered clears the cache and goes to `/sign-in?ended=true` (error.session) |
| `src/session.ts` | `meQuery` (`/api/me`, the app's first call after sign in; `SignedOut` on a 401), `signIn()` (joins `handle@code` in lower case, remembers the clinic code in `localStorage` key `vetora.clinicCode` after a success), `signOut()`, `rememberedClinicCode()` |
| `src/routes/__root.tsx` | The root: the query client in the router's context and nothing else; the signed in pages sit in `_app.tsx`, the sign in page outside it |
| `src/routes/_app.tsx` | The signed in shell (tickets #12 and #19): its guard ensures `/api/me` before any page loads and sends a person with no session to `/sign-in`; `AppShell` with the `NavRail` (the reversed logo as its brand, one section of routed places with `aria-current` from the router's location, the account entry at its foot: the name, the roles and clinic, a link to `/profile`), the skip link's text and the rail's name from the `shell.*` keys, `<Outlet />` inside; the interface follows the language saved to the login. `places` lists the routed places with their route, icon and title key (Visits today at `/`, then the status page at `/status`); a new place is a row there |
| `src/routes/_app/index.tsx`, `status.tsx`, `profile.tsx`, `src/routes/sign-in.tsx` | Visits today (the signed in home), the status page, the profile, and the sign in page outside the shell (`?ended=true` shows that the session ended) |
| `src/pages/SignInPage.tsx` | The sign in page as the design system's SignInPage example lays it out (artifact version 23): `AuthLayout` with the stacked reversed logo and its line, Clinic code (filled from this computer's last sign in), Username, Password, one button, the forgotten password line, the language choice in the three languages' own names; one refusal message whatever was wrong (error.signin), the password cleared; error.offline without a connection; error.session after a session ended |
| `src/pages/VisitsTodayPage.tsx`, `ProfilePage.tsx` | Visits today, empty until the visit arrives (an `EmptyState`); the profile: the person, their clinic and roles, the language `Select` saved to the login (`PUT /api/me/language`, put back when refused), and Sign out |
| `src/pages/StatusPage.tsx` | The status page, in the rail after Visits today: a `PageHeader` with the title as the h1 and a `PageBody` holding the status region (named by the same title), which polls `/api/health` every 30 s and shows the brand book's page states with `@vetora/ui`: a `Skeleton` with the region `aria-busy` while the first check is in flight, a danger `Banner` first in the page with "Try again" when the API is down, a success `Badge` with the version when it is up. `StatusPage.test.tsx` beside it is the DOM test of the three states |
| `src/app.test.tsx` | Seam 1 of spec #9 and seam 3 of spec #18: mounts the real route tree on an in-memory history with the real translations and proves the signed in shell as a person meets it: Visits today in the shell, the named rail with its two routed places and the current one marked, the account entry, the skip link first in the tab order and focusing `main`, the language of the login in each of the three with axe finding nothing, no session leading to the sign in page, and a 401 after sign in leading there with error.session |
| `src/pages/SignInPage.test.tsx`, `ProfilePage.test.tsx` | Seam 3 of spec #18 for the two pages, through the real router: the fields and the language choice in each language with axe, the remembered clinic code, `handle@code` sent in lower case, the one refusal message, the empty fields, no connection; the profile from the account entry, the language saved and put back when refused, Sign out back to the sign in page with the code filled in, axe in each language |
| `src/test-support.tsx` | The DOM tests' helpers: `stubApi()` (the stubbed fetch, routed by `METHOD /path`, recording what was asked), `problemAnswer()`, `meOf()`, `renderApp(path)` (the app as main.tsx mounts it, on a memory history), `violationsOf()` and `axeOptions` |
| `src/assets/` | The reversed horizontal logo for the rail, the stacked reversed logo for the sign in page's brand panel, and the reversed mark (for a collapsed rail later), copied from the design system artifact's asset store (its `assets/Logos`) |
| `index.html`, `public/` | The favicon set and `site.webmanifest` from the artifact's `assets/Favicon` with the link tags its README gives (its dark tab style line is in `favicon.svg`), `theme-color`, and `color-scheme` light; `public/config.json` is the local runtime config |
| `src/routeTree.gen.ts` | Generated by the router plugin from `src/routes/`; never edited by hand |
| `src/api/client.ts` | `api`, the typed client on `window.location.origin` (same origin, spelled out so the DOM tests can run it) |
| `src/i18n.ts`, `src/i18next.d.ts` | i18next setup, the per browser language (`localStorage` key `vetora.language`, default `az`; the sign in page's choice, overridden by the login's language once signed in), typed translation keys |
| `src/sentry.ts` | Reads `/config.json` at runtime and starts Sentry with every collection option off |
| `src/test-setup.ts` | jest-dom's matchers, a `scrollTo` stub for the router, and Testing Library's cleanup, loaded by the `test` block of `vite.config.ts` |
| `vite.config.ts` | Router plugin before React, the dev port and the `/api` proxy target read from the root `.env` (`pnpm local:setup`; a taken port fails instead of drifting), hidden source maps uploaded only when `SENTRY_AUTH_TOKEN` is set (CI), the `test` block (jsdom, the setup file) |
| `docker/nginx.conf`, `docker/10-runtime-config.sh` | `/up`, caching rules, 404 for `.map` files, `index.html` for every route; `/config.json` written from the container environment at start |

## Commands

```bash
pnpm --filter @vetora/clinic-web dev        # Vite on this checkout's web port (5173 in the main folder, pnpm local:status); the API must run too (pnpm dev at the root starts both)
pnpm --filter @vetora/clinic-web build      # tsc -b, then vite build to dist/
pnpm --filter @vetora/clinic-web typecheck  # tsc -b
pnpm --filter @vetora/clinic-web preview    # serves the built dist/
```

## Conventions

- A route is a file under `src/routes/` using `createFileRoute`; the plugin regenerates `routeTree.gen.ts` during dev and build.
- The API is reached only through `api` from `src/api/client.ts`, so every call is typed against the OpenAPI document; server state lives in TanStack Query (`useQuery` with array keys), not in component state.
- No screen text in components: every string is a key in `packages/i18n` (`t('health.title')`) that exists in `az`, `ru`, and `en`; `document.documentElement.lang` follows the chosen language. A word the design system glossary lacks is added there first, then to the three locale files (`docs/design.md`, "Words").
- Values are shown through the design system's formatters from `@vetora/ui`, never raw `Intl` for `az` (`CODING_STANDARDS.md`, "Screen text"). A stored amount in minor units goes through `formatMinorUnits` with its currency (IN-4); `formatMoney` is never called with a stored amount, and `InvoiceTable` and `Receipt`, which take manat numbers today, are changed in `packages/ui` before the first invoice screen (`docs/design.md`, "Not yet"). `formatDate` and `formatTime` take a day as `YYYY-MM-DD` or a `Date` already in the practice's wall clock: a UTC instant from the API is converted first with `date-fns` and `@date-fns/tz`, installed with the first screen that shows an instant, and business dates are computed in the API and travel as dates (`docs/design.md`, "Formatters"). A count goes through `formatCount` with the noun's forms read from the translation files (`t(key, { returnObjects: true })`); lists of names sort with `compareText`.
- Runtime values (Sentry DSN, environment, release) come from `/config.json`, never from `import.meta.env` at build time, so one image serves every environment.
- No personal data in URLs: search parameters hold only filters that are not personal (status, dates, location); names and phones travel in request bodies (spec 0001, "API conventions").
- Imports carry no extension (bundler resolution); `verbatimModuleSyntax` and `erasableSyntaxOnly` are on, so types are imported with `import type`, and enums, namespaces, and parameter properties are out.
- A route file exports only `Route`; the page it mounts lives under `src/pages/`, so a page test renders the page without the router, and `src/app.test.tsx` mounts the real route tree for the shell.
- A new routed place is a route file under `src/routes/_app/`, a page under `src/pages/` that renders a `PageHeader` (the page's h1) and a `PageBody`, and a row in `_app.tsx`'s `places` with its icon from the set by meaning (the artifact's `assets/Icons/README.md`) and its title key; the rail lists routed places only, so there are no dead links.
- Every page behind the shell is signed in: `_app.tsx`'s guard has read `/api/me`, so a page reads the person, the practice id and the locations with `useSuspenseQuery(meQuery)` and never from Better Auth's active organization. Sign in and sign out go through `src/session.ts`; a 401 anywhere is the router's to handle (`src/router.ts`), not a page's.
- No stylesheet of its own: styling comes from `@vetora/ui`'s stylesheet and its components, the colour scheme is light (`index.html`), and the only CSS this app may ever add is layout glue.
- Tests go beside the code as `*.test.tsx` and run with `pnpm test` at the root in jsdom (the `test` block of `vite.config.ts`) with Testing Library: `@testing-library/react`, `user-event`, and jest-dom's matchers through `src/test-setup.ts`. A page test renders the page with a `QueryClient` and the real translations (`import '../i18n'`), stubs `fetch` inside `vi.hoisted` (the typed client captures `globalThis.fetch` when it is created), and asserts what a person sees: roles, names, text; the shell test adds `user-event`'s Tab and `axe` from `vitest-axe`.

## Gotchas

- `@vetora/contracts` and `@vetora/i18n` resolve from their `dist/`: after editing either, rebuild it (`pnpm --filter @vetora/i18n build`); `pnpm dev` builds them once and does not watch them. `@vetora/ui` is watched: its `dev` script (`tsc --watch`) runs under `pnpm dev`, so a component edit reaches the browser without a rebuild.
- jsdom stays on 29 until the local Node reaches 24.15, jsdom 30's floor (`.nvmrc` says 24; the machine had 24.14.0 on 2026-10-24).
- Source maps are hidden and must never reach the image or the browser: the Dockerfile deletes `*.map` after the build and nginx answers 404 for them.
- Client side routing: nginx serves `index.html` for unknown paths; hashed assets are cached for a year, `index.html` and `/config.json` are not.
- jsdom does not move focus to a fragment link's target, which is why `AppShell`'s skip link focuses `main` itself (`docs/design.md`, the ledger); its `scrollTo` only reports "not implemented" (replaced in `src/test-setup.ts`), and it has no canvas, so the shell test's axe run leaves out `color-contrast` (seam 2's token test covers contrast) and `document-title` (the title is in `index.html`).
- The DOM tests stub `fetch` and run no API, so a page test proves what a person sees for each answer; what the API does with a request is the API seam's (`apps/api/src/test-support.ts`). The cookie never shows in the page: it is httpOnly, and the tests have none.
- Browsers lack Azerbaijani locale data for dates, numbers and sorting, so nothing here calls `Intl` for them: the design system's formatters carry their own month and weekday names, number rules and alphabet (`docs/design.md`, "Formatters"). Counted nouns do not go through i18next's `Intl.PluralRules` plurals either: a noun's forms are one object in the translation files, picked by `formatCount` (`packages/i18n/AGENTS.md`).

## Agent skills

- [vite](../../.agents/skills/vite/): `antfu/skills`, Vite 8 (Rolldown) configuration, plugins, and the build
- [tanstack-query-best-practices](../../.agents/skills/tanstack-query-best-practices/): `deckardger/tanstack-agent-skills`, query keys, caching, mutations, and prefetching

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md): the clinic web app row, one origin, errors, translations
- Spec #9 (feature 4, a GitHub issue) and ADR 0003: the design system consumed from `@vetora/ui`, the status page as the first screen on it; ADR 0005: component code is the repo's, design data the artifact's
- [`docs/design.md`](../../docs/design.md): the design system as the code needs it: tokens, type, components, print, the formatters and the time zone boundary, how words flow, the ledger

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
