# Grilling 2026-10-24: what comes after spec 0002

What the `/grill-with-docs` session of 2026-10-24 decided about the next unit of work, and the edits those decisions imply outside `GLOSSARY.md` and `docs/adr/`. Round 1 settled the direction; round 2 (feature 4's own design) and the feature 5 spike round are recorded below as they settle. Tick a line when it has been applied.

## Round 1: direction (settled)

- Feature 4 (design system and UI foundation) is next, before feature 5 (the first visit). The design exists as a Claude Design System artifact (link in spec 0001's `rationale.md`), so feature 4 is a consumption job, kept thin; feature 5 follows, grilled in its own session.
- Feature 4's boundary. In: how the web app consumes the design system (spec 0001's one open UI decision); the tokens, font, icons, stylesheet, formatters and components brought into the repo under build, typecheck, lint and test; the app frame replacing the placeholder shell (AppShell, NavRail, PageHeader, the language switch) with the health check as the first page inside it in all three languages; `docs/design.md`; a DOM test environment for Vitest with the first component tests and the keyboard, touch and contrast check; the glossary rows left over from 2026-10-22. Out: real screens and forms (React Hook Form and zod arrive with feature 5), sign in, the PDF rendering mechanism in the worker (slice 6, feature 14), the owner app, dark mode (the system is light only).
- The medium loop: this window continues into `/to-spec` and `/to-tickets` (four or five tracer bullet tickets); the `ready-for-agent` label comes off the spec once it is ticketed.
- The interviews (OPEN-10 labels, OPEN-11 species) and the lawyer (OPEN-5, OPEN-13) gate neither feature 4 nor feature 5; the interim answers stand, and the interviews are scheduled in parallel before slice 1's species seed lands.
- The hosted deploy (feature 1's last Done when) stays deferred through feature 4 and is revisited at the end of slice 1 as the `/wizard` job the roadmap names, when sign in exists and spec 0001's remaining spike items (kamal-proxy path routing, sign in through the full stack) can be proven together.

## For `docs/scope/scope.md`

- [x] Feature 4: status `in progress` and the decide first tag gone (2026-10-24); the spec is issue #9 (https://github.com/bbyvfrd/vetora/issues/9), the tickets #10 to #13; add the code location when the first ticket lands.
- [x] Feature 4's Done when: unchanged; a grilled line under it names ADRs 0003 and 0004; feature 14's basis names ADR 0004 (2026-10-24).

## For `docs/RUNBOOK.md`

- [x] "Where we are": feature 4 grilled, spec and tickets next in the same window, then feature 5 (2026-10-24).

## Round 2: feature 4's design (settled)

- The web app vendors the design system's source, not the bundle: ADR 0003 (`docs/adr/0003-the-web-app-vendors-the-design-system-source.md`).
- A `packages/ui` workspace (`@vetora/ui`), compiled with `tsc` to `dist/` like the other packages, JSX emitted, CSS and font copied along, with a `dev` watch script; the web app imports `dist/`, the API's worker later imports the print components from it.
- `tokens.json` is copied verbatim; the package build compiles `tokens.css` by the artifact type's grammar (colours and shadows under `:root, [data-theme="light"]`, the rest under `:root`, a class per type style, `@font-face` for the self hosted Roboto); the output is committed and a test fails when stale.
- The artifact stays the source of truth for visuals and words; the copy records the artifact version in `design.md` (`1792792882-428d`, version 19, after today's glossary publish; `1792663141-bac8` before it); visual changes go artifact to repo as a re-copy ticket; code only changes live in the repo and are listed in `design.md`'s divergence section (in ADR 0003).
- The design system's formatters are the display layer for screens and paper; `date-fns` v4 with `@date-fns/tz` keeps instant arithmetic (UTC to the practice's wall clock, business dates in the API); counts go through `formatCount` with each noun's forms kept as an object in the translation files; money is formatted through a wrapper that turns minor units into the amount the formatter takes (IN-4).
- One implementation per printed document: the HTML sheets, printed through the browser for drafts, rendered to PDF in the worker by headless Chromium at feature 14: ADR 0004 (`docs/adr/0004-one-implementation-per-printed-document.md`), amending spec 0001's Documents row and section.
- Tests: jsdom with Testing Library and user-event in the ui and web Vitest projects; a keyboard walk and an axe check on the shell; a contrast test over `tokens.json` for the text and surface pairs `design.md` names (4.5:1 text, 3:1 controls); touch targets checked by hand on a tablet viewport in the ticket's demo and recorded in its verify notes.
- `docs/design.md` beside `domain.md`: the consumption decision and artifact version, token names and type classes, the component list and where each lives, the print sheets and paper sizes, the formatters' role, how words flow, the divergence list; the brand book's prose stays in the artifact; `packages/ui/AGENTS.md` carries the code conventions.
- Glossary: the design system glossary gained Arrival, Authorised person, Alert and Stock location, and its Owner row reads as PT-1 does (published as artifact version 19, `1792792882-428d`, on 2026-10-24, with the index's `lastChange` note); `GLOSSARY.md` carries the dated note; the matching lines of `docs/research/2026-10-22-grilling-domain-terms.md` are ticked. Estimate's Azerbaijani word (slice 8) and a UI word for DispenseEvent (slice 2) are still owed.

## For the frozen specs (amended by ADR, never edited in place)

- [x] Spec 0001, UI kit row: how the web app consumes the design system is resolved by ADR 0003.
- [x] Spec 0001, Documents row and section, and the "no browser engine" consequence: amended by ADR 0004.

## For the tickets (edits that land with the code, not now)

- [ ] `apps/clinic-web/AGENTS.md`: the design system is consumed from `@vetora/ui`; `src/index.css` goes; the formatters' role and the `date-fns` boundary; the test environment line (jsdom, Testing Library) once installed; dark mode is out (the system is light only).
- [ ] `packages/i18n/AGENTS.md`: counted strings carry their noun forms as an object for `formatCount`, replacing the i18next `_one`, `_few`, `_many`, `_other` suffix convention.
- [ ] `packages/ui/AGENTS.md` (new): the package, the artifact version, the token compiler, the conformance rules, the divergence list's home.
- [ ] `apps/api/AGENTS.md` (at feature 14): the worker renders the print sheets to PDF with Chromium.
- [ ] `CODING_STANDARDS.md`: unchanged; it already routes dates, numbers and sorting through the design system's formatters.

## The cut `/to-tickets` published on 2026-10-24: #10, #11, #12, #13, sub-issues of the spec #9, a straight chain

1. `packages/ui` with the token compiler, the font, the stylesheet and one component (Button), wired into the health page: proves the package build, Vite consumption, typecheck, Biome, and a first jsdom test.
2. The remaining components and the icons vendored and conformant, the print sheets among them, with the contrast test over the tokens.
3. The shell: AppShell, NavRail, PageHeader and the language switch replacing the placeholder, the health page inside it in three languages, the rail's translation keys from the glossary, the keyboard walk and axe check.
4. `docs/design.md`, `packages/ui/AGENTS.md`, the workspace docs' lines above, and the tablet check recorded.

## Feature 5 spike (settled)

- A one session `/prototype` detour on a `prototype/better-auth` branch before feature 5's grilling. Feature 5 is paused (2026-10-24) until feature 4 is specified and ticketed. Scope: Better Auth 1.7.12 with `@better-auth/drizzle-adapter/relations-v2` on `drizzle-orm` 1.0.0-rc.5 and the compose Postgres 18; hand written `control` tables with UUID v7 ids (`advanced.database.generateId` as a function) and `timestamptz`; `transaction: true`, joins off; username sign in with a custom validator and maximum length for `handle@practice-slug`; the organization plugin with the five staff roles and `creatorRole: "manager"`; admin `createUser`; TOTP enable and verify; `npx auth@latest check schema`; one Hono request that reads the session cookie and switches the practice role (spec 0002's request context, slice 1). Output: the branch and a `docs/research/` note the feature 5 grilling cites. It touches only the API, so it may run as its own session on its own compose database.
- Pins: `better-auth` and `@better-auth/drizzle-adapter` exactly 1.7.12, the `auth` CLI package at the same version (`@better-auth/cli` is deprecated). If rc.5 misbehaves in the adapter the spike reports it; the repo's Drizzle pin is not moved, and what to do then is a feature 5 grilling question.
- The research behind it (a sub agent on 2026-10-24, reading Better Auth v1.7.12 and drizzle-orm 1.0.0-rc.5 sources, issues and docs; nothing installed or run, so runtime claims are source reading): the default `better-auth/adapters/drizzle` import fails on the join path with Drizzle 1.0 rc (better-auth issues 10344, 10756, 10297); the fix is the relations-v2 adapter, PR 9489 (merged 2026-06-26), shipped in 1.7.0, documented at better-auth.com/docs/adapters/drizzle under Drizzle relations v2; the peer range admits `>=1.0.0-rc.1 <2.0.0`; Better Auth's own e2e runs that adapter on Postgres with node-postgres at rc.3, users report rc.4, nobody has reported rc.5 (shipped 2026-10-21); the schema object is keyed by model name (`user`, `session`, `account`, `verification`, `organization`, `member`, `twoFactor`, `rateLimit`); `generateId` as a function passes ids through untouched while the CLI then emits `text` id columns, and `"uuid"` mode replaces a forced v7 id; the CLI's v2 generator omits `.notNull()` where `required` is implicit (fixed only in 1.8.0-beta.1) and emits `timestamp` without time zone; the username plugin's default validator allows letters, digits, `_` and `.` up to 30 characters; invitations by id need a verified email (vetora creates staff through its own endpoints, so unaffected); `creatorRole` is typed `string`; no Better Auth test runs a non default Postgres schema at runtime.

## Inputs for feature 5's grilling (decided then, not here)

- Whether `handle@practice-slug` stays one username field with a custom validator, or handle and practice slug are separate fields behind a custom sign in endpoint.
- The control tables written by hand in the control migration set (`uuid` ids, `timestamptz`), checked with `auth check schema`, versus the CLI's output with edits.
- Whether `auth check schema` runs in CI beside `db:check`.
- The spike's own findings on rc.5 and the `control` schema at runtime.
