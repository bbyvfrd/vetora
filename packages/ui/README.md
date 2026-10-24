# @vetora/ui

The vetora design system as a workspace package (ADR 0003): the design system artifact's sources copied into the repo and compiled, linted, type checked and tested by the repo's own tools. The artifact stays the source of truth for visuals and words; `docs/design.md` (ticket #13) will record what the code needs from it, where each piece lives, and every divergence.

- **Artifact**: the Design System artifact linked from `docs/specs/0001-stack-architecture/rationale.md`. `src/tokens/source.json` names its url, the version copied (`1792792882-428d`) and the date.
- **Tokens**: `src/tokens/tokens.json` is the artifact's file, byte for byte. `src/tokens/compile.ts` compiles it to `styles/tokens.css` by the artifact type's grammar (`artifact-type/reference/format.md`, "tokens.css as compiled"): colours and shadows under `:root, [data-theme="light"]`, the other families and `--font-sans` under `:root`, a class per type style, and the `@font-face` for Roboto. The output is committed; `pnpm --filter @vetora/ui tokens` rewrites it, and `src/tokens/compile.test.ts` fails when it is stale.
- **Stylesheet and font**: `styles/components.css` is the artifact's `components/bundle.css` as published; `styles/index.css` imports the tokens and then the components, and the web app imports it once (`apps/clinic-web/src/main.tsx`). `fonts/Roboto-Variable.woff2` is served from the package, so no font request leaves the origin.
- **Components**: `src/*.tsx` are the artifact's `components/src/*` after the conformance pass below. Ticket #10 vendors `Icon`, `Button`, the icon path data (`icons.ts`) and `util.ts`; #11 brings the rest, in the artifact index's order.

## Commands

```bash
pnpm --filter @vetora/ui build              # tsc -p tsconfig.build.json to dist/ (tests left out); the web app imports dist
pnpm --filter @vetora/ui dev                # tsc --watch; pnpm dev at the root runs it beside the apps
pnpm --filter @vetora/ui tokens             # recompiles styles/tokens.css from src/tokens/tokens.json
pnpm exec vitest run --project @vetora/ui   # at the root; pnpm test runs every workspace
```

## Re-copying from the artifact

A visual change is made in the artifact first and reaches the repo as a deliberate re-copy, never the reverse. Read the files with the Artifact tool, overwrite `tokens.json`, `components.css`, the font and the sources, run `pnpm --filter @vetora/ui tokens`, then `pnpm lint:fix` and `pnpm exec biome check --write --unsafe packages/ui/src` for the conformance pass, check the diff against the list below, and update `source.json`'s version and date.

## Divergences from the artifact

Code only changes, kept to what the repo's tools require (gathered into `docs/design.md` by #13):

- The package builds on the Node module settings with the DOM libs and React's JSX transform (`tsconfig.json`), so its output runs in Vite today and in the API's worker later (ADR 0004): relative imports carry `.js`.
- Imports used only as types are `import type` (`verbatimModuleSyntax`), and `Icon.tsx` drops its unused `React` import, which the JSX runtime does not need.
- Biome's format (no semicolons, single quotes, lines wrapped at 120) and its `useTemplate` rule: the class name concatenations in `Button` and `Icon` are template literals. The behaviour is the same.
- `tokens.css` is compiled here; the artifact publishes none. The compiler handles the one theme the artifact has and fails loudly on a second theme, an alias to a missing colour or an unknown font format, where the artifact's page would drop the value silently.
- The artifact's `bundle.js` (React 18.3.1, `window.Vetora`) and `index.d.ts` are not used.
