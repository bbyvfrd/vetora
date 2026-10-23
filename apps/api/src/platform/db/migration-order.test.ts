import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  committedAt,
  type MigrationFolder,
  migrationOrderProblems,
  migrationSetProblems,
  readMigrationSet,
} from './migration-order.js'
import { CONTROL_MIGRATIONS_FOLDER, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { controlSet, practiceSet, withExtraMigration } from './test-support.js'

/** The problem the check reports for `name` sorting before `newest`, a folder that landed earlier. */
const outOfOrder = (name: string, newest: string) =>
  expect.stringMatching(new RegExp(`^migration "${name}" is out of order: it sorts before "${newest}", which `))

describe('the migration order check (spec 0001, Migrations: CI rejects migration files out of order)', () => {
  it('passes both committed sets, reading from git when each folder landed; a folder generated and not committed yet is on disk alone', () => {
    for (const [folder, names] of [
      [CONTROL_MIGRATIONS_FOLDER, controlSet()],
      [PRACTICE_MIGRATIONS_FOLDER, practiceSet()],
    ] as const) {
      expect(readMigrationSet(folder)).toEqual(names.map((name) => ({ name, hasSql: true })))
      const committed = committedAt(folder)
      expect(names).toEqual(expect.arrayContaining([...committed.keys()]))
      // Committer times in seconds, all after the repository's first commit.
      for (const at of committed.values()) expect(at).toBeGreaterThan(Date.UTC(2026, 9, 1) / 1000)
      expect(migrationSetProblems(folder)).toEqual([])
    }
  })

  it('refuses a temporary folder named with an older timestamp than a committed migration, and takes one named newer', () => {
    const committed = committedAt(PRACTICE_MIGRATIONS_FOLDER)
    const newest = practiceSet().at(-1) ?? ''
    const late = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, '20261023000000_late', 'select 1;\n')
    const newer = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, '20991231235959_newer', 'select 1;\n')
    try {
      expect(migrationOrderProblems(readMigrationSet(late), committed)).toEqual([
        `migration "20261023000000_late" is out of order: it sorts before "${newest}", which was committed earlier, so a fresh schema would run it first and a migrated one last; generate it again so its timestamp is newer than every committed migration`,
      ])
      expect(migrationOrderProblems(readMigrationSet(newer), committed)).toEqual([])
    } finally {
      rmSync(late, { recursive: true, force: true })
      rmSync(newer, { recursive: true, force: true })
    }
  })

  it('orders folders by the commit that added them, names deciding within one commit, uncommitted folders last', () => {
    const folder = (name: string): MigrationFolder => ({ name, hasSql: true })
    const [a, b, c] = ['20260101000000_a', '20260102000000_b', '20260103000000_c']
    const set = [folder(a), folder(b), folder(c)]

    // Committed in name order, b and c in one commit: in order.
    expect(
      migrationOrderProblems(
        set,
        new Map([
          [a, 1],
          [b, 2],
          [c, 2],
        ]),
      ),
    ).toEqual([])
    // c committed before b: b is out of order.
    expect(
      migrationOrderProblems(
        set,
        new Map([
          [a, 1],
          [c, 2],
          [b, 3],
        ]),
      ),
    ).toEqual([outOfOrder(b, c)])
    // a not committed yet while b and c are: a is out of order.
    expect(
      migrationOrderProblems(
        set,
        new Map([
          [b, 2],
          [c, 3],
        ]),
      ),
    ).toEqual([outOfOrder(a, c)])
    // Nothing committed yet (a set copied for a test): name order is the only order.
    expect(migrationOrderProblems(set, new Map())).toEqual([])
  })

  it('names a folder without a migration.sql, which Drizzle would ignore, and one not named as drizzle-kit names them', () => {
    const set: MigrationFolder[] = [
      { name: '20260101000000_a', hasSql: true },
      { name: '20260102000000_empty', hasSql: false },
      { name: 'notes', hasSql: true },
    ]

    expect(migrationOrderProblems(set, new Map())).toEqual([
      'folder "20260102000000_empty" has no migration.sql, so Drizzle would ignore it',
      'folder "notes" is not named <yyyymmddhhmmss>_<name>, as drizzle-kit generate names a migration',
    ])
  })

  it('dates a folder by the first-parent commit that landed it, so a merge of an older folder is caught, and refuses a shallow clone', () => {
    // A repository with its migration set in a subfolder, as apps/api/drizzle/<set> sits in this one.
    const repo = mkdtempSync(join(tmpdir(), 'vetora-order-'))
    const set = join(repo, 'drizzle')
    mkdirSync(set)
    const at = (second: number) => `2026-01-01T00:00:0${second}Z`
    const git = (date: string, ...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
        { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } },
      )
    const commitMigration = (name: string, date: string) => {
      mkdirSync(join(set, name))
      writeFileSync(join(set, name, 'migration.sql'), 'select 1;\n')
      git(date, 'add', '-A')
      git(date, 'commit', '-q', '-m', name)
    }
    try {
      git(at(0), 'init', '-q', '-b', 'main')
      commitMigration('20260101000000_a', at(0))
      // b is written on a branch before c reaches main, and merged after it: on a schema migrated at c, b would run last.
      git(at(1), 'checkout', '-q', '-b', 'feature')
      commitMigration('20260102000000_b', at(1))
      git(at(2), 'checkout', '-q', 'main')
      commitMigration('20260103000000_c', at(2))
      git(at(3), 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature')

      const seconds = (second: number) => Date.UTC(2026, 0, 1, 0, 0, second) / 1000
      expect(committedAt(set)).toEqual(
        new Map([
          ['20260101000000_a', seconds(0)],
          ['20260103000000_c', seconds(2)],
          ['20260102000000_b', seconds(3)],
        ]),
      )
      expect(migrationSetProblems(set)).toEqual([outOfOrder('20260102000000_b', '20260103000000_c')])

      // A shallow clone dates every folder it cannot see alike, so it is refused rather than passing by accident.
      const shallow = mkdtempSync(join(tmpdir(), 'vetora-order-shallow-'))
      try {
        execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repo}`, shallow], { encoding: 'utf8' })
        expect(() => committedAt(join(shallow, 'drizzle'))).toThrow(/shallow clone/)
      } finally {
        rmSync(shallow, { recursive: true, force: true })
      }
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
