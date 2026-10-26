# @vetora/ui

The vetora design system as a workspace package (ADR 0003): the design system artifact's sources copied into the repo and compiled, linted, type checked and tested by the repo's own tools. Since ADR 0005 the component sources are the repo's and the design data stays the artifact's: a component fix is made here and published up, a token, word or icon change is made in the artifact and re-copied. `docs/design.md` records what the code needs from the artifact, where each piece lives, who decides each kind, and the ledger of the repo's changes to the sources.

- **Artifact**: the Design System artifact linked from `docs/specs/0001-stack-architecture/rationale.md`. `src/tokens/source.json` names its url, the version the data files were copied at and the sources forked from (`1792792882-428d`, 2026-10-24) and the date.
- **Tokens**: `src/tokens/tokens.json` is the artifact's file, byte for byte. `src/tokens/compile.ts` compiles it to `styles/tokens.css` by the artifact type's grammar (`artifact-type/reference/format.md`, "tokens.css as compiled"): colours and shadows under `:root, [data-theme="light"]`, the other families and `--font-sans` under `:root`, a class per type style, and the `@font-face` for Roboto. The output is committed; `pnpm --filter @vetora/ui tokens` rewrites it, and `src/tokens/compile.test.ts` fails when it is stale.
- **Stylesheet and font**: `styles/components.css` is the artifact's `components/bundle.css`, the repo's since ADR 0005; `styles/index.css` imports the tokens and then the components, and the web app imports it once (`apps/clinic-web/src/main.tsx`). `fonts/Roboto-Variable.woff2` is served from the package, so no font request leaves the origin.
- **Components**: `src/*.tsx` and the helpers beside them (`format.ts`, `dates.ts`, `appointment.ts`, `toasts.ts`, `modal.ts`, `util.ts`) are the artifact's `components/src/*` after the conformance pass the ledger describes, every file of it, and `src/icons.ts` is the icon set's path data (design data, re-copied with the set). `src/index.ts` exports what the artifact's index exported at the fork point, name for name (Biome orders the lines), the formatters and the print components (`PrintPreview`, `PrintSheet`, `Letterhead`, `PrintSection`, `SignatureBlock`, `Receipt`; rendered to PDF only by the worker, ADR 0004) included, plus the repo's additions since: `formatMinorUnits` (`src/money.ts`), the money wrapper that turns whole minor units with a currency into the design system's money format, the one place that divides money (IN-4). `src/index.test.ts` holds both lists. React and React DOM (the portals of `Dialog`, `Drawer` and `PrintPreview`) are the peer dependencies, and the only ones.
- **Tests** (spec #9, seam 2): `src/tokens/compile.test.ts` proves `tokens.css` fresh and every variable the stylesheet reads defined; `src/tokens/contrast.test.ts` computes WCAG 2 contrast from relative luminance over `tokens.json` for every text and ground pair the brand book names, 4.5:1 for text and 3:1 for controls and chart series; `src/money.test.ts` proves the money wrapper's formats, sign, zero, `bigint` and refusals. A failing contrast pair is fixed in the artifact's tokens and re-copied, never dropped: the colour is the decision; a component fault is fixed in the repo (ADR 0005). A vendored component has no test of its own: it is proven where the web app composes it (the status page's DOM test and the shell's, `apps/clinic-web/src/app.test.tsx`).

## Commands

```bash
pnpm --filter @vetora/ui build              # tsc -p tsconfig.build.json to dist/ (tests left out); the web app imports dist
pnpm --filter @vetora/ui dev                # tsc --watch; pnpm dev at the root runs it beside the apps
pnpm --filter @vetora/ui tokens             # recompiles styles/tokens.css from src/tokens/tokens.json
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

A change to `src/*.tsx`, a helper beside them, `src/index.ts` or `styles/components.css` is made here, reviewed here, and listed in `docs/design.md`'s ledger as pending, with the ticket and the date. The sync up is `/design-sync` once it targets design system artifacts; on 2026-10-26 the DesignSync tool and the `claude_design` server still address the standalone claude.ai/design store, which lists no vetora system, so until then the Artifact tool does it, as `project/glossary.md` was published on 2026-10-24 and 2026-10-26: read the artifact by its url (a publish without that read is refused), write the changed files into the saved copy under `project/components/src/` and `project/components/bundle.css`, publish with `url`, `root` set to the saved artifact folder and `file_path` to one changed file, the others in `files` by their `project/…` paths, and send `project/design-system.json` only when its keys change. Then record the date and the new artifact version against each change in the ledger.

The first sync up, ticket #15, settles what the ledger leaves open: the artifact's bundler reads `./util` without `.js` and its sources keep semicolons, so either the sync strips the repo's suffixes and format on the way up or the artifact takes them; and whether the canvas rebuilds `bundle.js` from the published sources, or rebuilding it is a step of the sync.

## The repo's changes to the sources

Every change since the fork point, mechanical or not, with whether it has reached the artifact, is the ledger in `docs/design.md`.
