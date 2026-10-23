---
status: proposed
date: 2026-10-24
---

# Migration order is checked against the branch history

Spec 0001 ("Migrations") has CI reject migration folders committed out of timestamp order because "Drizzle skips them silently", which was 0.x's behaviour (`rationale.md` left it to verify on 1.0). Drizzle 1.0 (rc.5, `getMigrationsToRun`) applies every folder a schema has not recorded, by name, whatever its timestamp: an out of order folder is not lost, it runs last on every migrated schema and first on every fresh one, so one set yields two orders and a migration that builds on an earlier one fails on one of them. The rejection stays, for this reason, and `db:check` enforces it (`drizzle-kit check` on both sets, then `apps/api/src/platform/db/migration-order.ts`): a folder is dated by the first-parent commit that landed it on the branch, a folder not committed yet counts as the newest, a folder that sorts before one that landed earlier fails, and a shallow clone is refused rather than read. This amends the parenthesis in spec 0001 "Migrations" and settles the rationale's open verification; the decision in the section stands.

## Considered options

- **`drizzle-kit check` alone**: refuses a generated folder whose snapshot sorts before its parent and two folders generated from one snapshot, but knows nothing of a folder without a snapshot (a hand written migration, a test fixture) and nothing of what a database has already applied. Kept as the first half of `db:check`.
- **A diff against a base ref** (`origin/main` for a pull request, the previous commit for a push): every folder added must sort after every folder at the base. Needs a base per CI event and says nothing on a developer's machine before the push.
- **First-parent commit dates** (chosen): one `git log` of the set folder, no base to compute, catches a rebase, a squash, and a merge that lands an older folder after a newer one, on the developer's machine and in CI alike; the cost is the full history in CI (`fetch-depth: 0`).
- **A runtime guard in `migrate`**: refuse a pending folder older than the newest recorded one. Closest to the data, and not taken: by then the folder is deployed. It stays a follow up if CI ever proves insufficient.

## Consequences

- `.github/workflows/ci.yml` checks out the full history and runs `pnpm --filter @vetora/api db:check` after the build.
- A migration generated on a branch that `main` has moved past is generated again (a newer timestamp) before it lands, never renamed by hand.
- Two migrations committed together sort by name, so one commit may carry several.
