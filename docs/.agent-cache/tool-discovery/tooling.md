# Tool discovery: Biome, lefthook, Vitest (scope feature 2)
Cached: 2026-10-22 · found with `npx skills find` by a read only helper; reuse while under 30 days old.

## Biome 2.6
- `bobmatnyc/claude-mpm-skills` (biome), about 925 installs, community: general Biome lint and format guidance.
- `haydenbleasel/ultracite`, about 10.7K installs, community: a zero config preset whose init replaces an existing Biome config; not a fit for this repo's own `biome.jsonc`.
- `biomejs/biome` (official): 11 skills for developing Biome itself, none for project users.
- `paulrberg/agent-skills` (biome-js): listed in the registry but absent from the repo; stale.

## lefthook 2.2
- `fandhe-ai/agent-reference-skills` (lefthook), about 1.1K installs, community (description in Japanese): config, hook types, glob and tag filters, staged files, Husky migration.
- `aaronflorey/agent-skills` (lefthook), 9 installs, community: writing and debugging lefthook.yml.
- `evilmartians/lefthook` (official): no skills.

## Vitest 5
- `antfu/skills` (vitest), about 42.6K installs, by Anthony Fu of the Vitest team, the same repo as the installed `vite` skill: tests, mocks, coverage, filtering, fixtures. Best fit.
- `pproenca/dot-skills` (vitest), about 5.9K: setup, `vi.*` mocks, snapshots, performance.
- `sentimony/skills` (vitest), about 2.5K: workspaces, coverage, CI parity, Jest migration.
- `jezweb/claude-skills` (vitest), about 1.7K: generates a config and workspace setup.
- `wshobson/agents` (javascript-testing-patterns), about 20.4K: general testing patterns, not Vitest specific.
- Rejected: `vitest-dev/vitest` ships only an unrelated typo checker; `supabase/supabase` (vitest) targets Supabase's own monorepo.

## MCP servers
None obvious for any of the three; context7 (connected in the Claude app) already covers their docs.
