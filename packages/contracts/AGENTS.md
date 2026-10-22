# packages/contracts

## Overview

`@vetora/contracts`: the zod schemas every API route is declared with, and the `paths`, `components`, and `operations` types generated from the API's OpenAPI document (spec 0001, "Contracts"). The API imports the schemas; both apps import the types. Roles join with the first visit feature.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public surface: each schema module and the generated types |
| `src/health.ts` | `HealthResponse`, the schema behind `GET /api/health` |
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

- One schema per file under `src/`, exported from `src/index.ts` as the zod value and its inferred type under the same name (`export const HealthResponse = z.object(...)`, `export type HealthResponse = z.infer<typeof HealthResponse>`).
- A JSDoc comment on each field describes the wire value; it reaches the OpenAPI document. zod's own formats (`z.iso.datetime()`, `z.url()`) are preferred to regexes.
- Consumers see `dist/` only (`exports` in `package.json`), so a change reaches the apps after `build`; Turborepo runs it before their `build` and `typecheck`.
- Tests sit beside the code as `*.test.ts` (`src/health.test.ts` checks the schema) and run with `pnpm test` at the root; `tsconfig.json` typechecks them and `tsconfig.build.json` keeps them out of `dist/`.

## Gotchas

- openapi-typescript 7 declares a `typescript ^5` peer and warns on 6, then generates fine; TypeScript 7 is not supported yet, which is why the pnpm catalog pins 6.

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
