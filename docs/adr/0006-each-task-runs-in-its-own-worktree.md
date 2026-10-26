---
status: accepted
date: 2026-10-26
---

# Each task runs in its own worktree, and main is landed by squash merge

AGENTS.md's Git section (2026-10-23) put all work on `main` in one checkout: a solo pilot, one commit per ticket, a review before the push. On 2026-10-26 the first parallel sessions arrived, ticket #12 on `feat/12-app-shell` in the main folder and the feature 5 spike in a worktree on `prototype/better-auth`, and the single checkout broke in four places at once: `main` was checked out nowhere, so a research note had to be cherry-picked onto it from the worktree; `.claude/worktrees/` showed up untracked; every worktree needed a hand copied `.env` and a hand written Compose override to get a database of its own, because the API's tests reset `vetora_test` and create cluster wide roles; and Vite, the API, Postgres and the S3 server claimed the same ports in every checkout. The sources behind what follows are in `docs/research/2026-10-26-worktrees-for-parallel-sessions.md`.

We decide: the main folder stays on `main` and only lands and reads; every task that touches code (a ticket, a prototype, a chore) runs in its own worktree under `.claude/worktrees/` on its own branch, whichever tool creates it (the Claude app's Worktree toggle, `EnterWorktree`, `claude -w`, `git worktree add`); every checkout holds a slot, 0 for the main folder and the lowest free number for a worktree, that fixes its ports and its Compose project, written by `pnpm local:setup` and by the SessionStart hook; and a branch lands on `main` through a pull request merged by squash, one commit per ticket with `Closes #N` in its message, the user pushing and merging as before.

## Considered options

- **Keep one checkout on `main`** (the 2026-10-23 decision): nothing to set up; but two sessions cannot write in one folder, and the first parallel day produced the four headaches above.
- **Worktrees sharing one local environment** (one Postgres on 5432, one pair of dev ports): no per checkout setup; but two test runs against one cluster clobber each other, and two dev servers cannot bind one port.
- **Worktrees outside the repository**: keeps Biome, Docker and `find` out of them by construction; but `--worktree`, `EnterWorktree` and subagent isolation always use `.claude/worktrees/`, so the folder has to be handled anyway, and `.gitignore` (which Biome follows) and `.dockerignore` already cover it.
- **Share `node_modules` through `worktree.symlinkDirectories`**: no install per worktree; but pnpm's workspace links (`node_modules/@vetora/contracts` is `../../packages/contracts`) resolve from the link's real location, so a worktree would import the main folder's packages, and the install is hard links from the shared store in a few seconds anyway.
- **Copy `.env` files into new worktrees with `.worktreeinclude`**: Claude Code's own mechanism; but it copies the main folder's files verbatim, so a worktree would start on slot 0's ports and cluster, the collision being removed.
- **A `WorktreeCreate` hook that creates and sets up the worktree**: one place for everything; but it replaces Claude Code's own creation (the base ref, name reuse, the branch's cleanup), never fires for the app's sessions or for `git worktree add`, and leaves the branch for a `WorktreeRemove` hook to delete. A `SessionStart` hook plus one idempotent command covers every path.
- **Landing by local fast forward** instead of a pull request: no round trip; but the app's merge based sync and a squash disagree about the shape of the branch, CI only runs after the fact on `main`, and the app's PR review and Auto-fix stay unused. Chosen: pull requests with squash merge; the fast forward stays documented in `docs/agents/worktrees.md` as the fallback.

## Consequences

- `compose.yaml` and `apps/clinic-web/vite.config.ts` read their ports and the Compose project from the checkout's root `.env`; a checkout without one stops Compose with a message instead of attaching to another checkout's containers. `infra/local-env.sh` writes that file, `apps/api/.env` and `.claude/launch.json` from the slot, installs dependencies, and starts or removes the checkout's containers (`pnpm local:setup`, `local:status`, `local:destroy`, `local:gc`).
- `.claude/settings.json` runs it as a `SessionStart` hook, so a session started in a worktree finds its environment ready and reads its ports in its first context line, and as a `SessionEnd` hook for the sweep: a worktree whose branch has landed on `main` (merged, or its pull request merged), clean and held by no live session, is removed with its branch and its Compose project; `prototype/*` branches are kept. Claude Code's own `WorktreeRemove` hook fires only for worktrees a `WorktreeCreate` hook made, so the sweep is the removal path for every creation route. `.claude/worktrees/` and the generated `.claude/launch.json` are ignored by git.
- The procedure lives in `docs/agents/worktrees.md` (agents) and `docs/RUNBOOK.md` (people); AGENTS.md's Git section points there. `/implement` commits to the worktree's branch and the review diffs `main...HEAD`, so no fixed point is noted before a ticket.
- GitHub's squash merge takes the pull request title and body as the commit message (a repository setting applied once), so `Closes #N` in the body closes the ticket and reaches `git log`.
- The local fast forward stays documented in `docs/agents/worktrees.md` as the fallback for a day without a pull request; it changes nothing else.
