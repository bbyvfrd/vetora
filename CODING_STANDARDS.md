# Coding standards

Read at review time by `/mattpocock-skills:code-review` (its Standards axis), alongside `AGENTS.md`. Mechanical rules live in `biome.jsonc`, the tests, and CI, so they are not repeated here; these are the judgement calls a reviewer checks.

- **Cite the rule** a piece of code enforces: the `docs/domain.md` §8 IDs (CR-1, RX-3, BL-6, IN-1, …) go in the comment, the test name, and the review note. A rule is enforced as close to the data as possible (constraints, triggers, grants), never only in a screen.
- **Guards fail closed**: a guard whose input is missing (a setting row that is not there, an empty list, a comparison that goes NULL) refuses the write rather than letting it through, and its tests try the missing input.
- **Database rules**: `apps/api/docs/database.md` is the standard for a migration, a table and its registry entry, a trigger or a deferred check, and a database test; a change there is reviewed against it.
- **Sign in and staff**: `apps/api/docs/auth.md` is the standard for Better Auth's routes and server side API, the staff service and commands, and passwords; a change there is reviewed against it.
- **Guards compare definitions**: a check that enforces a rule from the catalog (`pg_trigger`, `pg_proc`, an ACL) reads what the object is and does, such as a trigger's function, timing, events, and enabled state, or a grant's grantee with PUBLIC included, whose grants every role inherits; its tests try the bypasses (disable, rename, swap the function, grant to PUBLIC).
- **Use the glossary's words** (`docs/domain.md` §7): English identifiers, Russian authoritative meaning, no synonyms (an Encounter is not an appointment; a Client is not an Owner). A missing term is recorded in `GLOSSARY.md`, not invented.
- **One error shape**: problem details JSON from every route, carrying the request id; a Postgres `detail`, `hint`, or `where` never reaches a log or a response.
- **No personal data** in URLs, logs, or error reports: names and phones travel in request bodies, logs carry ids and durations, Sentry collection stays off.
- **Screen text** only through `packages/i18n`, every key in `az`, `ru`, and `en`; dates, numbers, and sorting go through the design system's formatters once they land, never raw `Intl` for `az`.
- **Module boundaries**: a module's `index.ts` is its public interface; only `src/platform/` touches a database client; money and stock reactions run in the same transaction as the write that caused them (RX-3, HS-3, IN-3).
- **Money and time**: integer minor units with a currency code (IN-4); instants in UTC, shown in the clinic's time zone.
- **Append only records**: finalised notes, ledgers, and the drug register are never edited or deleted; a correction is a new row (CR-1, RX-4, BL-6).
- **Deep modules**: prefer a module with a small interface and real implementation behind it over a shallow helper; new files start private to their folder.
- **Tests** sit beside the code, named for the behaviour or rule they prove, and a tracer bullet ticket ships with its test seam; a bug fix starts with a failing test.
- **Secrets and config**: never in git; every variable goes through the zod config schema and `.env.example`, and a missing one fails loudly at startup.

The workspace docs (`apps/api/AGENTS.md`, `apps/clinic-web/AGENTS.md`, `packages/*/AGENTS.md`) hold the local conventions.
