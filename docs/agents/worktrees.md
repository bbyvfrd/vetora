# Worktrees: one checkout per task

How parallel work runs in vetora: the main folder stays on `main`, every task that touches code runs in its own worktree under `.claude/worktrees/`, and each checkout has a slot of ports and a database cluster of its own (ADR 0006; the sources are `docs/research/2026-10-26-worktrees-for-parallel-sessions.md`).

## The shape

- **The main folder** (`~/projects/personal/vetora`) is slot 0: `main` checked out, ports 3000, 5173, 5432 and 8333, Compose project `vetora`. It lands work and reads; code changes happen elsewhere. Docs only work (grilling, a spec, research, an ADR) may commit to `main` here when no other session writes here.
- **A worktree** is a full checkout at `.claude/worktrees/<name>` on its own branch, with its own `node_modules` (Vite's cache inside it), `.env` files, containers and volumes. Shared with the main folder: the object store and the branches, the hooks in `.git/hooks` (lefthook), the pnpm store, the Turborepo cache (a linked worktree uses the main folder's `.turbo/cache`, so identical inputs hit), the Docker images, and the project settings, hooks and skills, which a session started from the app reads from the main folder's root.
- **A slot** is a number from 1 to 9 that a worktree takes on its first setup: every port is the default plus the slot (slot 1: API 3001, web 5174, Postgres 5433, S3 8334) and the Compose project is `vetora-s<n>`. It is recorded in the worktree's root `.env` and is free again once the worktree is gone.

## Start

1. Create the worktree with the tool at hand: the Claude app's **Worktree** toggle when starting a session (branch `claude/<name>`), `EnterWorktree` inside a session, `claude -w <name>` in a terminal (branch `worktree-<name>`), or `git worktree add -b <branch> .claude/worktrees/<name> main`. Name it after the ticket when you choose (`12-app-shell`). The app and the CLI branch from `origin/main`, so `main` is pushed before a worktree starts.
2. Set it up. A session started in it runs `infra/local-env.sh session-start` through the SessionStart hook and reports the slot in its first context line. After `EnterWorktree`, in a subagent's worktree, or in a terminal, run `pnpm local:setup --up` yourself. Done when `pnpm local:status` shows the slot with `postgres s3` running.
3. Check the baseline before changing anything: `pnpm test` green against the slot's cluster.

The `.env` files are written from the examples with the slot's ports; a file copied from another checkout names that checkout's ports and cluster, and `pnpm local:setup` says so (`pnpm local:setup --force` rewrites `apps/api/.env`).

## Work

- `pnpm dev`, `pnpm test`, `pnpm local:up`, `pnpm local:down` and `docker compose exec postgres psql …` act on the checkout they run in, through its root `.env`. The app's browser preview reads the checkout's `.claude/launch.json`, written with the slot's ports.
- The Bash tool in a worktree session (the app's, or after `EnterWorktree`) runs only commands it can prove stay inside the worktree. What passes: `pnpm -C /abs/worktree …`, `git -C /abs/worktree …`, `docker compose …`, short `cat`, `grep` and `awk` calls on literal paths, chains with `&&`, a redirect to a literal log file. Refused as "too complex to verify": loops, heredocs holding source code, `sed` with a computed program or path, a `W=…;` prefix followed by several statements, `git` aimed at the main folder. So: create and change source files with the Write and Edit tools, give every `pnpm`, `docker`, `git` and `sed` call a literal absolute path, put one step per Bash call, and read a long command's output before building on it.
- Ports and database URLs live in files, never in shell exports: Turborepo's strict env mode strips unlisted variables from `pnpm dev`, so an exported `VETORA_API_PORT` never reaches Vite. `git config` changes and `pnpm exec lefthook install` run in the main folder: a worktree session's sandbox denies writes to the shared `.git/config` and `.git/hooks`.
- Commit on the worktree's branch as the ticket's rules say: one commit per ticket, a conventional prefix, `Closes #N`. `/implement` commits to the current branch, which is the worktree's. The review before landing is `/mattpocock-skills:code-review` since `main`: it diffs `main...HEAD`, so there is no fixed point to note.
- Keep up with `main` when it moved: `sync_with_base_branch` in an app session, `git rebase main` in a terminal (`pull.rebase` is set). Afterwards `pnpm local:setup` reinstalls when the lockfile changed, `pnpm openapi` when a route changed on either side, and `pnpm --filter @vetora/api db:check` when a migration folder arrived (ADR 0002 orders folders by the commit that lands them, so parallel folders need no renaming).

## Collisions to expect

Worktrees postpone collisions to merge time. Files two tickets often both touch: the locale files in `packages/i18n` (every key in all three), `packages/contracts/openapi.json` with `src/generated/api.ts` (`pnpm openapi` regenerates both; a hand merge is wrong by construction), `apps/clinic-web/src/routeTree.gen.ts` (the Vite dev server regenerates it), the status lines of `docs/scope/scope.md`, and the Drizzle migration folders under `apps/api/drizzle`. Regenerate a generated file after a sync instead of resolving it line by line.

## Land

1. In the worktree: `pnpm test`, `pnpm lint` and `pnpm typecheck` green, the review done and its fixes amended into the ticket's commit.
2. The user pushes the branch and opens the pull request (agents never push): `gh pr create --fill`, with `Closes #N` in the body. CI runs on pull requests (`.github/workflows/ci.yml`).
3. Merge by squash, `gh pr merge --squash --delete-branch`: one commit per ticket on `main`, its message the pull request's title and body (GitHub's squash default once `gh repo edit --squash-merge-commit-title PR_TITLE --squash-merge-commit-message PR_BODY` has been run).
4. In the main folder, `git pull` (a fast forward).
5. Clean up happens by itself: the sweep (`pnpm local:gc`, run by the SessionStart and SessionEnd hooks of every session) removes a worktree whose branch has landed on `main` (merged, or its pull request merged) together with its branch and its Compose project, when nothing is uncommitted and no live session holds it; a lock whose session is gone is released first, a `prototype/*` branch is never touched, and the checkout running the sweep is only reported. It also removes the Compose projects of worktrees that are already gone and prunes stale worktree records. By hand, the same is `pnpm local:destroy` in the worktree, `git worktree remove .claude/worktrees/<name>`, `git branch -D <branch>` (after a squash the branch looks unmerged, so `-d` refuses). `ExitWorktree` with `remove` deletes the worktree and the branch together, and the app removes an archived session's worktree after about 30 days; in both cases the containers go at the next sweep. Claude Code's `WorktreeRemove` hook is not used: it fires only for worktrees a `WorktreeCreate` hook made.

Without a pull request, the fallback ADR 0006 keeps: squash on the branch (`git rebase -i main`), `git merge --ff-only <branch>` in the main folder, push `main`.

A prototype (`/prototype`, branch `prototype/<name>`) is never landed: rename the branch when the tool named it (`git branch -m`), leave the worktree with `ExitWorktree` **keep** (remove deletes the branch), and `pnpm local:destroy` its cluster once the spike is over.

## When it goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `fatal: '<branch>' is already checked out at …` | a branch lives in one worktree at a time | work in that worktree, or `git worktree remove` it first |
| `required variable COMPOSE_PROJECT_NAME is missing a value: run pnpm local:setup first` | no root `.env` in this checkout | `pnpm local:setup` |
| `apps/api/.env says PORT=3000 but this checkout is slot 2` | an `.env` copied from another checkout | `pnpm local:setup --force` |
| Vite: `Port 5174 is already in use` | another process on the slot's port (`strictPort`) | `pnpm local:status`, then `lsof -nP -iTCP:5174 -sTCP:LISTEN` |
| Compose: `Bind for 0.0.0.0:5433 failed: port is already allocated` | another container on the slot's Postgres or S3 port | `docker ps`, then `pnpm local:gc` or stop that container |
| `vetora_test could not be reset (is the compose Postgres up?)` | the slot's cluster is down | `pnpm local:up` |
| `no free slot (1 to 9 are taken)` | nine worktrees set up | `pnpm local:gc`, remove finished worktrees |
| `git worktree remove` refuses: locked | a Claude session holds the worktree | finish or archive that session; a dead lock: `git worktree unlock <path>` (`pnpm local:gc` lists them) |
| `git worktree add` refuses: `.claude/worktrees/<name>` exists | a stale directory | `git worktree prune`, then remove the directory |
| `env: node: Bad CPU type in executable` | an x86 Node 12 first on PATH | `export PATH=~/.nvm/versions/node/v24.14.0/bin:$PATH` (the setup script does this itself) |
