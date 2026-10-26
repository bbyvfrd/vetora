# packages/i18n

## Overview

`@vetora/i18n`: the three UI languages (`az`, `ru`, `en`) and their translation resources, shared by the clinic web app and, later, the owner app (spec 0001, "Translations"). Keys are plain JSON under `src/locales/`. The words come from the design system glossary, and a counted noun carries the forms the design system's `formatCount` needs (`docs/design.md`, "Words").

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | `languages`, `defaultLanguage` (`az`), `languageNames`, `resources`, `isLanguage()`, and `TranslationResource` (the type of `en.json`) |
| `src/locales/{az,ru,en}.json` | One nested object per language, the same keys in all three |
| `src/plurals.ts` | The forms a counted noun carries in each language (`requiredForms`) and the checks `src/index.test.ts` runs over the live files: `isFormsObject`, `keyPaths`, `formsPaths`, `missingForms`. Private to the package; nothing imports it at runtime |

## Commands

```bash
pnpm --filter @vetora/i18n build       # tsc -p tsconfig.build.json to dist/ (tests left out), JSON copied along; the web app imports dist
pnpm --filter @vetora/i18n typecheck
pnpm exec vitest run --project @vetora/i18n   # at the root; pnpm test runs every workspace
```

## Conventions

- A key is added to all three files in the same change. `en.json` is the type source, so a key missing from `az` or `ru` is not a type error: at runtime i18next falls back to `az`.
- Keys are grouped by screen or concept (`health.title`, `language.label`), never by component or language.
- A counted noun is one key holding an object of its forms, named by the four forms the design system's `plural()` picks from (`one`, `few`, `many`, `other`) and holding what its language needs: `az` has `other` alone (the noun does not change after a number: 5 pasiyent), `ru` has `one`, `few` and `many` (1 пациент, 2 пациента, 5 пациентов), `en` has `one` and `other`. A screen reads the object with `t(key, { returnObjects: true })` and hands it to the design system's `formatCount` (spec #9, "Counts"; ADR 0007; the artifact's `formats.md`). i18next's own `_one`, `_few`, `_many` and `_other` suffix keys are not used. No counted noun exists yet; the first arrives with feature 5.
- Wording follows the design system glossary (link in spec 0001's `rationale.md`) and `docs/domain.md` §7.4 (what the screens say): a word the glossary lacks is added there first, in all three languages, then here (`docs/design.md`, "Words").
- `src/index.test.ts` proves every key exists in all three languages (a forms object counting as one key), that the three count the same nouns, and that each noun carries the forms its language needs; `src/plurals.test.ts` proves the checks on fixtures. Both run with `pnpm test` at the root, and `tsconfig.build.json` keeps tests out of `dist/`.

## Gotchas

- The package exports `dist/`: the web app sees a new key only after this package is rebuilt; `pnpm dev` does not watch it.
- A forms object is told by its keys: an object whose keys are all among `one`, `few`, `many` and `other`, with string values. A group of ordinary keys is never mistaken for one; a group that used those four names as its keys would be, so name keys after screens and concepts, as the convention says. A `zero` or `two` key, which `plural()` never reads, makes the object a plain group, whose keys then have to exist in all three languages like any other.

_Drafted from the repo on 2026-10-22, worth a quick human pass; edit freely._
