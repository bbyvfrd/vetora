# Glossary

This file points at the vocabulary; it does not define it.

- Model terms, their meaning, and their Russian and Azerbaijani equivalents: `docs/domain.md`, §7 Ubiquitous language and §8 Aggregates and invariants. The naming rule is §7.1. §7.4 maps what the screens say (Visit, Batch, Queue) to the model terms (Encounter, Lot, Arrival).
- UI wording in Azerbaijani, Russian, and English: `glossary.md` in the vetora design system (Claude Design System artifact; link in `docs/specs/0001-stack-architecture/rationale.md`).
- Table and column names: the data model sketch in `docs/specs/0002-data-model/index.md`.

## Terms added since domain.md

_Record a new term here (term, meaning, RU, AZ, context), then fold it into `docs/domain.md` §7 deliberately._

2026-10-24 (`/grill-with-docs`, what comes after spec 0002; `docs/research/2026-10-24-grilling-next-after-0002.md`): no new model terms. The design system glossary gained the UI rows for four terms `docs/domain.md` §7.3 already holds, Arrival (Gəliş, Явка), Authorised person (Səlahiyyətli şəxs, Доверенное лицо), Alert (Xüsusi qeyd, Особая отметка), Stock location (Saxlama yeri, Место хранения), and its Owner row now reads as PT-1 does: the client currently responsible for the patient, shown on the patient record; ownership can pass to another client. §7.4 is unchanged: on screen these terms keep their model names. Still owed: an Azerbaijani word for Estimate (slice 8) and a UI word for DispenseEvent (slice 2).

2026-10-26 (ticket #12, the shell): no new model terms. The design system glossary gained the shell's two words, Skip to content (Məzmuna keç, Перейти к содержимому) and Main navigation (Əsas naviqasiya, Основная навигация), at the end of its Navigation table, whose intro now also names the rail's own words, and the status page's three older words #11 left for this publish: API status (API vəziyyəti, Состояние API) in Navigation, Up (İşləyir, Работает) and Version (Versiya, Версия) in Forms and messages; published as artifact version 20 (`1792961737-2cad`). In `packages/i18n` they are `shell.skipToContent`, `shell.navigation` and the `health.*` keys. Still owed: an Azerbaijani word for Estimate (slice 8) and a UI word for DispenseEvent (slice 2).

2026-10-26 (`/grill-with-docs`, feature 5; `docs/research/2026-10-26-grilling-feature-5.md`): two model terms, both Identity & Access. The design system glossary gains their screen words with the sign in ticket.

**Practice code** (shown as Clinic code; Klinika kodu, Код клиники):
The short code that names a practice when its staff sign in, chosen when the practice is set up and never reused by another practice.
_Avoid_: clinic ID, tenant

**Handle** (shown as Username; İstifadəçi adı, Имя пользователя, the interviews may prefer Логин):
What a staff member signs in with inside their practice. A handle and a practice code together name one staff member's login, so a person who works at two practices has two logins and is two staff members.
_Avoid_: email, login (the pair, not the part)

2026-10-26 (ticket #19, sign in): no new model terms. The design system glossary gained the screen words of the two terms above, Clinic code (Klinika kodu, Код клиники) and Username (İstifadəçi adı, Имя пользователя), in Forms and messages, beside Signing in (Daxil olunur, Выполняется вход) and the sign in page's brand line, Practice management for veterinary clinics (Baytarlıq klinikaları üçün idarəetmə, Управление ветеринарной клиникой), both taken unchanged from the SignInPage example; and in Navigation, Visits today (Bugünkü qəbullar, Приёмы сегодня) and Profile (Profil, Профиль), where the rail's account entry opens. Messages rewrote `error.signin` without email (the clinic code, username or password; its lock sentence waits for #20) and added `empty.visitsToday` and `signin.forgot`. Published as artifact version 23 (`1793038507-83f6`). In `packages/i18n` they are the `signin.*`, `account.*`, `role.*`, `visitsToday.title`, `empty.visitsToday.title` and `error.*` keys. In the code a practice code is still the registry's `slug` and a handle the part of `user.username` before the `@`.

Last fold: 2026-10-22, from the `/grill-with-docs` session; see domain.md's change log, `docs/adr/0001-administration-belongs-to-dispensing.md`, and `docs/research/2026-10-22-grilling-domain-terms.md` for the spec and scope edits it implies.
