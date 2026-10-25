# @vetora/ui

The vetora design system as a workspace package (ADR 0003): the design system artifact's sources copied into the repo and compiled, linted, type checked and tested by the repo's own tools. The artifact stays the source of truth for visuals and words; `docs/design.md` (ticket #13) will record what the code needs from it, where each piece lives, and every divergence.

- **Artifact**: the Design System artifact linked from `docs/specs/0001-stack-architecture/rationale.md`. `src/tokens/source.json` names its url, the version copied (`1792792882-428d`) and the date.
- **Tokens**: `src/tokens/tokens.json` is the artifact's file, byte for byte. `src/tokens/compile.ts` compiles it to `styles/tokens.css` by the artifact type's grammar (`artifact-type/reference/format.md`, "tokens.css as compiled"): colours and shadows under `:root, [data-theme="light"]`, the other families and `--font-sans` under `:root`, a class per type style, and the `@font-face` for Roboto. The output is committed; `pnpm --filter @vetora/ui tokens` rewrites it, and `src/tokens/compile.test.ts` fails when it is stale.
- **Stylesheet and font**: `styles/components.css` is the artifact's `components/bundle.css` as published; `styles/index.css` imports the tokens and then the components, and the web app imports it once (`apps/clinic-web/src/main.tsx`). `fonts/Roboto-Variable.woff2` is served from the package, so no font request leaves the origin.
- **Components**: `src/*.tsx` and the helpers beside them (`format.ts`, `dates.ts`, `appointment.ts`, `toasts.ts`, `modal.ts`, `util.ts`, the icon path data in `icons.ts`) are the artifact's `components/src/*` after the conformance pass below, every file of it. `src/index.ts` exports what the artifact's index exports, name for name (Biome orders the lines), the formatters and the print components (`PrintPreview`, `PrintSheet`, `Letterhead`, `PrintSection`, `SignatureBlock`, `Receipt`; rendered to PDF only by the worker, ADR 0004) included; `src/index.test.ts` holds the list. React and React DOM (the portals of `Dialog`, `Drawer` and `PrintPreview`) are the peer dependencies, and the only ones.
- **Tests** (spec #9, seam 2): `src/tokens/compile.test.ts` proves `tokens.css` fresh and every variable the stylesheet reads defined; `src/tokens/contrast.test.ts` computes WCAG 2 contrast from relative luminance over `tokens.json` for every text and ground pair the brand book names, 4.5:1 for text and 3:1 for controls and chart series. A pair that fails is fixed in the artifact first and re-copied, never dropped. A vendored component has no test of its own: it is proven where the web app composes it (the status page's DOM test and the shell's, `apps/clinic-web/src/app.test.tsx`).

## Commands

```bash
pnpm --filter @vetora/ui build              # tsc -p tsconfig.build.json to dist/ (tests left out); the web app imports dist
pnpm --filter @vetora/ui dev                # tsc --watch; pnpm dev at the root runs it beside the apps
pnpm --filter @vetora/ui tokens             # recompiles styles/tokens.css from src/tokens/tokens.json
pnpm exec vitest run --project @vetora/ui   # at the root; pnpm test runs every workspace
```

## Re-copying from the artifact

A visual change is made in the artifact first and reaches the repo as a deliberate re-copy, never the reverse. Read the files with the Artifact tool, overwrite `tokens.json`, `components.css`, the font and the sources, put `.js` on the sources' relative imports, run `pnpm --filter @vetora/ui tokens`, then the conformance pass: `pnpm lint:fix` (format, import order, `import type`) and the unsafe fixes of the rules the pass covers,

```bash
pnpm exec biome check --write --unsafe --only=style/useTemplate --only=complexity/useOptionalChain --only=suspicious/noGlobalIsFinite --only=suspicious/noGlobalIsNan --only=correctness/noUnusedImports --only=correctness/noUnusedVariables --only=correctness/noUnusedFunctionParameters packages/ui/src
```

then put back the hand changes listed below that `pnpm typecheck` and `pnpm lint` still ask for, check the diff against the list, and update `source.json`'s version and date.

## Divergences from the artifact

Code only changes, kept to what the repo's tools require, with no behaviour changed (gathered into `docs/design.md` by #13):

- The package builds on the Node module settings with the DOM libs and React's JSX transform (`tsconfig.json`), so its output runs in Vite today and in the API's worker later (ADR 0004): relative imports carry `.js`.
- Imports used only as types are `import type` (`verbatimModuleSyntax`); `Icon`, `LabResults` and `Skeleton` drop their unused `React` namespace imports, which the JSX runtime does not need.
- Biome's format (no semicolons, single quotes, lines wrapped at 120) and the fixes of the rules the pass covers: class names and ids built with template literals (`useTemplate`), `a && a.b` and `cb && cb(x)` written `a?.b` and `cb?.(x)` (`useOptionalChain`), `Number.isFinite` and `Number.isNaN` for the globals (their coercion of non-numbers is the one difference, unreachable under the declared `number` and `Date` types), and unused catch bindings and callback parameters renamed with an underscore.
- React 19 types: `useOutside` (`Field.tsx`), `useWidth` (`Charts.tsx`) and the date picker's `close` take a `React.RefObject<HTMLElement | null>`, the type `useRef(null)` now has; `Menu` and `Tooltip` read the element they clone through a cast to its ARIA and `onClick` props, since React 19 types an element's props as `unknown`.
- Three rewrites with the same effect, for rules the artifact's code genuinely trips and that have no automatic fix: the time picker's clock button handler is a block instead of a comma expression (`noCommaOperator`); `emit` in `toasts.ts` and the schedule's lane `close` loop with `for … of` instead of a `forEach` whose callback returned a value (`useIterableCallbackReturn`).
- `biome.jsonc` turns eleven rules off for `packages/ui/src/*.tsx` only: `noArrayIndexKey`, `noExplicitAny`, `useExhaustiveDependencies`, and the a11y rules `noAriaHiddenOnFocusable`, `noNoninteractiveElementToInteractiveRole`, `noNoninteractiveTabindex`, `noStaticElementInteractions`, `useAriaPropsForRole`, `useFocusableInteractive`, `useKeyWithClickEvents` and `useSemanticElements`. Each reads a pattern the artifact uses on purpose as a fault: a listbox under a combobox input, the calendar grid, scrims and popup anchors listening for the pointer, the switch as a native checkbox, effects that list the dependencies they mean to react to, lists keyed by position, the table's generic row. They are false positives, so they are off in the config rather than suppressed in the files, and a re-copy stays mechanical; the package's own test files keep every rule. The components' accessibility is proven where the app composes them (the axe check of ticket #12) and, since ADR 0005, fixed here.
- `tokens.css` is compiled here; the artifact publishes none. The compiler handles the one theme the artifact has and fails loudly on a second theme, an alias to a missing colour or an unknown font format, where the artifact's page would drop the value silently.
- The artifact's `bundle.js` (React 18.3.1, `window.Vetora`) and `index.d.ts` are not used.

## The repo's changes to the sources (ADR 0005)

From the commit that closed #11 the sources are the repo's: a fix is made here and carried to the artifact by a sync up (`docs/design.md`, ticket #13, becomes the ledger with the date each change reached the artifact). Until then this list is it:

- `AppShell` (`Layout.tsx`, ticket #12, 2026-10-26): the skip link focuses the page itself when it is activated (`preventDefault`, then `main.focus()`) instead of leaving the jump to the browser's fragment navigation, which jsdom does not perform and browsers perform unevenly. Not yet in the artifact's `components/src/Layout.tsx`.
