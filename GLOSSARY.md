# Glossary

This file points at the vocabulary; it does not define it.

- Model terms, their meaning, and their Russian and Azerbaijani equivalents: `docs/domain.md`, §7 Ubiquitous language and §8 Aggregates and invariants. The naming rule is §7.1. §7.4 maps what the screens say (Visit, Batch, Queue) to the model terms (Encounter, Lot, Arrival).
- UI wording in Azerbaijani, Russian, and English: `glossary.md` in the vetora design system (Claude Design System artifact; link in `docs/specs/0001-stack-architecture/rationale.md`).
- Table and column names: the data model sketch in `docs/specs/0002-data-model/index.md`.

## Terms added since domain.md

_Record a new term here (term, meaning, RU, AZ, context), then fold it into `docs/domain.md` §7 deliberately._

2026-10-24 (`/grill-with-docs`, what comes after spec 0002; `docs/research/2026-10-24-grilling-next-after-0002.md`): no new model terms. The design system glossary gained the UI rows for four terms `docs/domain.md` §7.3 already holds, Arrival (Gəliş, Явка), Authorised person (Səlahiyyətli şəxs, Доверенное лицо), Alert (Xüsusi qeyd, Особая отметка), Stock location (Saxlama yeri, Место хранения), and its Owner row now reads as PT-1 does: the client currently responsible for the patient, shown on the patient record; ownership can pass to another client. §7.4 is unchanged: on screen these terms keep their model names. Still owed: an Azerbaijani word for Estimate (slice 8) and a UI word for DispenseEvent (slice 2).

2026-10-26 (ticket #12, the shell): no new model terms. The design system glossary gained the shell's two words, Skip to content (Məzmuna keç, Перейти к содержимому) and Main navigation (Əsas naviqasiya, Основная навигация), at the end of its Navigation table, whose intro now also names the rail's own words, and the status page's three older words #11 left for this publish: API status (API vəziyyəti, Состояние API) in Navigation, Up (İşləyir, Работает) and Version (Versiya, Версия) in Forms and messages; published as artifact version 20 (`1792961737-2cad`). In `packages/i18n` they are `shell.skipToContent`, `shell.navigation` and the `health.*` keys. Still owed: an Azerbaijani word for Estimate (slice 8) and a UI word for DispenseEvent (slice 2).

Last fold: 2026-10-22, from the `/grill-with-docs` session; see domain.md's change log, `docs/adr/0001-administration-belongs-to-dispensing.md`, and `docs/research/2026-10-22-grilling-domain-terms.md` for the spec and scope edits it implies.
