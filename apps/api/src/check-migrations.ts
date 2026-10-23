import { migrationSetProblems } from './platform/db/migration-order.js'
import { CONTROL_MIGRATIONS_FOLDER, PRACTICE_MIGRATIONS_FOLDER } from './platform/db/migrator.js'

/**
 * The second half of `db:check` (package.json): after drizzle-kit check has looked at both sets' snapshots, refuse a
 * migration folder out of order in either set (spec 0001, "Migrations"; src/platform/db/migration-order.ts says why
 * and how). Run in CI and by hand before a push, `pnpm --filter @vetora/api db:check`; a developer tool, so it prints
 * to the terminal rather than the JSON log. Exit codes: 0 both sets in order, 1 a problem in either, one per line.
 */
const sets = [
  ['control', CONTROL_MIGRATIONS_FOLDER],
  ['practice', PRACTICE_MIGRATIONS_FOLDER],
] as const

let problemCount = 0
for (const [set, folder] of sets) {
  const problems = migrationSetProblems(folder)
  for (const problem of problems) console.error(`${set}: ${problem}`)
  if (problems.length === 0) console.log(`${set}: in order`)
  problemCount += problems.length
}
process.exitCode = problemCount === 0 ? 0 : 1
