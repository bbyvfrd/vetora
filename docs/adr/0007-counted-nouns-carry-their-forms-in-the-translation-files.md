---
status: accepted
date: 2026-10-26
---

# Counted nouns carry their forms in the translation files, for the design system's formatCount

Spec 0001's Translations row chose `i18next` with "Russian plural forms through the built in plural rules": a counted string as `key_one`, `key_few`, `key_many` and `key_other` variants, resolved by i18next from `Intl.PluralRules`, with the number interpolated into the sentence. The design system's grilling on 2026-10-24 made the design system's formatters the display layer for every value, counts included (spec #9, "Formatters are the display layer" and "Counts"; `docs/research/2026-10-24-grilling-next-after-0002.md`): `formatCount(count, forms)` writes the number by the design system's own number rules and picks the noun's form itself, from a `PluralForms` object with `one`, `few`, `many` and `other`, and the artifact's `formats.md` says the forms of a noun are given once, where its translation is kept. We decide: a counted noun is one key in `packages/i18n` holding an object of its forms, with what its language needs (`az` has `other` alone, since the noun does not change after a number; `ru` has `one`, `few` and `many`; `en` has `one` and `other`), read by a screen with `t(key, { returnObjects: true })` and handed to `formatCount`; i18next's plural suffixes and its interpolation of the number are not used for counts; and the translation package's key test checks every such object (`packages/i18n/src/plurals.ts`, ticket #13). This amends the rationale of spec 0001's Translations row; the row's library, its three languages and its package stand.

## Considered options

- **i18next's built in plurals** (spec 0001 as written): the suffix keys work for `az` and `ru`, whose plural rules browsers do carry; but the number inside the sentence would be i18next's interpolation, not the design system's `formatNumber` (Chrome writes 1,250.5 for Azerbaijani), the noun's forms would sit apart from the `PluralForms` shape `formatCount` reads, and a count would be set into a sentence, which the formats rule out: "Waiting: 2", never a verb agreeing with a number.
- **Forms kept in code**, beside the formatter that reads them, as the design system keeps its own age units: the words would leave the translation files, against the rule that screen text lives only in `packages/i18n`.
- **Forms objects in the translation files** (chosen): the words stay where every other word is, in all three languages, the key test proves them, and `formatCount` writes the number and the form the same way on screen and on paper.

## Consequences

- The key test treats a forms object as one key, so `az` with one form and `ru` with three compare equal; a checker names a noun missing a form its language needs, and the three languages must count the same nouns (`packages/i18n/src/index.test.ts`, with fixtures in `plurals.test.ts`).
- A forms object holds only the four forms `plural()` picks from; an object with a `zero` or `two` key is a plain group, whose keys then have to exist in all three languages like any other.
- `TranslationResource` is the type of `en.json`, so a counted noun's key types as an object: a screen reads it with `returnObjects: true`, never as a string.
- No counted noun exists yet; the first arrives with feature 5. The convention is in `packages/i18n/AGENTS.md`, and `docs/design.md` ("Formatters") records the role of `formatCount`.
