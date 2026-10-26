---
status: accepted
date: 2026-10-26
---

# Feature 5 leaves two factor, PIN switching and four slice 1 tables to later features

Spec 0001 put two factor sign in (TOTP for managers and the platform admin) in slice 1 and had the first visit spec design PIN switching, and spec 0002's build plan gave slice 1 twenty tables. Feature 5, the whole of slice 1, is the walking skeleton, and its grilling on 2026-10-26 (`docs/research/2026-10-26-grilling-feature-5.md`) found that part of that list guards or records nothing on the feature's path. It has no manager only action (settings, prices, staff and reports arrive with features 15 and 17), the platform admin works through commands, and staff logins come from operator commands, not a screen. No real client data enters before go live (OPEN-13). Nothing on the path writes a problem, an alert, a structured diagnosis or an amendment.

We decide:

- **Two factor and PIN switching move to feature 15**, where they are designed and built beside the staff screens and the manager only actions they guard, before go live. Feature 5 resolves `ctx.actor` as the session's user in one function, so PIN switching changes only that function. This amends spec 0001's Auth row, whose Arrives column read "Slice 1 (PIN switching before go live)", and its follow-up "First visit spec".
- **`patient_problem`, `patient_alert`, `encounter_diagnosis` and `encounter_amendment` move to feature 12**, the patient chart, whose done when already names the problem list (CR-6) and amendments (CR-1). Feature 5 proves the freeze half of AC-2 on `encounter`; feature 12 proves the amendment half. This amends the slice 1 line of spec 0002's build plan; the tables' design is unchanged, and adding them later is new tables and nullable references only (AC-1).

## Considered options

- **Build all of spec 0001's slice 1 auth in feature 5**: the spec as written, and a manager is protected from the first sign in; but the enforcement hook and the PIN plugin would guard actions that do not exist yet, and both would be designed before the screens they belong to.
- **Build the four tables in feature 5 with no screens**: spec 0002's build plan as written; but tables nothing writes prove nothing, and a finalised note with no amendment path is no different until feature 12 lands, which comes before go live in any case.

## Consequences

- Between feature 5 and feature 15 a manager signs in with a password alone, and every session's user is its actor; both are acceptable only because no real client data exists before go live. Feature 15 is not done until a manager cannot reach a manager only action without TOTP.
- Between feature 5 and feature 12 a completed visit cannot be corrected. Feature 8's void covers money; the note waits for its amendment.
- `docs/scope/scope.md` names the moved work under features 12 and 15.
