import { defineConfig } from 'vitest/config'

// One test runner for the monorepo (scope feature 2): every workspace under apps/ and packages/ is a project,
// named after its package, and a workspace with no tests passes. Tests sit next to the code as *.test.ts and
// stay out of each package's build (tsconfig.build.json). Run `pnpm test` at the root.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
    passWithNoTests: true,
  },
})
