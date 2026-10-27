import { defineConfig } from 'vitest/config'

// One test runner for the monorepo (scope feature 2): every workspace under apps/ and packages/ is a project,
// named after its package, and a workspace with no tests passes. Tests sit next to the code as *.test.ts and
// stay out of each package's build (tsconfig.build.json). infra/ is no workspace: its scripts are tested in a project
// of their own (the worktree sweep builds scratch repositories, so it gets a long timeout). Run `pnpm test` at the root.
export default defineConfig({
  test: {
    projects: [
      'apps/*',
      'packages/*',
      { test: { name: 'infra', include: ['infra/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 } },
    ],
    passWithNoTests: true,
  },
})
