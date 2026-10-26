# packages/ui

## Overview

`@vetora/ui`: the vetora design system as a workspace package (ADR 0003). The design system artifact's tokens compiled to CSS variables, Roboto self hosted, the icon set, the component stylesheet, 53 React components with their helpers and formatters, and the repo's own money wrapper, built with the repo's TypeScript to `dist/` and imported by the web app today and by the API's worker from feature 14 (ADR 0004). What the code needs from the design system, who decides each kind of thing, and the ledger of the repo's changes to the sources are `docs/design.md`; the brand book's prose stays in the artifact (link in `docs/specs/0001-stack-architecture/rationale.md`).

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public surface: the artifact's index at the fork point, name for name, plus the repo's additions since (ADR 0005); `src/index.test.ts` holds both lists |
| `src/*.tsx` | The components, one file per family: `Feedback.tsx` holds `Banner` and `Toast`, `Layout.tsx` the `AppShell` and the page parts, `Charts.tsx` the figures, `Print.tsx` the six print components, `Field.tsx` the field frame the inputs share. The repo's since ADR 0005 |
| `src/format.ts`, `src/dates.ts` | The formatters, the display layer for screens and paper, and the month and weekday names they carry (`docs/design.md`, "Formatters") |
| `src/money.ts` | `formatMinorUnits`: whole minor units with a currency to the design system's money format, the one place that divides money (IN-4); `money.test.ts` beside it |
| `src/appointment.ts`, `src/toasts.ts`, `src/modal.ts`, `src/util.ts` | `appointmentBadge`, the toast queue behind `toast()` and `Toaster`, the modal hook of `Dialog`, `Drawer` and `PrintPreview`, and `cx` |
| `src/icons.ts`, `src/Icon.tsx` | The icon set's path data, generated from the artifact's `assets/Icons/icons.json` (design data, re-copied with the set), and the component that draws it |
| `src/tokens/tokens.json`, `src/tokens/source.json` | The artifact's token file byte for byte, and the artifact's url, the version copied and the date |
| `src/tokens/compile.ts`, `src/tokens/write.ts` | The compiler to `styles/tokens.css` by the artifact type's grammar, and the script `pnpm --filter @vetora/ui tokens` runs; `compile.test.ts` and `contrast.test.ts` beside them |
| `src/artifact/bundle.ts`, `sync.ts`, `write.ts` | A sync up's tools (ADR 0005, ticket #15): the builder of the artifact's `components/bundle.js` from the sources (esbuild; one classic script reading React 18 from `window`), the copy of the sources into a saved copy of the artifact with the bundle rebuilt there, and the script `pnpm --filter @vetora/ui artifact <folder>` runs; `bundle.test.ts` and `sync.test.ts` beside them |
| `styles/tokens.css`, `styles/components.css`, `styles/index.css` | The compiled tokens (committed, never edited by hand), the component stylesheet (the artifact's `bundle.css`, the repo's since ADR 0005), and the one entry stylesheet the web app imports in `src/main.tsx` |
| `fonts/Roboto-Variable.woff2` | The self hosted font, pointed at by the compiled `@font-face` |

## Commands

```bash
pnpm --filter @vetora/ui build       # tsc -p tsconfig.build.json to dist/ (tests left out); the web app imports dist
pnpm --filter @vetora/ui dev         # tsc --watch; pnpm dev at the root runs it beside the apps, so a component edit reaches the browser without a rebuild
pnpm --filter @vetora/ui tokens      # recompiles styles/tokens.css from src/tokens/tokens.json, after a re-copy
pnpm --filter @vetora/ui artifact <folder>   # a sync up: the sources into the saved copy of the artifact, its bundle.js rebuilt
pnpm --filter @vetora/ui typecheck
pnpm exec vitest run --project @vetora/ui   # at the root; pnpm test runs every workspace
```

## Conventions

- **Two directions (ADR 0005).** Design data comes down from the artifact by re-copy and is never edited here: `tokens.json` (then `pnpm --filter @vetora/ui tokens`), the font, `icons.ts`, and in the web app the logos and the favicon set; a colour, a size, a word, an icon or a page's order of parts is decided in the artifact. Component code goes up: a fix to `src/*.tsx`, a helper beside them, `src/index.ts` or `styles/components.css` is made here under the types, lint and tests, listed in `docs/design.md`'s ledger as pending, and published to the artifact by a sync up (`README.md`, "Two procedures"), which carries the files as they are and the `bundle.js` rebuilt from them, since the artifact's page never builds its sources. Nothing is copied down over the sources again.
- **Conformance of the sources**: the package builds on the Node module settings with the DOM libs and `react-jsx` (`tsconfig.json`), so relative imports carry `.js`; imports used only as types are `import type` (`verbatimModuleSyntax`); Biome's format and rules apply, except the eleven rules `biome.jsonc` turns off for `src/*.tsx` only (the components' ARIA composites, pointer scrims, effect dependencies, index keys and the table's `any`), which are the repo's to turn back on as each component is fixed; the test files keep every rule.
- **Every word is a prop**, passed translated from `packages/i18n`; the components hold no words of their own except English defaults that are always passed (`closeLabel`, `clearLabel`, `labels`).
- **The formatters are the display layer** (`docs/design.md`, "Formatters"): a stored amount in minor units reaches a screen only through `formatMinorUnits`, and `formatMoney` is never called with a stored amount (IN-4); `InvoiceTable` and `Receipt` still take manat numbers and are changed here, before the first invoice screen, to take minor units with a currency (`docs/design.md`, "Not yet"); a UTC instant becomes the practice's wall clock, with `date-fns` and `@date-fns/tz` once they are installed, before `formatDate` or `formatTime` sees it; a counted noun goes through `formatCount` with the forms object from the translation files; names sort with `compareText`.
- **The public surface** is the artifact's index at the fork point plus the repo's additions, both listed in `src/index.test.ts`: a new export is a repo change, added to `repoValues` there and to the ledger.
- **Tests**: a vendored component has no test of its own; it is proven where the web app composes it (`apps/clinic-web/src/app.test.tsx`, `src/pages/StatusPage.test.tsx`). A test lands here for the repo's own code (the compiler, the money wrapper, the sync up's bundle and copy in `src/artifact/`); when the repo changes a component's behaviour, the proof lands in the web app's DOM test where the component is composed, as the skip link's did, since this package has no DOM environment. A failing contrast pair is fixed in the artifact's tokens and re-copied (the colour is the decision); a component fault is fixed here.

## Gotchas

- `styles/tokens.css` is compiled: `compile.test.ts` fails when it is stale, so run `pnpm --filter @vetora/ui tokens` after `tokens.json` changes. Biome does not touch `tokens.json`, `tokens.css` or `components.css` (`biome.jsonc`): the first two are verbatim or generated, and the stylesheet is kept as published so a sync up carries it as is.
- `source.json`'s version is the data files' version and the sources' fork point, not the artifact's latest: the artifact moved to version 20 on 2026-10-26 with glossary rows, which become keys in `packages/i18n`, and to 22 the same day with the sources synced up (#15), neither a data file here. Move the version and the date when a data file is re-copied.
- `formatMinorUnits` throws for what is not a number or a bigint, a non integer amount, one above 2^46 manat (about 70 trillion, where a double can no longer hold the qəpik) and a currency the design system has no format for, where the design system's own formatters return `''` for bad input: deliberate, since a float reaching the display layer is a bug to surface (IN-4).
- The design system's formatters follow the root element's `lang` when no `locale` is given, and fall back to English where there is no document (the tests run in Node).
- `React` is a peer dependency, with `react-dom` for the portals of `Dialog`, `Drawer` and `PrintPreview`; the package has no other runtime dependency.
- The app uses none of the artifact's `bundle.js` (React 18.3.1, `window.Vetora`), `index.d.ts` and `lib/` (ADR 0003); the TSX sources are. The repo builds that `bundle.js` only for the canvas, at a sync up; esbuild is a dev dependency for it alone, and `dist/artifact/` is never imported. The bundle's tests run it on the repo's React 19; a change to how `bundle.ts` builds is checked on React 18.3.1 by rendering the artifact's previews with the old and the new bundle (`README.md`, step 2).
- The artifact's `components/src/` holds the sources byte for byte, so the Artifact tool sends them as `text/plain` (it serves no `.ts` or `.tsx` by extension); a publish's `file_path` must be a served file, such as `project/design-system.json` or `bundle.js`.

## Related specs

- [`docs/design.md`](../../docs/design.md): the design system as the code needs it, and the ledger
- ADR 0003 (the vendoring), ADR 0004 (the print sheets, rendered to PDF in the worker), ADR 0005 (the source of truth by kind); spec #9 (feature 4, a GitHub issue)
