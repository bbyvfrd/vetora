# @vetora/ui

The vetora design system as a workspace package (ADR 0003): the design system artifact's sources copied into the repo and compiled, linted, type checked and tested by the repo's own tools. Since ADR 0005 the component sources are the repo's and the design data stays the artifact's: a component fix is made here and published up, a token, word or icon change is made in the artifact and re-copied. `docs/design.md` records what the code needs from the artifact, where each piece lives, who decides each kind, and the ledger of the repo's changes to the sources.

- **Artifact**: the Design System artifact linked from `docs/specs/0001-stack-architecture/rationale.md`. `src/tokens/source.json` names its url, the version the data files were copied at and the sources forked from (`1792792882-428d`, 2026-10-24) and the date.
- **Tokens**: `src/tokens/tokens.json` is the artifact's file, byte for byte. `src/tokens/compile.ts` compiles it to `styles/tokens.css` by the artifact type's grammar (`artifact-type/reference/format.md`, "tokens.css as compiled"): colours and shadows under `:root, [data-theme="light"]`, the other families and `--font-sans` under `:root`, a class per type style, and the `@font-face` for Roboto. The output is committed; `pnpm --filter @vetora/ui tokens` rewrites it, and `src/tokens/compile.test.ts` fails when it is stale.
- **Stylesheet and font**: `styles/components.css` is the artifact's `components/bundle.css`, the repo's since ADR 0005; `styles/index.css` imports the tokens and then the components, and the web app imports it once (`apps/clinic-web/src/main.tsx`). `fonts/Roboto-Variable.woff2` is served from the package, so no font request leaves the origin.
- **Components**: `src/*.tsx` and the helpers beside them (`format.ts`, `dates.ts`, `appointment.ts`, `toasts.ts`, `modal.ts`, `util.ts`) are the artifact's `components/src/*` after the conformance pass the ledger describes, every file of it, and `src/icons.ts` is the icon set's path data (design data, re-copied with the set). `src/index.ts` exports what the artifact's index exported at the fork point, name for name (Biome orders the lines), the formatters and the print components (`PrintPreview`, `PrintSheet`, `Letterhead`, `PrintSection`, `SignatureBlock`, `Receipt`; rendered to PDF only by the worker, ADR 0004) included, plus the repo's additions since: `formatMinorUnits` (`src/money.ts`), the money wrapper that turns whole minor units with a currency into the design system's money format, the one place that divides money (IN-4). `src/index.test.ts` holds both lists. React and React DOM (the portals of `Dialog`, `Drawer` and `PrintPreview`) are the peer dependencies, and the only ones.
- **Tests** (spec #9, seam 2): `src/tokens/compile.test.ts` proves `tokens.css` fresh and every variable the stylesheet reads defined; `src/tokens/contrast.test.ts` computes WCAG 2 contrast from relative luminance over `tokens.json` for every text and ground pair the brand book names, 4.5:1 for text and 3:1 for controls and chart series; `src/money.test.ts` proves the money wrapper's formats, sign, zero, `bigint` and refusals; `src/artifact/bundle.test.ts` and `sync.test.ts` prove the sync up's bundle and copy ("Publishing changed sources up to the artifact"). A failing contrast pair is fixed in the artifact's tokens and re-copied, never dropped: the colour is the decision; a component fault is fixed in the repo (ADR 0005). A vendored component has no test of its own: it is proven where the web app composes it (the status page's DOM test and the shell's, `apps/clinic-web/src/app.test.tsx`).

## Commands

```bash
pnpm --filter @vetora/ui build              # tsc -p tsconfig.build.json to dist/ (tests left out); the web app imports dist
pnpm --filter @vetora/ui dev                # tsc --watch; pnpm dev at the root runs it beside the apps
pnpm --filter @vetora/ui tokens             # recompiles styles/tokens.css from src/tokens/tokens.json
pnpm --filter @vetora/ui artifact <folder>  # a sync up: the sources into a saved copy of the artifact, bundle.js rebuilt
pnpm exec vitest run --project @vetora/ui   # at the root; pnpm test runs every workspace
```

## Two procedures (ADR 0005)

### Re-copying the design data from the artifact

A token, icon, font or example change is made in the artifact first and comes down as a deliberate re-copy. These files are data, so there is no conformance pass. With the Artifact tool, read the artifact by its url, then its files (`scope: "files"` lists them; a file under about 12 KB comes back inline, a larger one is saved to the scratchpad), and overwrite:

- `src/tokens/tokens.json` with `project/tokens.json`, then `pnpm --filter @vetora/ui tokens`;
- `fonts/Roboto-Variable.woff2` with `project/fonts/Roboto-Variable.woff2`;
- `src/icons.ts` with `project/components/src/icons.ts`, then `pnpm lint:fix`, which only formats it (the artifact's `assets/Icons/README.md` holds the meanings; one meaning, one icon);
- in the web app, the logos (`apps/clinic-web/src/assets/`) and the favicon set (`apps/clinic-web/public/`) from the asset store, one asset per `read` with `path` set to its id (the ids are under `assetGroups` in `project/design-system.json`).

Then `pnpm test` (the freshness test and the contrast pairs) and set `source.json`'s version and date to the artifact's. A pair that fails after a token change is a finding for the artifact, not a reason to lower the threshold. The brand book, the glossary, voice, messages and formats, and the page and document examples are read in the artifact and never copied; a word reaches the repo as translation keys (`docs/design.md`, "Words").

### Publishing changed sources up to the artifact

A change to `src/*.tsx`, a helper beside them, `src/index.ts` or `styles/components.css` is made here, reviewed here, and listed in `docs/design.md`'s ledger as pending, with the ticket and the date. The artifact takes the repo's files as they are, `.js` suffixes and Biome's format included, and nothing in it builds them: when ticket #15 published the sources alone, the artifact's `bundle.js` stayed byte for byte as it was. So a sync up publishes the changed files with the `bundle.js` the repo rebuilds from them (its esbuild reads the `.js` suffixes). `/design-sync` would do it once it targets design system artifacts; on 2026-10-26 the DesignSync tool still addresses the standalone claude.ai/design store, which lists no vetora system, so the Artifact tool does it:

1. Read the artifact by its url (a publish without that read is refused), then, with `paths`, `project/components/bundle.js` (its first line is the page's catalogue, which the rebuilt bundle keeps) and `project/components/src/icons.ts` (the icon data, the artifact's, which the bundle is built with). They are saved under the artifact's folder in the scratchpad.
2. `pnpm --filter @vetora/ui artifact <that folder>` copies every source (each `src/*.ts` and `*.tsx` but the tests and `icons.ts`) into the folder's `project/components/src/`, rebuilds its `project/components/bundle.js` from them (`src/artifact/sync.ts` and `bundle.ts`: one minified classic script that reads React 18 from `window` and assigns `window.Vetora`, under the old header), and prints the `files` to publish, with any file the repo no longer has. A new component goes into the header by hand; the build refuses a header that names a component the sources lack. When `bundle.ts` changes how it builds, render the artifact's previews on its React 18.3.1 with the old and the new bundle before publishing, as #15 did.
3. When an export or a prop changed, edit the folder's `project/components/index.d.ts` by hand: it is the documentation the page reads props from (#15 added `formatMinorUnits`). A changed `styles/components.css` is copied over `project/components/bundle.css`.
4. Read `project/design-system.json` again, set its `lastChange` (`by`, `at`, `via` "Claude Code · bbyvfrd/vetora@<commit>" with the commit the sources were taken from, a one line `note` naming the ticket), and publish once: `url`, `root` set to the folder, `file_path` the index's absolute path, `files` what step 2 printed plus `index.d.ts` (`contentType` `text/plain`) or `bundle.css` when they changed.
5. Read back what was sent into a separate folder (`out_dir`, so the saved copy is not overwritten; each file's sha256 is in the read's result) and `diff -r` its `project/components/src/` against `src/`, open the canvas on the previews the change touches, and record the version and the date against each ledger row.

## The repo's changes to the sources

None is pending: the first sync up (#15, 2026-10-26) took every change since the fork point to the artifact's version 22, and the second (2026-10-27) took those of #19, #22, #23 and #25 to version 32. Each change, mechanical or not, with the version and date it reached the artifact, is the ledger in `docs/design.md`.
