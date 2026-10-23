import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The order check of a migration set, the second half of `db:check` (src/check-migrations.ts), run in CI and by hand
 * before a push (spec 0001, "Migrations": CI rejects migration files out of order; ADR 0002 records why it reads git).
 * Drizzle 1.0 applies every folder of a set whose name is not recorded in <schema>.__drizzle_migrations, in name order
 * (its getMigrationsToRun), so a folder that lands on the branch with an older timestamp than one already there runs
 * first on a fresh schema (provision-practice) and last on a migrated one: one set, two orders, and a migration that
 * builds on an earlier one fails on one of them. The check sorts the folders by the first-parent commit that brought
 * each to the current branch (a folder merged in counts when the merge lands, not when the branch wrote it), names
 * deciding within one commit and folders not committed yet last, as the newest, and refuses a folder that sorts before
 * one that landed earlier. drizzle-kit check runs first in `db:check`: it refuses a generated folder whose snapshot
 * sorts before its parent and two folders generated from one snapshot, and knows nothing of a folder without a
 * snapshot, which a hand written migration or a test fixture is.
 */

/** How drizzle-kit names a migration folder: a UTC timestamp to the second, an underscore, the name given to generate. */
const FOLDER_NAME = /^\d{14}_[\w-]+$/

/** A folder of a migration set as drizzle-kit lays it out: <yyyymmddhhmmss>_<name>/migration.sql. */
export type MigrationFolder = {
  name: string
  /** Whether the folder holds a migration.sql: Drizzle's readMigrationFiles skips a folder without one. */
  hasSql: boolean
}

/** The folders of a set, in name order, how Drizzle reads it. */
export function readMigrationSet(folder: string): MigrationFolder[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, hasSql: existsSync(join(folder, entry.name, 'migration.sql')) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * When each folder of the set landed on the current branch: the committer time, in seconds, of the first-parent
 * commit that added its first file, so a folder merged in is dated by the merge; a folder not committed yet is absent.
 * Read from `git log` of the set folder. A shallow clone is refused rather than read, since it would date every folder
 * it cannot see alike and pass the check by accident: CI checks out the full history (.github/workflows/ci.yml,
 * fetch-depth 0).
 */
export function committedAt(folder: string): Map<string, number> {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, encoding: 'utf8' })
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    throw new Error(
      `${folder} is in a shallow clone, which hides when its migrations were committed: fetch the full history (CI checks out with fetch-depth 0)`,
    )
  }
  const log = git('log', '--first-parent', '--diff-filter=A', '--name-only', '--format=%ct', '--relative', '--', '.')
  const committed = new Map<string, number>()
  let at: number | undefined
  for (const line of log.split('\n')) {
    if (/^\d+$/.test(line)) {
      at = Number(line)
      continue
    }
    // A path relative to the set folder: the migration folder is its first segment.
    const [name] = line.split('/')
    if (at === undefined || !name || !line.includes('/')) continue
    const seen = committed.get(name)
    if (seen === undefined || at < seen) committed.set(name, at)
  }
  return committed
}

/** Every problem with the set, empty when it is in order; `committed` is what committedAt() read for it. */
export function migrationOrderProblems(
  set: readonly MigrationFolder[],
  committed: ReadonlyMap<string, number>,
): string[] {
  const problems: string[] = []
  const named: MigrationFolder[] = []
  for (const folder of set) {
    if (!folder.hasSql) problems.push(`folder "${folder.name}" has no migration.sql, so Drizzle would ignore it`)
    if (!FOLDER_NAME.test(folder.name)) {
      problems.push(
        `folder "${folder.name}" is not named <yyyymmddhhmmss>_<name>, as drizzle-kit generate names a migration`,
      )
      continue
    }
    named.push(folder)
  }
  // The order the folders landed: by commit, then by name; a folder not committed yet comes last.
  const inCommitOrder = [...named].sort(
    (a, b) =>
      (committed.get(a.name) ?? Number.POSITIVE_INFINITY) - (committed.get(b.name) ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  )
  let newest: MigrationFolder | undefined
  for (const folder of inCommitOrder) {
    if (newest && folder.name.localeCompare(newest.name) < 0) {
      problems.push(
        `migration "${folder.name}" is out of order: it sorts before "${newest.name}", which was committed earlier, so a fresh schema would run it first and a migrated one last; generate it again so its timestamp is newer than every committed migration`,
      )
      continue
    }
    newest = folder
  }
  return problems
}

/** The problems of the set in `folder`, read from disk and from git: what `db:check` runs for each set. */
export function migrationSetProblems(folder: string): string[] {
  return migrationOrderProblems(readMigrationSet(folder), committedAt(folder))
}
