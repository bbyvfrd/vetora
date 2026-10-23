---
status: accepted
date: 2026-10-24
---

# The web app vendors the design system's source into `packages/ui`

The vetora design system is a Claude Design System artifact (link in spec 0001's `rationale.md`): the tokens, the Roboto variable font, 121 Material Symbols icons, about forty React components as TypeScript source beside a classic script bundle built against React 18.3.1 for `window.Vetora`, seven page and five document examples in HTML, and the glossary, voice, messages and formats in Azerbaijani, Russian and English. Spec 0001's UI kit row left one decision to the design system feature: how the web app consumes it. We copy the component sources, the stylesheet, `tokens.json`, the font and the icons into a new workspace package, `packages/ui` (`@vetora/ui`), compiled by the repo's TypeScript to `dist/` like `contracts` and `i18n`, linted by Biome and tested by Vitest, on the app's own React 19; the package build compiles `tokens.css` from `tokens.json` by the artifact type's documented grammar and writes the `@font-face` for the self hosted font. The artifact stays the source of truth for visuals and words: the copy records the artifact version it came from in `docs/design.md`, a visual change is made in the artifact first and reaches the repo as a deliberate re-copy ticket, never the reverse, code only changes (type conformance, React 19 types, routing glue) live in the repo and are listed in `design.md`'s divergence section, and UI words flow from the design system glossary into `packages/i18n`.

## Considered options

- **Load the bundle** (`window.Vetora`): a second React (18 beside the app's 19) or a downgrade, types that the artifact's own documentation says are not type checked, no tree shaking, and a global object in a typed app.
- **Rebuild the components by hand** on a generic kit: the design exists and is already three languages deep; a rebuild spends the work twice and drifts from the artifact from day one.
- **Vendor the source and export it unbuilt** (the consumer's bundler compiles it): fine for Vite, but the API's worker will import the print components for the stored PDFs (ADR 0004) and Node runs no JSX, so every consumer would need its own compile step.
- **Vendor the source into a compiled package** (chosen): one shape for every consumer, the repo's own toolchain on the code, and a recorded relationship to the artifact.

## Consequences

- A conformance pass on the copied files: type only imports (`verbatimModuleSyntax`), Biome's formatting, React 19 types; it is part of the vendoring ticket, not a reason to fork the design.
- `packages/ui` gets a `dev` script that watches and rebuilds, so `pnpm dev` picks up component edits without the manual rebuild the other packages need.
- Spec 0001's UI kit row ("how the web app consumes it is chosen by the design system spec") is resolved by this record; the Clinic web app row is unchanged.
- A later owner app (React Native) cannot use these DOM components; it may share `tokens.json`, the formatters and the icon paths from the same package.
