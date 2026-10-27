# Sign in and staff: the API's conventions

How the API signs staff in through Better Auth 1.7.12 (spec #18, ADR 0008; the spike is `docs/research/2026-10-26-better-auth-spike.md`). Read it before the first change in a ticket to `src/platform/auth/`, `src/http/auth.ts`, `src/http/me.ts`, `src/modules/identity-access/`, or a staff command; `CODING_STANDARDS.md` holds the change to it at review. The sign in tables in the `control` schema are `docs/database.md`'s ("Actor and audit").

## Conventions

- Better Auth is reached over HTTP only through the three routes of `src/http/auth.ts`: sign in by username, sign out, and get session, each forwarding a request of its own making to Better Auth's handler. Anything else a feature needs from it (a staff screen, a reset) goes through its server side API from platform code (`src/platform/auth/`), as the commands do. Every other `/api/auth` path answers 404.
- What leaves the API is the contract's alone: sign in answers 204 with the cookie and no token, every refusal of the credentials as one 401 problem, and a 429 titled `Login locked` (the sign in lock) or `Too many sign in attempts` (the rate limiter); get session answers `SessionResponse`'s fields (no token, IP address, user agent or email).
- The sign in lock (#20) is Better Auth's `hooks` (`src/platform/auth/sign-in-lock.ts`), counted in `control.sign_in_lock` per username as Better Auth looks it up (lower cased), never per address: five failures within 15 minutes of the first lock the username for 15 minutes, a success or `unlock-login` deletes its row. Every attempt counts from its start (the before hook's atomic upsert), so a burst gets five guesses, not one per request in flight. Any username string counts, a login's or not; its logs name the login's id when there is one, never the username.
- A password reaches a command from `readPassword()` (`src/platform/prompt.ts`) alone, never an argument, so none lands in shell history; a command asks for one only when it writes one.
- A practice is an organization whose id is the registry's (`beforeCreateOrganization`), and `control.member` holds a person's roles; how the staff service writes it with its `staff_member` mirror is `docs/database.md`, Actor and audit.

## Gotchas

- Better Auth checks a POST's `Origin` only when a cookie comes along, so the allowlist checks it itself: sign in and sign out answer 403 unless `Origin` is `PUBLIC_ORIGIN` (login CSRF). The API seam's `call()` sends the test origin; `curl` needs `-H "Origin: http://localhost:<web port>"`.
- Better Auth's rate limiter is on in production only (its default); locally and in the tests nothing is limited, and a test that needs it sets `rateLimit.enabled` on `auth().$context` for its own walk (`sign-in-lock.test.ts`). Its sign in rule is raised from 3 per 10 seconds to 30 a minute per address (`customRules`), so a clinic signing in together behind one address never meets it. It keys by the address in `x-forwarded-for`, which kamal-proxy with `forward_headers: false` writes afresh with the client's address alone; Better Auth trusts only a single address there, so a chain (`forward_headers: true`) would put every request in one shared bucket.
- An `apps/api/.env` written before feature 5 lacks `BETTER_AUTH_SECRET`, and the API and the login commands stop at startup naming it: `pnpm local:setup` reports every variable the file lacks, and `pnpm local:setup --force` rewrites the file.

## Signing in locally

`pnpm local:up` and `pnpm --filter @vetora/api migrate`, then `provision-practice` (AGENTS.md, Commands; type the manager's password twice at the prompt, ten characters or more), `pnpm dev`, and on the web port (`pnpm local:status`) sign in with Clinic code `alfa`, Username `dr.aliyeva` and that password. In a script, pipe the password: `echo "$PASSWORD" | pnpm --filter @vetora/api add-staff -- …`.

The practices the 2026-10-24 rehearsal left in `vetora` (alfa, beta, gamma) and the scaffold's dev practice have staff rows and no logins: rerun `provision-practice` for each with a `--manager-handle`, which gives the first manager a login with their staff id, or clean them up first (`docs/specs/0002-data-model/verify.md`, Clean up).
