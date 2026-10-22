# packages/config

## Overview

`@vetora/config`: the shared TypeScript configuration every workspace extends. Lint and format configuration lands here with scope feature 2 (`/develop tooling`).

## Key files

| File | Owns |
|---|---|
| `tsconfig.base.json` | `strict`, `verbatimModuleSyntax`, `moduleDetection: force`, `skipLibCheck` |
| `tsconfig.node.json` | Node packages and the API: ES2024, NodeNext, declarations and source maps emitted to `dist/` |
| `tsconfig.web.json` | The web app: ES2023 with DOM, bundler resolution, `react-jsx`, `noEmit` |

## Conventions

- A workspace extends one of the two leaf configs (`"extends": "@vetora/config/tsconfig.node.json"`) and sets only `rootDir`, `outDir`, `types`, and `include`.
- Strictness is decided here, once; a workspace may add a check (`noUnusedLocals`), never relax one.
- No scripts and no build: the package ships its JSON files as they are (`files: ["*.json"]`).

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
