import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The worktree sweep of infra/local-env.sh (pnpm local:gc, run by the SessionStart and SessionEnd hooks), run against a
// scratch repository with one worktree per case. docker is stubbed out (no Compose project is touched) and gh is
// stubbed: a sha listed in merged-heads is the head of a merged pull request.
const script = join(import.meta.dirname, 'local-env.sh')

let dir = ''
let repo = ''
let output = ''
const deadPid = spawnSync('true').pid
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv }).trim()
}

function stub(name: string, body: string) {
  const file = join(dir, 'stubs', name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
}

const worktree = (name: string) => join(repo, '.claude', 'worktrees', name)

type Lock = 'dead' | 'live' | 'none'

// A worktree on its own branch with one commit of its own, locked by a session that is gone, alive, or not at all.
function addWorktree(name: string, { commit = true, lock = 'dead' as Lock } = {}): string {
  const wt = worktree(name)
  git(repo, 'worktree', 'add', '-q', '-b', name, wt, 'main')
  if (commit) {
    writeFileSync(join(wt, `${name}.txt`), name)
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', `work on ${name}`)
  }
  if (lock !== 'none') {
    const pid = lock === 'dead' ? deadPid : process.pid
    git(repo, 'worktree', 'lock', '--reason', `claude session ${name} (pid ${pid} start Mon)`, wt)
  }
  return wt
}

const detach = (name: string, to = 'HEAD') => git(worktree(name), 'checkout', '-q', '--detach', to)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vetora-sweep-'))
  repo = join(dir, 'repo')
  mkdirSync(join(dir, 'stubs'))
  stub('docker', 'exit 1')
  stub(
    'gh',
    [
      'case "$1" in',
      '  api) sha=$(printf "%s" "$2" | sed "s|.*/commits/\\([0-9a-f]*\\)/pulls.*|\\1|")',
      '       if grep -qx "$sha" "$MERGED_HEADS"; then echo 1; else echo 0; fi ;;',
      '  *) echo 0 ;;',
      'esac',
    ].join('\n'),
  )
  const mergedHeads = join(dir, 'merged-heads')
  writeFileSync(mergedHeads, '')

  mkdirSync(join(repo, 'infra'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  copyFileSync(script, join(repo, 'infra', 'local-env.sh'))
  chmodSync(join(repo, 'infra', 'local-env.sh'), 0o755)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'init')

  // Detached worktrees, which is how the app leaves the worktree of a session that was closed.
  addWorktree('A') // landed by fast forward
  detach('A')
  addWorktree('B', { commit: false }) // nothing of its own
  detach('B')
  addWorktree('C') // own commits, not landed
  detach('C')
  addWorktree('D') // landed as the head of a merged pull request
  detach('D')
  addWorktree('E') // landed, with an uncommitted change
  detach('E')
  addWorktree('F', { lock: 'live' }) // landed, a live session holds it
  detach('F')
  addWorktree('G') // landed, a rebase under way
  detach('G')
  addWorktree('K') // rebased onto a moved main, then landed as a pull request head
  addWorktree('L', { lock: 'none' }) // commits on its branch, then HEAD moved to look at main
  addWorktree('M') // landed, but its branch is a prototype
  detach('M')
  git(repo, 'branch', '-m', 'M', 'prototype/M')
  // Worktrees still on their branch.
  addWorktree('H', { lock: 'none' }) // merged
  addWorktree('I', { lock: 'none' }) // a prototype
  git(repo, 'branch', '-m', 'I', 'prototype/I')
  addWorktree('J', { lock: 'none' }) // landed as the head of a merged pull request

  git(repo, 'merge', '-q', '--ff-only', 'A')
  for (const branch of ['E', 'F', 'G', 'H', 'prototype/I', 'prototype/M']) {
    git(repo, 'merge', '-q', '--no-ff', '-m', `merge ${branch}`, branch)
  }
  git(repo, 'branch', 'A-fresh', 'A') // cut on A's landed commit with nothing of its own

  git(worktree('K'), 'rebase', '-q', 'main')
  detach('K')
  detach('L', 'main')
  for (const wt of ['D', 'J', 'K']) {
    writeFileSync(mergedHeads, `${git(worktree(wt), 'rev-parse', 'HEAD')}\n`, { flag: 'a' })
  }

  writeFileSync(join(worktree('E'), 'E.txt'), 'changed')
  mkdirSync(join(git(worktree('G'), 'rev-parse', '--absolute-git-dir'), 'rebase-merge'))

  output = execFileSync('bash', [join(repo, 'infra', 'local-env.sh'), 'gc'], {
    encoding: 'utf8',
    env: { ...gitEnv, PATH: `${join(dir, 'stubs')}:${process.env.PATH}`, MERGED_HEADS: mergedHeads },
  })
}, 60_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const branchExists = (name: string) => {
  try {
    git(repo, 'show-ref', '--verify', '-q', `refs/heads/${name}`)
    return true
  } catch {
    return false
  }
}

describe('the worktree sweep', () => {
  it.each([
    ['A', 'a detached worktree whose work landed by fast forward'],
    ['D', 'a detached worktree whose HEAD is the head of a merged pull request'],
    ['K', 'a detached worktree rebased onto a moved main, landed as a pull request head'],
    ['H', 'a worktree on its branch, merged'],
    ['J', 'a worktree on its branch, the head of a merged pull request'],
  ])('removes %s with its branch: %s', (name) => {
    expect(existsSync(worktree(name))).toBe(false)
    expect(branchExists(name)).toBe(false)
  })

  it.each([
    ['B', 'a detached worktree with no commits of its own'],
    ['C', 'a detached worktree whose work has not landed'],
    ['F', 'a worktree a live session holds'],
    ['G', 'a worktree in the middle of a rebase'],
    ['L', 'a worktree whose HEAD moved to main after commits on its branch (the commits did not land)'],
    ['M', 'a detached worktree sitting on a prototype branch'],
    ['I', 'a worktree on a prototype branch'],
  ])('leaves %s alone: %s', (name) => {
    expect(existsSync(worktree(name))).toBe(true)
  })

  it('leaves a worktree with uncommitted changes and says so', () => {
    expect(existsSync(worktree('E'))).toBe(true)
    expect(output).toContain('has uncommitted changes')
  })

  it('keeps main, the prototypes, the branches left behind by a worktree it kept, and a branch with no commits of its own', () => {
    for (const name of ['main', 'prototype/I', 'prototype/M', 'B', 'C', 'E', 'F', 'G', 'L', 'A-fresh']) {
      expect(branchExists(name), name).toBe(true)
    }
  })

  it('names what it removed and what lock it released', () => {
    expect(output).toContain('(detached at')
    expect(output).toContain('the session that held it')
  })
})
