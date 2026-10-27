---
status: accepted
date: 2026-10-27
---

# Agents push their branches

ADR 0006 left pushing and merging with the user "as before": every ticket ended with a finished, reviewed commit sitting in its worktree until the user pushed it by hand, then opened the pull request. On 2026-10-27, with #23 done and reviewed in its worktree, the user gave the push to the agents from then on. We decide: an agent pushes a ticket's branch once `pnpm test`, `pnpm lint` and `pnpm typecheck` are green and the review's fixes are amended into its commit, and pushes a docs only commit on `main` from the main folder, the one kind of work AGENTS.md lets land there directly; never with force, so a fix found after the push (CI's, or the pull request review's) is a new commit on the branch, which the squash merge folds into the ticket's one commit. Opening the pull request and merging stay the user's, unless the user asks an agent to. This amends ADR 0006's "the user pushing and merging as before"; the rest of it stands.

## Considered options

- **The user pushes** (ADR 0006 as written): the user sees every branch before it leaves the machine; but a reviewed ticket waits on a hand step, and the app's pull request tools (Create PR, Auto-fix) have nothing to act on until it is taken.
- **Agents push, and open and merge the pull request**: no hand step at all; but the merge lands on `main`, a one way door the user keeps.
- **Agents push; the user opens the pull request and merges** (chosen): the branch is on GitHub as soon as it is ready, CI runs once the pull request is opened, and what lands on `main` stays the user's call.

## Consequences

- AGENTS.md's Git section and `docs/agents/worktrees.md` (Land, step 2) say who pushes and that no push is forced.
- A force push would rewrite a branch a pull request or CI already read, so the review's `--amend` happens before the first push, and later fixes are commits.
