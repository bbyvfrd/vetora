# packages/contracts

## Overview

`@vetora/contracts`: the zod schemas every API route is declared with, the five staff roles and the permission matrix both apps read, and the `paths`, `components`, and `operations` types generated from the API's OpenAPI document (spec 0001, "Contracts"; spec #18). The API imports the schemas; both apps import the types.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public surface: each schema module and the generated types |
| `src/health.ts` | `HealthResponse`, the schema behind `GET /api/health` |
| `src/staff.ts` | `STAFF_ROLES` and `StaffRole` (the five), `joinRoles()` and `parseRoles()` (a membership's roles to and from Better Auth's comma joined `control.member.role`, in the order of the five) with `orderRoles()`, `permissions` (spec #18's matrix: each action and the roles that may perform it) and `can(roles, action)`; the API's route checks (#21) and the web app's hiding both read it, and the API's platform tables re-export the roles and the three helpers, tagged for the modules. `staff.test.ts` writes the spec's table out per role |
| `src/auth.ts`, `src/me.ts` | `SignInRequest` and `SessionResponse` (the two Better Auth routes the allowlist declares), `Me`, `LanguageUpdate` and `Language` (`GET /api/me`, `PUT /api/me/language`) |
| `src/practice.ts` | What every practice route shares: `PracticePath` (`/api/p/{practiceId}/…`) and `PracticeHeaders` with `LOCATION_HEADER` (`vetora-location`) |
| `src/phone.ts` | `normalisePhone()`, the one function that reads a typed phone number to E.164 with Azerbaijan as the default region (libphonenumber-js, this package's only dependency besides zod), and the `Phone` schema it backs |
| `src/patients.ts`, `src/clients.ts` | #21's routes: `SpeciesList`, `BreedCreate` and `Breed`; `PhoneLookup` and `PhoneLookupResult`; `Registration` (an existing or a `NewClient`, an existing or a `NewPatient`) and `Registered`. The web app's New visit form validates with the same schemas |
| `openapi.json` | The API's published document, written by `pnpm openapi`; committed, and CI diffs it |
| `src/generated/api.ts` | Generated from `openapi.json` by openapi-typescript; committed, never edited by hand |

## Commands

```bash
pnpm openapi                               # at the root: builds the API, writes openapi.json, then runs generate here
pnpm --filter @vetora/contracts generate   # only the openapi-typescript step
pnpm --filter @vetora/contracts build      # tsc -p tsconfig.build.json to dist/ (tests left out), which is what the apps import
pnpm exec vitest run --project @vetora/contracts   # at the root; pnpm test runs every workspace
```

## Conventions

- One file per route or concept under `src/` (`me.ts`, `clients.ts`), each schema exported from `src/index.ts` as the zod value and its inferred type under the same name (`export const HealthResponse = z.object(...)`, `export type HealthResponse = z.infer<typeof HealthResponse>`).
- A JSDoc comment on each field describes the wire value; it reaches the OpenAPI document. zod's own formats (`z.iso.datetime()`, `z.url()`) are preferred to regexes.
- Consumers see `dist/` only (`exports` in `package.json`), so a change reaches the apps after `build`; Turborepo runs it before their `build` and `typecheck`.
- `package.json` says `"sideEffects": false`, so the web app's bundler leaves out the schema modules a chunk does not use: a page that reads only `can()` does not carry libphonenumber-js. A module here keeps that true: no top level work but declaring schemas and constants.
- Tests sit beside the code as `*.test.ts` (`src/health.test.ts` checks the schema) and run with `pnpm test` at the root; `tsconfig.json` typechecks them and `tsconfig.build.json` keeps them out of `dist/`.

## Gotchas

- openapi-typescript 7 declares a `typescript ^5` peer and warns on 6, then generates fine; TypeScript 7 is not supported yet, which is why the pnpm catalog pins 6.

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
