# Runbook: how work moves in vetora

The day to day flow with the Matt Pocock skills (plugin `mattpocock-skills`). `/ask-matt` picks a skill when you are unsure; this page is the short version, and `docs/research/working-with-matt-pocock-skills.md` holds the why, with sources.

## Pick a loop

- **Small loop, one window.** `/grill-with-docs <feature>` sharpens the idea and writes ADRs and glossary terms as it goes; then `/implement` in the same window builds it, driving `/tdd` at the agreed seams, running `/mattpocock-skills:code-review`, and committing to `main`. Then `/pr` if there is a pull request to describe, and `/retro` after a rough build.
- **Medium loop, several sessions.** `/grill-with-docs`, then `/to-spec` (one GitHub issue, the spec), then `/to-tickets` (tracer bullet tickets with their blocking links), all in one unbroken window. Take the `ready-for-agent` label off the spec issue once it is ticketed. Then per ticket: note `git rev-parse HEAD`, read the spec sections the ticket's **Spec** line names (by heading, not the whole record) and the tickets its "Not here" section names (their shapes bind this one), `/implement #N`, `/clear`. Or `/implement-spec` to work the whole ticket graph in worktrees on one integration branch.
- **Big loop.** `/wayfinder` for a bounded chunk that is too big and foggy for one session: it charts a `wayfinder:map` issue with decision tickets, resolved one per session, and it plans without building. Create the `wayfinder:` labels (`map`, `research`, `prototype`, `grilling`, `task`) before the first run. A cleared map goes `/to-spec #<map>`, `/to-tickets`, `/implement`.

## Detours

- A design question that needs running code: `/handoff` out, `/prototype` on a `prototype/<name>` branch, `/handoff` back.
- A hard bug: `/diagnosing-bugs` (a red feedback loop before any theory), then `/retro`.
- An issue you did not write, such as a design partner request: `/triage`.
- A question for the lawyer, the accountant, or a vet (the OPEN-n register): `/to-questionnaire`.
- A fact to check against primary sources: `/research`, which writes to `docs/research/`.
- A step only a human can do (the first hosted deploy, secrets, a cutover): `/wizard` writes the script.
- Housekeeping every few days once real code exists: `/improve-codebase-architecture`.

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
- `/implement` commits to the current branch (here `main`), never closes the ticket, and ticks no criteria; the review diffs `<fixed point>...HEAD`, so note `git rev-parse HEAD` before each ticket, commit before the review, amend the review's fixes into the same commit, and put `Closes #N` in the message (the push closes the ticket).
- `/to-spec` labels the spec `ready-for-agent`; an unattended agent would try to build all of it, so remove the label after `/to-tickets`.
- If `/grill-with-docs` did not change `GLOSSARY.md`, ask which skills loaded; it sometimes skips `domain-modeling`.
- `/setup-matt-pocock-skills` edits `CLAUDE.md` when it finds one; here it must edit `AGENTS.md`.
- `gh issue create --parent` needs `gh` 2.94 or later; on an older `gh`, use the `gh api` fallback in `docs/agents/issue-tracker.md`.
- The plugin does not update itself: `claude plugin marketplace update mattpocock`, then `claude plugin update mattpocock-skills@mattpocock`, then reload.

## Where we are (2026-10-24)

Features 2 (coding standards and tooling) and 3 (data model) are done: spec 0002's foundations are built, rehearsed on two practices through the shipped commands, and recorded in `docs/specs/0002-data-model/verify.md`; each slice adds its own tables from the spec's sketch as its first ticket. Feature 1 (stack) runs locally, with the hosted deploy waiting on a server and a domain (`docs/specs/0001-stack-architecture/verify.md`, Hosted section, a `/wizard` job). Features 4 to 24 are picked up one at a time, grilled just in time. Feature 4 (design system) was grilled on 2026-10-24 (`docs/research/2026-10-24-grilling-next-after-0002.md`, ADRs 0003 and 0004): its spec and tickets come next in the same window. Feature 5 (the first visit) is paused until then; a one session Better Auth `/prototype` spike (the record's Feature 5 spike section) precedes its grilling.
