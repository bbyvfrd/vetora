# Runbook: how work moves in vetora

The day to day flow with the Matt Pocock skills (plugin `mattpocock-skills`). `/ask-matt` picks a skill when you are unsure; this page is the short version, and `docs/research/working-with-matt-pocock-skills.md` holds the why, with sources.

## Pick a loop

- **Small loop, one window.** `/grill-with-docs <feature>` sharpens the idea and writes ADRs and glossary terms as it goes; then `/implement` in the same window builds it, driving `/tdd` at the agreed seams, running `/mattpocock-skills:code-review`, and committing on the task's branch in its worktree. Then `/pr` for the pull request that lands it, and `/retro` after a rough build.
- **Medium loop, several sessions.** `/grill-with-docs`, then `/to-spec` (one GitHub issue, the spec), then `/to-tickets` (tracer bullet tickets with their blocking links), all in one unbroken window. Take the `ready-for-agent` label off the spec issue once it is ticketed. Then per ticket: a session in its own worktree (the app's **Worktree** toggle), read the spec sections the ticket's **Spec** line names (by heading, not the whole record) and the tickets its "Not here" section names (their shapes bind this one), `/implement #N`, review, push and open the pull request, `/clear`. Or `/implement-spec` to work the whole ticket graph in worktrees on one integration branch.
- **Big loop.** `/wayfinder` for a bounded chunk that is too big and foggy for one session: it charts a `wayfinder:map` issue with decision tickets, resolved one per session, and it plans without building. Create the `wayfinder:` labels (`map`, `research`, `prototype`, `grilling`, `task`) before the first run. A cleared map goes `/to-spec #<map>`, `/to-tickets`, `/implement`.

## Detours

- A design question that needs running code: `/handoff` out, `/prototype` on a `prototype/<name>` branch, `/handoff` back.
- A hard bug: `/diagnosing-bugs` (a red feedback loop before any theory), then `/retro`.
- An issue you did not write, such as a design partner request: `/triage`.
- A question for the lawyer, the accountant, or a vet (the OPEN-n register): `/to-questionnaire`.
- A fact to check against primary sources: `/research`, which writes to `docs/research/`.
- A step only a human can do (the first hosted deploy, secrets, a cutover): `/wizard` writes the script.
- Housekeeping every few days once real code exists: `/improve-codebase-architecture`.

## Worktrees

Every task that touches code runs in its own worktree, so sessions run side by side without sharing a port, a database or a checkout (ADR 0006; the procedure, the Bash guard's rules, and the failure table are in `docs/agents/worktrees.md`).

- Start a session with the **Worktree** toggle on; its first context line names the slot (API, web and Postgres ports) that the SessionStart hook set up. In a terminal: `claude -w 12-app-shell`, or `git worktree add -b feat/12-app-shell .claude/worktrees/12-app-shell main`, then `pnpm local:setup --up` inside it.
- The main folder stays on `main`: it is where you `git pull` after a merge and where docs only work (grilling, specs, research) may commit directly.
- Land with a pull request merged by squash (`gh pr merge --squash --delete-branch`), then `git pull` in the main folder. The worktree, its branch and its containers are removed by the next sweep (every session start and end, or `pnpm local:gc`) once the branch has landed and nothing is uncommitted; a worktree a live session holds waits for that session to end.
- A prototype's worktree is kept (`ExitWorktree` keep; remove deletes the branch); its cluster goes with `pnpm local:destroy`.

## Session hygiene

- At a phase boundary, the first yes wins: continue (the next phase needs this one verbatim), `/clear`, `/handoff` (only when the work travels to another harness, directory, or person), a subagent, `/compact`.
- Keep grill, spec, and tickets in one window; clear only after `/to-tickets`.
- `/retro` runs in the session it reviews, before clearing; it proposes checks for mechanical mistakes and reviewer rules for judgement calls. Adopt only what you agree with.
- `/handoff` writes to the temp folder; copy the file if the next session is not soon.

## Where things live

Roadmap `docs/scope/scope.md` · design records `docs/specs/` (frozen) · ADRs `docs/adr/` · vocabulary `GLOSSARY.md` and `docs/domain.md` · research `docs/research/` · issues, specs, tickets, and maps on GitHub (`docs/agents/issue-tracker.md`) · review standards `CODING_STANDARDS.md` · conventions `AGENTS.md` and the workspace docs.

## Gotchas

- Most skills (23 of 38, among them `to-tickets`, `to-spec`, `implement`, `grill-with-docs`, `wayfinder`) carry `disable-model-invocation`: you type them as `/mattpocock-skills:<name>`, and an agent cannot call them for you. A session briefed to "run /to-tickets" does the work by hand instead, so type the skill yourself in the session where you want it to run.
- `/code-review` collides with a built in command: type `/mattpocock-skills:code-review`.
- `/implement` commits to the current branch (the worktree's), never closes the ticket, and ticks no criteria; review since `main` (`main...HEAD`), amend the review's fixes into the same commit, and put `Closes #N` in the commit and the pull request body (the squash merge closes the ticket).
- `/to-spec` labels the spec `ready-for-agent`; an unattended agent would try to build all of it, so remove the label after `/to-tickets`.
- If `/grill-with-docs` did not change `GLOSSARY.md`, ask which skills loaded; it sometimes skips `domain-modeling`.
- `/setup-matt-pocock-skills` edits `CLAUDE.md` when it finds one; here it must edit `AGENTS.md`.
- `gh issue create --parent` needs `gh` 2.94 or later; on an older `gh`, use the `gh api` fallback in `docs/agents/issue-tracker.md`.
- The plugin does not update itself: `claude plugin marketplace update mattpocock`, then `claude plugin update mattpocock-skills@mattpocock`, then reload.

## Where we are (2026-10-26)

Since 2026-10-26 work runs in worktrees (ADR 0006): the main folder on `main`, a worktree per task with its own slot of ports and database. Ticket #12 landed on 2026-10-26 through pull request #14; #13, the last of feature 4, was built the same day.

Features 2 (coding standards and tooling), 3 (data model) and 4 (design system) are done. Spec 0002's foundations are built, rehearsed on two practices through the shipped commands, and recorded in `docs/specs/0002-data-model/verify.md`; each slice adds its own tables from the spec's sketch as its first ticket. The design system is `packages/ui` inside the shell of `apps/clinic-web`, recorded in `docs/design.md` (spec #9, tickets #10 to #13, ADRs 0003 to 0005); a component fix is a repo change synced up to the artifact, a token, word or icon change is made in the artifact and re-copied; the first sync up is ticket #15. Feature 1 (stack) runs locally, with the hosted deploy waiting on a server and a domain (`docs/specs/0001-stack-architecture/verify.md`, Hosted section, a `/wizard` job). Features 5 to 24 are picked up one at a time, grilled just in time. Next is feature 5 (the first visit): its Better Auth `/prototype` spike ran on 2026-10-26 (`docs/research/2026-10-26-better-auth-spike.md`; the code stays on the `prototype/better-auth` branch), and its grilling follows, in a fresh window, with the spike's four answers and open points as inputs.
