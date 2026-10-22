# packages/i18n

## Overview

`@vetora/i18n`: the three UI languages (`az`, `ru`, `en`) and their translation resources, shared by the clinic web app and, later, the owner app (spec 0001, "Translations"). Keys are plain JSON under `src/locales/`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | `languages`, `defaultLanguage` (`az`), `languageNames`, `resources`, `isLanguage()`, and `TranslationResource` (the type of `en.json`) |
| `src/locales/{az,ru,en}.json` | One nested object per language, the same keys in all three |

## Commands

```bash
pnpm --filter @vetora/i18n build       # tsc -p tsconfig.build.json to dist/ (tests left out), JSON copied along; the web app imports dist
pnpm --filter @vetora/i18n typecheck
pnpm exec vitest run --project @vetora/i18n   # at the root; pnpm test runs every workspace
```

## Conventions

- A key is added to all three files in the same change. `en.json` is the type source, so a key missing from `az` or `ru` is not a type error: at runtime i18next falls back to `az`.
- Keys are grouped by screen or concept (`health.title`, `language.label`), never by component or language.
- Plurals come from `Intl.PluralRules` (i18next 26, no plugin): `az` has `one` and `other`, `ru` has `one`, `few`, `many`, and `other`, so a counted string carries the `_one`, `_few`, `_many`, `_other` variants each language needs.
- Wording follows the design system glossary (link in spec 0001's `rationale.md`) and `docs/domain.md` §7.4 (what the screens say).
- `src/index.test.ts` proves every key exists in all three languages; it runs with `pnpm test` at the root, and `tsconfig.build.json` keeps tests out of `dist/`.

## Gotchas

- The package exports `dist/`: the web app sees a new key only after this package is rebuilt; `pnpm dev` does not watch it.

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
