# Working with the Matt Pocock skills in vetora

> This folder is the durable home for research notes; the earlier notes moved here on 2026-10-22 from the retired workflow's cache folder.

Researched 2026-10-22 against the clone at commit 5beb35b. Unprefixed paths are in `~/.claude/plugins/marketplaces/mattpocock/` (skill paths omit `skills/engineering/` or `skills/productivity/`); `vetora/` marks this repository.

## Short answer

- Work from `/ask-matt`, the router. Small loop: `/grill-with-docs`, then `/implement` in one window. Add `/to-spec` and `/to-tickets` only when the build spans sessions; use `/wayfinder` only when an effort is too big and foggy for one.
- "Runbook" is not a skill or flow; the clone uses the word once, as plain English (section 2).
- Installed 1.3.1 ships 27 skills, equals upstream `main` today, and does not update itself (section 3).
- Carry-over: keep `scope.md` as the roadmap, keep specs 0001, 0002 and ADR 0001 in place, give spec 0002's build plan to `/to-tickets`, and grill other features just in time instead of opening 24 issues now (section 4).

## 1. The day-to-day flow

Authority: `ask-matt/SKILL.md`; where a docs page and a `SKILL.md` disagree, the `SKILL.md` wins (`docs/engineering/ask-matt.md`).

- **Small loop** (one context window): `/grill-with-docs` (writes `GLOSSARY.md` and ADRs as it goes), then `/implement` in the same window. It drives `/tdd` at pre-agreed seams, runs `/code-review`, and commits to the current branch (`implement/SKILL.md`). Then `/pr` for the body (the agent fires it) and `/retro` after a rough build.
- **Medium loop** (several sessions): `/grill-with-docs`, `/to-spec`, `/to-tickets` in one unbroken window; then `/implement #N` per ticket with `/clear` between, or `/implement-spec` for the whole task graph in worktrees on one integration branch (`implement-spec/SKILL.md`).
- **Big loop**: `/wayfinder` charts a `wayfinder:map` issue and child decision tickets, one resolved per session. It plans and does not build; the agent writes the map's Notes, so read them. A cleared map goes `/to-spec #<map>`, `/to-tickets`, `/implement`. Session count, not project size, picks it over grilling (`docs/engineering/wayfinder.md`).
- **Detour**: a question that needs running code goes `/handoff` out, `/prototype`, `/handoff` back.
- **On-ramps**: `/triage` for issues you did not create (never `/to-tickets` output); `/diagnosing-bugs` for hard bugs (a red feedback loop before any theory), then `/retro`.
- **Other**: `/improve-codebase-architecture` for upkeep (README: every few days; I would start after slice 1); `/research`; `/to-questionnaire` when the answer sits in someone else's head; `/wizard` for human-only steps; `/grill-me` with no repo.

## 2. What "runbook" means

The word appears once in the whole clone (the cached 1.3.1 copy is identical): `.agents/writing-docs.md` line 74. It means a skill's own procedure, the `SKILL.md` steps and template dumps, which a docs page deliberately does not copy because a person choosing a tool has no use for them. It is a documentation convention, not a skill, flow, file or glossary term.

Nearest real things: `ask-matt` is the map of flows, each `SKILL.md` is the procedure, and `/wizard` writes an executable script for human-only operational steps (provisioning, secrets, cutovers), the closest thing to an operations runbook (`wizard/SKILL.md`).

## 3. Installed 1.3.1 versus the repo, and updating

- **Ships:** the 27 skills in `.claude-plugin/plugin.json`: 20 engineering (including `ask-matt`, `implement-spec`, `pr`, `retro`, `wizard`) and 7 productivity; 16 user-invoked, 11 model-invoked. `claude plugin details mattpocock-skills@mattpocock` agrees (about 1,169 always-on tokens).
- **Versus the repo:** identical. Cache and clone differ only by an `.in_use` marker, and `gh api repos/mattpocock/skills/compare/5beb35b...main` returns `identical` (2026-10-22). The version label lags the content: `CHANGELOG.md` stops at 1.3.1, yet 17 pending `.changeset/` files are already in the code (for example, setup now creates missing triage labels).
- **On disk, not shipped:** 7 beta `skills/in-progress/` skills, including `chief-of-staff` and `claude-handoff`, and 4 frozen `skills/misc/` skills (`CLAUDE.md`, `skills/in-progress/README.md`). Install one with `npx skills@latest add mattpocock/skills --skill=<name>`; beta skills may change without warning.
- **Updating:** you installed from the repo's own marketplace `mattpocock`, not `claude-plugins-official`, and Claude Code leaves auto-update off for third-party marketplaces (https://code.claude.com/docs/en/discover-plugins). Run `claude plugin marketplace update mattpocock` (refreshes the listing only), then `claude plugin update mattpocock-skills@mattpocock`, then `/reload-plugins` or restart. The plugin `version` decides when users see an update, so new commits arrive at the next release (`.agents/adr/0002-ship-as-a-claude-code-plugin.md`). The official route auto-updates but pins a sha (`49dd158`, one commit behind yours); use one route. The plugin is registered at both local and user scope (`claude plugin list`); one is enough.

## 4. Where things live, and the carry-over

- **Spec, tickets, map:** the spec is one tracker issue labelled `ready-for-agent`, a disposable snapshot; tickets are tracer-bullet sub-issues with native blocking links; a wayfinder map is an issue indexing closed decision tickets (`to-spec/SKILL.md`, `to-tickets/SKILL.md`, `wayfinder/SKILL.md`, `docs/engineering/to-spec.md`).
- **Decisions, research, prototypes:** ADRs in `docs/adr/` (hard to reverse, surprising, a real trade-off; a paragraph will do), vocabulary in `GLOSSARY.md`, rejected enhancements in `.out-of-scope/`; research is a cited file where the repo keeps notes; a prototype is a `prototype/<name>` branch (`domain-modeling/ADR-FORMAT.md`, `triage/OUT-OF-SCOPE.md`, `research/SKILL.md`, `prototype/SKILL.md`).
- **Roadmap:** none; the flow starts at an idea (`ask-matt/SKILL.md`). A milestone per slice is plain GitHub, not Matt's flow.

Suggested carry-over (reasons cited; the edits are my suggestion):

1. Keep `vetora/docs/scope/scope.md` as the roadmap and stop updating its command checkboxes. Open no issues for features 4 to 24: a 27-ticket map stopped making sense by the thirteenth (`docs/engineering/wayfinder.md`).
2. Keep specs 0001, 0002 and ADR 0001 in place; skills already read them via `vetora/docs/agents/domain.md`, and ADR 0001 already fits `ADR-FORMAT.md`. Do not paste them into issues: spec 0002 is 82 KB and large specs come back truncated from a tracker (`docs/engineering/to-spec.md`).
3. Edit the lines that still route to `/architect`, `/check verify` and `/audit` (`vetora/docs/agents/issue-tracker.md` line 3, `vetora/docs/agents/domain.md`, `vetora/AGENTS.md`): new specs become `/to-spec` issues, 0001 and 0002 frozen history. Add a line that research goes in `docs/research/`, since `/research` copies the repo's existing convention (today the cache folder).
4. Feature 3 (data model): run `/to-tickets` with the spec path (it accepts one); create a stub parent issue naming the path first if you want sub-issue grouping. At the quiz step reject layer-shaped tickets (the spec's seven build steps are mostly layers). Each ticket names what can be demoed, the AC and rule IDs it satisfies, each able to fail, and its test seam (`docs/engineering/to-tickets.md`).
5. Feature 1 (stack): keep `verify.md` as the checklist; make the hosted deploy a `/wizard` job.
6. Features 4 to 24, as each comes up: `/grill-with-docs <feature>`, then the small or medium loop. Use `/wayfinder` only for a bounded destination that outgrows one session; candidates are the "needs a decision" clusters (feature 4, features 19 to 21).
7. OPEN-n questions only a lawyer, accountant or vet can answer: `/to-questionnaire`. Design partner requests: `/triage`. The domain.md §11 exclusions become `.out-of-scope/` files when requested; the Deferred list stays in the roadmap, since deferrals are not rejections (`triage/OUT-OF-SCOPE.md`).

## 5. What AGENTS.md should hold

Put in:

- The `## Agent skills` block setup writes (tracker, labels, domain docs: one line and a `docs/agents/` pointer each). Several skills expect the tracker to be "provided" this way, and `wayfinder` finds its tracker doc through it (`setup-matt-pocock-skills/SKILL.md`, `docs/engineering/wayfinder.md`). Vetora's block already fits.
- Standing preferences for the skills, one line each, instead of editing a `SKILL.md`; the plugin is read-only and updates overwrite edits. Example: ask one question at a time when grilling (`docs/engineering/ask-matt.md`, `docs/productivity/grilling.md`).
- Navigation pointers with a leading word and one trigger per branch, reference behind the pointer (`writing-for-agents/SKILL.md`).
- Judgement-call standards in `CODING_STANDARDS.md`, read at review, not implementation. The Standards axis of `/code-review` always passes that file and `CONTRIBUTING.md` to its sub-agent, adds a 12-smell Fowler baseline that documented standards override, and skips what tooling enforces (`code-review/SKILL.md`). Vetora has none, so AGENTS.md reaches the reviewer only if the repo search picks it up.

Keep out: rules a linter, test or CI job can enforce (`retro` builds the check instead); restated lookups from `package.json` or config; a patch per past mistake; bans with no positive target; glossary terms or spec text (`retro/SKILL.md`, `writing-for-agents/SKILL.md`, `domain-modeling/SKILL.md`). In vetora, i18n key parity and import boundaries are check candidates.

## 6. Session hygiene

- Phase boundary, first yes wins: continue (the next phase needs this one verbatim, or smart zone of about 150k tokens remains); `/clear`; `/handoff` (only when work travels: new harness, directory, colleague, or a side task forked mid-phase); a subagent; `/compact`, the default, last. Decide at the boundary, not mid-phase (`ask-matt/PHASE-BOUNDARIES.md`).
- Keep grill, spec and tickets in one window; clear only after `/to-tickets`. Run `/retro` in the session it reviews, before clearing, or point it at the log. It only proposes: mechanical mistakes become checks, judgement calls become reviewer rules (`retro/SKILL.md`).
- `/handoff <purpose>` writes to `$TMPDIR` or `/tmp`, references specs and issues by path or URL, and redacts secrets (`handoff/SKILL.md`). Temp is not durable; copy the file if the next session is not soon (`docs/productivity/handoff.md`).
- `/claude-handoff` (beta) writes the same summary and starts a background agent with `claude --bg --name`; your Claude Code 2.1.289 supports that. `/chief-of-staff` (beta) runs one long session that delegates all work to subagents and keeps a dated wiki; at a solo part-time pace I would skip it for now (`skills/in-progress/claude-handoff/SKILL.md`, `skills/in-progress/chief-of-staff/SKILL.md`).
- Tracer bullet tickets: each cuts one narrow path through every layer (schema, API, UI, tests), is demoable alone, fits one fresh window and lists its blockers; prefactoring first; a wide mechanical change uses expand, migrate, contract. Ask of each: what can I demo when this is done? One team that sliced by layer reported about three quarters of runs as rework (`to-tickets/SKILL.md`, `docs/engineering/to-tickets.md`).

## 7. Gotchas

- 16 of 27 skills are user-invoked and hidden from the agent's skill list, so the agent may claim they are missing; they appear as `/mattpocock-skills:<name>` (`docs/engineering/ask-matt.md`).
- `/code-review` collides with Claude Code's built-in; type `/mattpocock-skills:code-review`. Its sub-agents and `/research` can spawn nested agents, which the maintainer leaves to the harness, so watch the agent count (`.out-of-scope/harness-name-collisions.md`, `.out-of-scope/subagent-recursion.md`).
- `/implement` commits to the current branch (here `main`), never closes the ticket or ticks criteria, and reviews before committing, but `/code-review` diffs `<fixed-point>...HEAD` and cannot see uncommitted work (`docs/engineering/implement.md`, `docs/engineering/code-review.md`). Record `git rev-parse HEAD` before each ticket as the fixed point, and put `Closes #N` in the commit so the Spec axis finds its spec (`code-review/SKILL.md` step 2).
- `/to-spec` labels the spec `ready-for-agent`, so an AFK poller would try to build all of it: remove the label after `/to-tickets`, and do not clear or compact between the two (`docs/engineering/to-spec.md`).
- `/grill-with-docs` may load `grilling` and skip `domain-modeling`; if `GLOSSARY.md` did not change, ask which skills loaded (`docs/engineering/grill-with-docs.md`).
- Re-running setup edits `CLAUDE.md` when it exists, and vetora's only points to `AGENTS.md`; tell it to edit `AGENTS.md` (`setup-matt-pocock-skills/SKILL.md` step 4). Setup creates the five triage labels (present on `bbyvfrd/vetora`, checked 2026-10-22) but not the `wayfinder:` labels (`map`, `research`, `prototype`, `grilling`, `task`; none exist); create them before the first `/wayfinder` (`docs/engineering/setup-matt-pocock-skills.md`).
- `vetora/docs/agents/issue-tracker.md` uses `gh issue create --parent`, which needs `gh` 2.94+; yours is 2.87.3 with no `--parent` or `--blocked-by`. Upgrade, or use the `gh api` fallback in that file.

## Sources

The clone: `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `.changeset/`, `.agents/`, `.out-of-scope/`, every `SKILL.md` named above, `docs/engineering/`, `docs/productivity/`. Installed plugin: `~/.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1/.claude-plugin/plugin.json`, `known_marketplaces.json`, the official marketplace's `marketplace.json`. Read-only commands: `claude plugin details|list`, `claude --help`, `gh --version`, `gh label list --repo bbyvfrd/vetora`, two `gh api repos/mattpocock/skills/compare/...` calls. Web: https://code.claude.com/docs/en/discover-plugins. Vetora files: `AGENTS.md`, `CLAUDE.md`, `GLOSSARY.md`, `docs/agents/`, `docs/scope/scope.md`, `docs/specs/`, `docs/adr/`. Not fetched: github.com/mattpocock/skills pages, aihero.dev.
