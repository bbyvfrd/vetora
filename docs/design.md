# Design: what the code needs from the vetora design system

The vetora design system is a Claude Design System artifact outside the repo (https://claude.ai/artifact/1q8EqTdSMXAx7J2nh7yPYS, also linked from `docs/specs/0001-stack-architecture/rationale.md`): a brand book, the tokens, the Roboto variable font, 121 Material Symbols icons, 53 React components with their stylesheet, seven page and five document examples, and the glossary, voice, messages and formats in Azerbaijani, Russian and English. This file records what the code takes from it and how (feature 4; spec #9; ADRs 0003, 0004 and 0005): who decides each kind of thing, the tokens as CSS variables, the type classes, every component and where it lives, the print sheets, the formatters and the time zone boundary, how words flow, and the ledger of the repo's changes to the component sources. The brand book's prose is not repeated here: the rules themselves are read in the artifact (`project/README.md`, and `project/components/<Name>/README.md` for each component).

## The artifact and its version

| | |
|---|---|
| Artifact | https://claude.ai/artifact/1q8EqTdSMXAx7J2nh7yPYS, a Design System artifact; its content is the files under `project/`, its icons, logos and favicons the uploads in its asset store |
| Version copied | `1792792882-428d` (version 19), on 2026-10-24, recorded in `packages/ui/src/tokens/source.json` with the url and the date |
| What that version is | The version of every data file in the repo (`tokens.json`, the font, the icon path data, the logos and the favicon set) and the fork point of the component sources (ADR 0005) |
| The artifact since | Version 20, `1792961737-2cad`, published on 2026-10-26 by ticket #12 with five glossary rows (the shell's two words and the status page's three). Words are not files of the package, they become keys in `packages/i18n`, so the data files' version stays 19 until a data file is re-copied and `source.json` moves with it |

## Who decides what (ADR 0003, ADR 0005)

ADR 0003 vendors the artifact's sources into `packages/ui` (`@vetora/ui`), compiled by the repo's TypeScript to `dist/`, linted by Biome and tested by Vitest, on the app's own React 19; the artifact's `bundle.js` (React 18.3.1, `window.Vetora`), its `index.d.ts` and its `lib/` are not used. ADR 0005 splits the source of truth by kind from the commit that closed #11 (2026-10-26): a colour, a size, a word, an icon or a page's order of parts is decided in the artifact; how a control behaves is code, and code is the repo's.

| Kind | Decided in | In the repo | Moves by |
|---|---|---|---|
| Tokens (`project/tokens.json`) | the artifact | `packages/ui/src/tokens/tokens.json`, byte for byte; compiled to `packages/ui/styles/tokens.css` | re-copy, then `pnpm --filter @vetora/ui tokens` |
| The brand book (`project/README.md`) | the artifact | not copied; this file points at it | read there |
| Words: glossary, voice, messages, formats (`project/*.md`) | the artifact | `packages/i18n/src/locales/{az,ru,en}.json`, as keys grouped by screen | a word is added to the glossary first, then to all three locale files ("Words" below) |
| Icons (`project/assets/Icons`, 121) | the artifact | `packages/ui/src/icons.ts`, the path data generated from the set's `icons.json`; `src/Icon.tsx` draws them | re-copy of `icons.ts` with the set |
| Logos and favicons (`project/assets/Logos`, `Favicon`) | the artifact | `apps/clinic-web/src/assets/` (the reversed horizontal logo and the reversed mark), `apps/clinic-web/public/` (the favicon set and `site.webmanifest`) | re-copy from the asset store |
| The font (`project/fonts/Roboto-Variable.woff2`) | the artifact | `packages/ui/fonts/Roboto-Variable.woff2`, served from the package, so no font request leaves the origin | re-copy |
| Page and document examples (`project/components/<Page>/preview.html`) | the artifact | not copied: composition examples, not components | read there; a new screen starts from the nearest one, drafted with `/design` or handed off with "Send to local coding agent" |
| Component sources, the helpers beside them, `components.css` | the repo | `packages/ui/src/*.tsx`, `src/{format,dates,appointment,toasts,modal,util}.ts` and the repo's `src/money.ts` beside them, `src/index.ts`, `packages/ui/styles/components.css` (the artifact's `bundle.css`) | a fix is made here under the types, lint and tests, listed in the ledger below, and published up by a sync up; never copied down again |
| The repo's own | the repo | `src/tokens/compile.ts` and `write.ts`, the tests, `biome.jsonc`'s override for `packages/ui/src/*.tsx` | stay in the repo |

The two procedures, re-copying the data and publishing sources up, are in `packages/ui/README.md`. A component a screen needs and the system lacks is a repo change, synced up, not an artifact change copied down (ADR 0005).

## Tokens: the CSS variables

`packages/ui/src/tokens/compile.ts` compiles `tokens.json` to `styles/tokens.css` by the artifact type's grammar (`artifact-type/reference/format.md`, "tokens.css as compiled", mirroring the compiler the artifact's own page runs); the artifact publishes no token stylesheet, so this is what makes the component stylesheet's `var(--…)` references resolve. Colours and shadows sit under `:root, [data-theme="light"]`, the one theme (the app is light only: `color-scheme: light` in `apps/clinic-web/index.html`, and the compiler fails loudly on a second theme); everything else under `:root`. The output is committed, and `src/tokens/compile.test.ts` fails when it is stale or when the stylesheet reads a variable nothing defines. Use the semantic name (`--primary`, `--text`, `--surface-inverse`), never a brand name or a hex value, so a tuning in the artifact reaches every screen.

| Family | Variables | The rule (brand book section) |
|---|---|---|
| Brand | `--brand-sky`, `--brand-steel`, `--brand-navy` | What is fixed: three colours and the mark, never changed; every other colour derives from them |
| Action and link | `--primary`, `--primary-hover`, `--primary-pressed`, `--primary-subtle`, `--on-primary`, `--link` | Colour: one primary action per view; selected rows and active items on `primary-subtle` |
| Surfaces | `--surface-page`, `--surface`, `--surface-sunken`, `--surface-hover`, `--surface-pressed`, `--surface-disabled`, `--surface-inverse`, `--surface-inverse-hover`, `--surface-inverse-selected`, `--scrim` | Colour and States: work on `surface` over `surface-page`; `surface-sunken` for table headers and read only fields; the rail is `surface-inverse`; hover and press are overlays, not new colours |
| Borders and focus | `--border-subtle`, `--border`, `--border-strong`, `--focus-ring` | Colour and States: outline controls with `border-strong`, cards with `border`, rows with `border-subtle`; keyboard focus is a solid 2px ring with a 2px gap on every control, `on-inverse-muted` on the rail, never removed |
| Text | `--text`, `--text-secondary`, `--text-muted`, `--text-disabled`, `--on-inverse`, `--on-inverse-muted` | Colour: body, supporting, metadata and disabled text; `on-inverse` and `on-inverse-muted` on the rail |
| Status | `--success`, `--success-subtle`, `--on-success`, and the same three for `warning`, `danger` and `info`; `--danger-hover`, `--danger-pressed` | Status: four meanings, always with a word or an icon; `danger` only for what can hurt a patient or lose data |
| Categories | `--category-1` to `--category-4`, each with a `-subtle` fill | Colour: the four appointment types in the schedule and its key, never for status, never as text |
| Charts | `--chart-1` to `--chart-5`, `--chart-other`, `--chart-seq-1` to `--chart-seq-5` | Charts: series in order, "Other" in grey, one blue ramp for amounts on a scale, five series at most |
| Print | `--print-ink` | Print: receipts in black only |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Space, shape, depth: borders first; `shadow-md` for what floats, `shadow-lg` for dialogs over `scrim` |
| Spacing | `--space-1` 4px, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48, `-16` 64 | Space: inside a control `space-2` and `-3`, inside a card `-4` or `-6`, between sections `-8` |
| Radius | `--radius-sm` 4px, `-md` 8, `-lg` 12, `-xl` 16, `-full` | Shape: `md` on controls, `lg` on cards, `xl` on dialogs, `full` on pills and avatars |
| Icon sizes | `--icon-sm` 16px, `-md` 20, `-lg` 24, `-xl` 40 | Iconography: `md` in controls, menus, rows and the rail, `sm` in badges, `lg` beside a heading, `xl` in empty states; nothing in between |
| Controls and rows | `--control-sm` 28px, `-md` 36, `-lg` 44; `--row-compact` 36, `--row-default` 44; `--header-height` 56 | Layout and size: controls on one line share one height, `control-md` by default; `row-compact` for long numeric lists |
| Frame and panels | `--nav-rail` 240px, `--nav-rail-collapsed` 64; `--dialog-sm` 400, `-md` 560, `-lg` 800; `--drawer-md` 480, `-lg` 720; `--avatar-sm` 40, `-md` 56; `--content-narrow` 720, `--content-max` 1440, `--aside-column` 360 | Layout and size: the app is laid out for windows from 1024px up; content stops at `content-max`, reading text and single column forms at `content-narrow` |
| Schedule | `--schedule-slot` 24px, `--schedule-gutter` 56, `--schedule-column` 168 | Layout and size |
| Paper | `--paper-a4-width` 210mm, `--paper-a4-height` 297mm, `--paper-a5-width` 148mm, `--paper-a5-height` 210mm, `--paper-receipt-width` 72mm, `--paper-margin` 15mm, `--paper-margin-sm` 10mm | Layout and size, and "Print" below |
| Layers | `--z-sticky` 10, `--z-dropdown` 1000, `--z-scrim` 1100, `--z-dialog` 1200, `--z-toast` 1300, `--z-tooltip` 1400 | Depth: stack floating layers with the `z-` tokens in their order, never a number |
| Font | `--font-sans` (Roboto, then the system stack), and the `@font-face` for the packaged `Roboto-Variable.woff2`, weights 100 to 900, `font-display: swap` | Type: one family, weights 400, 500 and 600 only |
| Motion (`styles/components.css`, not tokens) | `--motion-fast` 120ms, `--motion-base` 200ms, `--motion-slow` 280ms, `--motion-ease`; the three durations become 0 under reduced motion | Motion: only to confirm a change; nothing moves to decorate |

## Type: the style classes

One class per type style, from the type groups of `tokens.json`, all on `--font-sans`:

| Class | Size / line height | Weight | Use (brand book, Type) |
|---|---|---|---|
| `.display` | 32 / 40 | 600, letter spacing −0.01em | a single dashboard figure |
| `.h1` | 24 / 32 | 600 | one per screen, the page's title in its header |
| `.h2` | 20 / 28 | 600 | sections |
| `.h3` | 16 / 24 | 600 | card titles |
| `.body-lg` | 16 / 24 | 400 | long reading, such as clinical notes |
| `.body` | 14 / 20 | 400 | the default for the app |
| `.body-strong` | 14 / 20 | 500 | emphasis within body text |
| `.label` | 13 / 16 | 500 | labels and buttons |
| `.label-sm` | 12 / 16 | 600 | table column headers and badges |
| `.caption` | 12 / 16 | 400 | helper text; the smallest size, 9 pt on paper |

Tabular figures (`font-variant-numeric: tabular-nums`) wherever numbers stack. Sentence case everywhere and no all caps transform: Azerbaijani i/İ and ı/I break under one. The root element's `lang` follows the chosen language (`apps/clinic-web/src/i18n.ts`), so casing and hyphenation follow it too.

## Components

Every component the artifact's index exported at the fork point is compiled from `packages/ui/src/` and exported from `@vetora/ui`, name for name; `packages/ui/src/index.test.ts` holds the list, and the repo's additions beside it. Each component's own rules are in the artifact's `components/<Name>/README.md` (ScheduleKey under Schedule, StatGroup under Stat) and its props in the source's JSDoc. Every word a component shows is a prop, passed translated from `packages/i18n`; the few English defaults (`closeLabel` on Dialog, Drawer, Banner, Toast and PrintPreview, `clearLabel` on Combobox, `labels` on DatePicker) are always passed in the interface language. Nothing restyles a component from outside and nothing rebuilds one by hand; the web app's own CSS is layout glue. The clinic components do no clinical or financial reasoning: ranges, due dates and amounts are given to them.

| Component | Source in `packages/ui/src/` | Brand book rule (Components, and the section named) | In the app today |
|---|---|---|---|
| `Icon` | `Icon.tsx`, path data in `icons.ts` | Iconography: one meaning, one icon, from the set's README; outline by default, filled for a selected state or a status badge; drawn in the current text colour | the rail's items and the status badges, through their components |
| `Button` | `Button.tsx` | Actions: one `primary` per view; `danger` only in the confirming step | the status page's "Try again", through `Banner` |
| `TextField` | `TextField.tsx` (the field frame in `Field.tsx`) | Forms: a visible label above every field; invalid is a `danger` border and one sentence after the person leaves the field | — |
| `TextArea` | `TextArea.tsx` | Forms: as a text field, for long text | — |
| `Select` | `Select.tsx` | Forms: up to about fifteen fixed options | the language switch, `apps/clinic-web/src/routes/__root.tsx` |
| `Combobox` | `Combobox.tsx` | Forms: longer lists and anything from the database; its search ignores capitals and Azerbaijani letters | — |
| `DatePicker` | `DatePicker.tsx` | Forms: a date typed or picked, held as `YYYY-MM-DD` | — |
| `TimePicker` | `TimePicker.tsx` | Forms: the 24 hour clock in every language | — |
| `Checkbox` | `Checkbox.tsx` | Forms: saved with the form | — |
| `RadioGroup` | `RadioGroup.tsx` | Forms: two to five options, all visible | — |
| `Switch` | `Switch.tsx` | Forms: takes effect at once | — |
| `Badge` | `Badge.tsx` | Status: a state inside a row or header; the `-subtle` ground with the status colour as text, always with a word or an icon | the status page's "Up", `apps/clinic-web/src/pages/StatusPage.tsx` |
| `Banner` | `Feedback.tsx` | Status and Pages: a message that stays with the page, first in the body; a failed load is a `danger` banner saying what could not be loaded, with "Try again" | the status page's failed state |
| `Toast` | `Feedback.tsx` | Status: confirms what was just done; shown through `toast()` in the page's `Toaster` | — |
| `EmptyState` | `EmptyState.tsx` | Status and Pages: says what is missing and offers the way forward; a failure is never an empty list | — |
| `Skeleton` | `Skeleton.tsx` | Status and Pages: in the shape of what is coming, the region `aria-busy`; nothing jumps when the data arrives | the status page's loading state |
| `Tooltip` | `Tooltip.tsx` | Overlays: names an icon only button | — |
| `Menu` | `Menu.tsx` | Overlays: a row's secondary actions | — |
| `Dialog` | `Dialog.tsx` (the modal hook in `modal.ts`) | Overlays: a decision or a short form, `dialog-sm`, `-md` or `-lg` | — |
| `Drawer` | `Drawer.tsx` | Overlays: one record opened beside its list, `drawer-md` or `-lg` | — |
| `Card` | `Card.tsx` | Layout: one subject on the page; cards never nest | — |
| `Table` | `Table.tsx` | Data: every list that is scanned and compared; numbers right aligned in tabular figures | — |
| `Pagination` | `Pagination.tsx` | Data: under a long table | — |
| `Tabs` | `Tabs.tsx` | Navigation: the views of one record | — |
| `AppShell` | `Layout.tsx` | Layout and size: the frame of every signed in screen, the rail on the left and the page beside it, a skip link first | the root route, `apps/clinic-web/src/routes/__root.tsx` |
| `PageBody` | `Layout.tsx` | Layout and size: the content area and its columns, on `surface-page` with `space-6` padding | every page, `StatusPage.tsx` |
| `FilterBar` | `Layout.tsx` | Layout: above a table or the schedule | — |
| `FormSection` | `Layout.tsx` | Layout: a titled group of fields on a form or settings page | — |
| `FormActions` | `Layout.tsx` | Layout and Pages: a form's buttons held at the bottom; on a form the one primary action is there | — |
| `DetailList` | `Layout.tsx` | Layout: facts that are read, not edited | — |
| `AuthLayout` | `Layout.tsx` | Layout: the pages before sign in | — |
| `NavRail` | `NavRail.tsx` | Navigation and Colour: the places in the app, on `surface-inverse`; the current item filled and `aria-current`; routed places only (spec #9) | the root route |
| `PageHeader` | `PageHeader.tsx` | Navigation: the title (the one h1) and the actions of a page, on `surface` | every page, `StatusPage.tsx` |
| `Schedule` | `Schedule.tsx` | Clinic and Appointments: the day by vet and the week by day; a type is its category colour, a state its icon and edge, never sharing a colour | — |
| `ScheduleKey` | `Schedule.tsx` | Clinic and Colour: the key to the schedule's category colours | — |
| `PatientHeader` | `PatientHeader.tsx` | Clinic: at the top of everything about one patient, in place of a `PageHeader` | — |
| `VisitNote` | `VisitNote.tsx` | Clinic: the record of a visit | — |
| `Timeline` | `Timeline.tsx` | Clinic: vaccinations and visits in order | — |
| `LabResults` | `LabResults.tsx` | Clinic and Status: results against their ranges; out of range is `danger` with an arrow and the word, in range is unmarked | — |
| `InvoiceTable` | `InvoiceTable.tsx` | Clinic: the lines and totals of an invoice, given to it, never computed by it | — |
| `PrintPreview` | `Print.tsx` | Print: nobody prints what they have not seen | — |
| `PrintSheet` | `Print.tsx` | Print: one document at the size of its paper | — |
| `Letterhead` | `Print.tsx` | Print: the clinic's identity at the top of an A4 or A5 document, never Vetora's | — |
| `PrintSection` | `Print.tsx` | Print: each titled part of a document, moved to the next page whole unless `breakable` | — |
| `SignatureBlock` | `Print.tsx` | Print: at the foot of a document, with room for a round stamp | — |
| `Receipt` | `Print.tsx` | Print: the whole of a receipt, one narrow column in black | — |
| `BarChart` | `Charts.tsx` | Charts: amounts by category, or the parts of a whole | — |
| `LineChart` | `Charts.tsx` | Charts: change over time | — |
| `BarList` | `Charts.tsx` | Charts: a ranking | — |
| `HeatGrid` | `Charts.tsx` | Charts: amounts by day and hour | — |
| `Stat` | `Charts.tsx` | Charts: one number, its change under it with an arrow and a sign | — |
| `StatGroup` | `Charts.tsx` | Charts: headline numbers together | — |
| `Toaster` | `Toaster.tsx` (the queue in `toasts.ts`) | Components: the one toaster on the page, which queues and times toasts: 5 seconds for a confirmation, 10 with an action, until closed for a warning or a failure | — |

Beside the components, the package exports `toast` and `dismissToast` (`toasts.ts`), `appointmentBadge` (`appointment.ts`: the seven appointment states, each with one colour and one icon, the same in a table, a drawer and the schedule), the formatters of `format.ts` and the repo's `formatMinorUnits` ("Formatters" below). `cx` (`util.ts`) and `useModal` (`modal.ts`) are internal.

## Pages

Every signed in screen is one of seven pages, each a working example in the artifact (`components/<Page>/preview.html`, with its order of parts in the README beside it), and a new screen starts from the nearest one and keeps that order: `SchedulePage`, `ListPage`, `RecordPage`, `VisitPage`, `FormPage`, `SettingsPage` and `DashboardPage`; before sign in, `SignInPage`. A page is an `AppShell` holding, in order, a header (`PageHeader`, or `PatientHeader` where the page is about one patient), a `PageBody`, and on forms and settings `FormActions`; one h1, in the header; one primary action, in the header or, on a form, in the bar at the bottom. A page that shows data has four states, each looking different from the others: loaded (the content); loading (the frame, the header and every heading at once, a `Skeleton` in the shape of what is coming, the region `aria-busy`, nothing jumping when the data arrives); empty (an `EmptyState` that says what is missing and offers the way forward; filters that match nothing stay, with an offer to clear them); failed (a `danger` `Banner` first in the body that says what could not be loaded and offers "Try again", never an empty list). The status page (`apps/clinic-web/src/pages/StatusPage.tsx`), the first page on the shell, shows three of them: it has nothing to be empty of. After signing in people land on the schedule; until sign in exists the status page is the home route. The examples are not components and are not copied (spec #9, "Out of scope"): they are read in the artifact, or handed to a session with "Send to local coding agent".

## Print (ADR 0004)

The print components are compiled with the rest and are the one implementation of each document: drafts and on screen printing go through the browser's print dialog from a `PrintPreview`, as designed, and from feature 14 the API's worker renders the same sheet to a stored PDF with a headless Chromium pinned through Playwright (ADR 0004; `@react-pdf/renderer` is dropped). Nothing renders a PDF today.

| `PrintSheet paper` | The sheet on screen | `@page` rule in `components.css` | Used for |
|---|---|---|---|
| `a4` (the default) | 210 × 297 mm, padding `--paper-margin` 15 mm | `vt-a4`: size A4, margin 15 mm, page numbers "1 / 2" at the bottom right | invoices, certificates, discharge summaries |
| `a5` | 148 × 210 mm, padding `--paper-margin-sm` 10 mm | `vt-a5`: size A5, margin 10 mm | prescriptions |
| `receipt` | 72 mm wide (`--paper-receipt-width`, the printable width of an 80 mm roll), `--print-ink` black only | `vt-receipt`: margin 0 and no size, since the receipt printer's driver sets the paper and cuts where the receipt ends | receipts |

The five documents that leave the clinic on paper (brand book, Print), each a working example in the artifact's `components/<Name>/preview.html` with its order of parts in the README beside it, none a component of the package:

| Document | Example | Paper | Title in Azerbaijani, Russian, English |
|---|---|---|---|
| Invoice | `InvoiceDocument` | A4 | Hesab-faktura, Счёт, Invoice |
| Receipt | `ReceiptDocument` | 80 mm roll | Qəbz, Чек, Receipt |
| Prescription | `PrescriptionDocument` | A5 | Resept, Рецепт, Prescription |
| Vaccination certificate | `VaccinationDocument` | A4 | Peyvənd arayışı, Справка о вакцинации, Vaccination certificate |
| Discharge summary | `DischargeDocument` | A4 | Çıxarış, Выписка, Discharge summary |

A document is a `PrintSheet` holding a `Letterhead`, then `PrintSection`s, then a `SignatureBlock`; a receipt is a `PrintSheet` holding one `Receipt`. The browser flow: `PrintPreview` shows the sheets at their real size on a grey ground with the print button and marks the page (`vt-has-preview` on the root element) so that printing it prints the sheets alone; its button sets the document title to `fileName` (the browser names a saved PDF after it) and calls `window.print()`, or `onPrint` in its place. Any page of the app prints as it stands: the rail, buttons, tabs and filters stay off the paper by themselves, `vt-no-print` keeps anything else off, `vt-print-only` shows something only there. Paper has no fills or shadows, tables and badges drop theirs inside a sheet, and a document reads the same from a black and white printer. A document is printed in the client's language, which is often not the app's: the sheet takes `lang`, and its numbers and money the document's locale. The state's own forms (the veterinary passport, controlled medication prescription forms, the fiscal receipt) are not replaced by these documents.

## Formatters: the display layer

The design system's formatters (`packages/ui/src/format.ts`, with the month and weekday names in `dates.ts`) write every date, time, age, duration, number, amount, count and phone number, and sort text, for screens and paper in all three languages without the browser's locale data: Chrome has none for Azerbaijani, and browsers disagree on the Russian and English forms. Nothing calls `Intl` for `az` (`CODING_STANDARDS.md`, "Screen text"). A formatter whose result depends on the language takes a `locale` and otherwise follows the root element's `lang`; the parts of a value are joined with non breaking spaces so a date, an amount or a phone number never breaks across lines. The forms themselves are the artifact's `formats.md`.

| Function | Writes | Example |
|---|---|---|
| `formatNumber(value, { decimals?, locale? })` | a number: a decimal comma and a space between thousands in Azerbaijani and Russian, a point and a comma in English, a true minus sign | 1 250,5 · 1,250.5 |
| `formatMinorUnits(amount, currency, locale?)` | an amount kept as whole minor units beside its currency (IN-4) in the money format, two decimals always; the repo's wrapper, `money.ts` | 125000 qəpik → 1 250,00 ₼ · AZN 1,250.00 |
| `formatMoney(value, locale?)` | an amount in manat: the design system's own, called by the wrapper above and, inside the package, by `InvoiceTable` and `Receipt`, whose amounts are manat numbers today | 1250 → 1 250,00 ₼ |
| `parseNumber(text)` | reads a typed number, comma or point | "1 250,5" → 1250.5 |
| `formatDate(value, { style?, locale?, relativeTo? })` | a day from `YYYY-MM-DD` or a `Date`, in six styles; yesterday, today and tomorrow as the word with `relativeTo` | 12.10.2026 · 12 Oct 2026 · 12 oktyabr 2026, bazar ertəsi |
| `formatTime(value)` | the 24 hour clock, the same in every language | 09:05 |
| `formatAge(birth, { on?, locale? })` | a patient's age as exactly as it calls for, months until the second birthday | 5 gün · 1 yaş 3 ay · 4 yaş |
| `formatDuration(minutes, locale?)` | a length of time in the glossary's units | 1 saat 30 dəq · 1 ч 30 мин |
| `plural(count, forms, locale?)`, `formatCount(count, forms, locale?)` | the form of a noun that goes with a number, and the number with it | 214 пациентов · 5 pasiyent |
| `formatPhone(text)` | a phone number the one way it is shown, from however it was typed | +994 50 123 45 67 |
| `compareText(a, b, locale?)` | an order for sorting: the Azerbaijani alphabet (ç after c, ə after e, x after h, ı before i, q after k), which browsers do not know | Cavid, Çingiz, Elçin, Əli |

**Money** (IN-4; spec 0002 AC-9; `CODING_STANDARDS.md`, "Money and time"): money is stored and carried as integer minor units beside a currency code, and a float never enters storage. `formatMinorUnits` in `packages/ui/src/money.ts` is the one place minor units become a displayed amount: it takes a `number` or a `bigint` (how a 64-bit column leaves the database) and the currency, hands the design system's `formatMoney` the amount in manat it expects, and throws rather than show a wrong figure for an amount that is not a whole number of minor units, one too large to show exactly, or a currency the design system has no format for (AZN is the one it has). No other code divides money, and a review checks it; `packages/ui/src/money.test.ts` proves the formats, the sign, zero, a `bigint`, the default locale and the refusals. One gap stands: `InvoiceTable` and `Receipt` take their amounts as manat numbers (`InvoiceLine`, `InvoiceTotal`, `ReceiptLine`, `ReceiptAmount`) and call `formatMoney` themselves, so a screen could feed them only by dividing. Before the first invoice screen (feature 5) they are changed in the repo to take minor units with a currency and format through the wrapper, a repo change synced up ("Not yet" below); until then no screen passes them an amount.

**Time** (`docs/domain.md` §10; spec 0001, "Time and money"): an instant is stored in UTC (`timestamptz`) and shown in the practice's time zone (`Asia/Baku` today, which has observed no daylight saving since 2016; never baked in, since CIS expansion brings other zones). The formatters are not the boundary: `formatDate` reads a `YYYY-MM-DD` string as the day it names and a `Date` through its local getters, and refuses a timestamp string on purpose, because which day an instant falls on depends on the zone; `formatTime` reads a `Date`'s local hours and minutes. So a UTC instant is converted to the practice's wall clock before a formatter sees it, with `date-fns` v4 and `@date-fns/tz` (a `TZDate` in the practice's zone, or a day string computed in it), never with `new Date(instant)` straight from the API; and business dates (the day a visit, a payment or a stock count belongs to) are computed in the API, in the practice's zone, and travel as dates. `date-fns` and `@date-fns/tz` are installed when the first screen shows an instant; the boundary is decided now.

**Counts** (ADR 0007): a counted noun's forms live as an object under one key in the translation files, holding what the language needs (`az`: `other`; `ru`: `one`, `few`, `many`; `en`: `one`, `other`), read with `t(key, { returnObjects: true })` and handed to `formatCount`; the translation package's test checks every such object (`packages/i18n/AGENTS.md`). No screen calls a formatter yet: the status page shows a version string as it comes, and the first dates, amounts and counts arrive with feature 5.

## Words

The design system glossary (`project/glossary.md`, with `voice.md`, `messages.md` and `formats.md` beside it) owns every word a screen, a message or a printed document uses, in all three languages; `docs/domain.md` §7.4 maps the ones that differ from the model's identifiers (a screen says Visit, the code says `Encounter`), and `GLOSSARY.md` at the root points at both. Words flow one way, from the glossary into `packages/i18n`:

1. A screen needs a word. If the glossary has it, it is used as written, in all three languages; the synonyms the glossary rules out stay out.
2. If the glossary lacks it, it is added there first, in Azerbaijani, Russian and English, with the Azerbaijani and Russian confirmed by you, and published to the artifact (read the artifact by its url with the Artifact tool, edit `project/glossary.md` in the saved copy, publish it back; ticket #12 did this for the shell's words, which made version 20). `GLOSSARY.md`'s "Terms added since domain.md" section records the words and the artifact version; a new model term is folded into `docs/domain.md` §7 deliberately, by hand.
3. The word becomes a key in `az.json`, `ru.json` and `en.json` in the same change, grouped by screen or concept (`health.title`, `shell.skipToContent`), and reaches the component as a prop. `packages/i18n/src/index.test.ts` proves every key exists in all three languages; `en.json` is the typed source of the keys.

Confirmations, problems, field errors, questions, empty states and messages to clients take their wording from `messages.md` as written, and a message that is not there is added there first, the same way. A counted noun is one key holding its forms ("Formatters" above). The keys today: `app.name`, `health.*` (the status page's five words), `language.label`, and `shell.skipToContent` and `shell.navigation`. Still owed to the glossary (noted in `GLOSSARY.md`): an Azerbaijani word for Estimate (slice 8) and a UI word for DispenseEvent (slice 2).

The language switch sits in the rail's footer until feature 5 brings the account entry: the design puts the language choice in the signed in person's profile and on the sign in page (`SignInPage`), and the rail's footer is its temporary home, so that a shared computer's language can be changed today ("Beside the ledger" below).

## The ledger: the repo's changes to the component sources

The fork point is version `1792792882-428d`, copied on 2026-10-24 (#10: `Button`, `Icon`, `icons.ts`, `util.ts`) and on 2026-10-26 (#11: every other file). Since the commit that closed #11 the sources are the repo's (ADR 0005), and every change to them is listed here with the date it reached the artifact or marked pending. Checked on 2026-10-26 against the artifact's version 20: none has reached it yet; its `components/src/*` are still the fork point's files. The first sync up is ticket #15, blocked by this one.

| Change | Where | Ticket, date | In the artifact |
|---|---|---|---|
| The mechanical conformance pass: relative imports carry `.js` (the package builds on the Node module settings with the DOM libs and `react-jsx`, so its output runs in Vite today and in the worker later); imports used only as types are `import type` (`verbatimModuleSyntax`); Biome's format (no semicolons, single quotes, trailing commas, lines wrapped at 120); class names and ids built with template literals (`useTemplate`); `a && a.b` and `cb && cb(x)` written `a?.b` and `cb?.(x)` (`useOptionalChain`); `Number.isFinite` and `Number.isNaN` for the globals (their coercion of non numbers is the one difference, unreachable under the declared `number` and `Date` types); `Math.pow(10, …)` written `10 ** …` (`useExponentiationOperator`, `Charts.tsx`); unused catch bindings and callback parameters renamed with an underscore; `Icon`, `LabResults` and `Skeleton` drop their unused `React` namespace imports; the export lines of `index.ts` in Biome's order. No behaviour changed | every file of `src/` | #10, 2026-10-24; #11, 2026-10-26 | pending. What the published sources carry is #15's to settle: the artifact's bundler reads `./util` without `.js` and its sources keep semicolons, so either the sync strips the suffixes and the format or the artifact takes them |
| React 19 types: `useOutside` (`Field.tsx`), `useWidth` (`Charts.tsx`) and the date picker's `close` take a `React.RefObject<HTMLElement \| null>`, the type `useRef(null)` now has; `Menu` and `Tooltip` read the element they clone through a cast to its ARIA and `onClick` props, since React 19 types an element's props as `unknown` | `Field.tsx`, `Charts.tsx`, `DatePicker.tsx`, `Menu.tsx`, `Tooltip.tsx` | #11, 2026-10-26 | pending |
| Three rewrites with the same effect, for rules the code genuinely trips and that have no automatic fix: the time picker's clock button handler is a block instead of a comma expression (`noCommaOperator`); `emit` in `toasts.ts` and the schedule's lane `close` loop use `for … of` instead of a `forEach` whose callback returned a value (`useIterableCallbackReturn`) | `TimePicker.tsx`, `toasts.ts`, `Schedule.tsx` | #11, 2026-10-26 | pending |
| `AppShell`'s skip link focuses the page itself when activated (`preventDefault`, then `main.focus()`) instead of leaving the jump to the browser's fragment navigation, which jsdom does not perform and browsers perform unevenly. The first behaviour change | `Layout.tsx` | #12, 2026-10-26 | pending (version 20's `Layout.tsx` has the plain fragment link) |
| `formatMinorUnits`, the money wrapper: whole minor units with a currency to the money format (IN-4), exported beside the formatters | `money.ts` (new), `index.ts` | #13, 2026-10-26 | pending |

Repo only, never synced: `styles/tokens.css` with `src/tokens/compile.ts` and `write.ts` (the artifact publishes no token stylesheet; the compiler handles the one theme and fails loudly on a second theme, an alias to a missing colour or an unknown font format, where the artifact's page would drop the value silently); the tests; `biome.jsonc`'s override turning eleven rules off for `packages/ui/src/*.tsx` only (`noArrayIndexKey`, `noExplicitAny`, `useExhaustiveDependencies`, and the a11y rules `noAriaHiddenOnFocusable`, `noNoninteractiveElementToInteractiveRole`, `noNoninteractiveTabindex`, `noStaticElementInteractions`, `useAriaPropsForRole`, `useFocusableInteractive`, `useKeyWithClickEvents`, `useSemanticElements`: each reads a pattern the components use on purpose as a fault, so they are off in the config rather than suppressed in the files, and are the repo's to turn back on as each component is fixed; the package's test files keep every rule); `package.json` and the tsconfigs. The artifact's `bundle.js`, `index.d.ts` and `lib/` are not used.

## Beside the ledger: where the app departs from the design today

Not changes to a source, but compositions in `apps/clinic-web` that a later session should know are deliberate, recorded by ticket #12:

- The language switch is a `Select` in the rail's footer, until feature 5's account entry takes the language choice to the profile, where the design puts it (and to the sign in page). Its focus ring on the navy rail is the component's `focus-ring` (3.44:1 against `surface-inverse`, above the 3:1 bar) where the brand book names `on-inverse-muted` for controls on `surface-inverse`; it goes with the switch's temporary home, and would be a repo fix to `components.css`, synced up, if a control ever stays on the rail.
- The rail item for the status page takes the `info` icon, whose assigned meaning, Information, is what the page is: nothing in the set means a health check, and a dedicated icon would be an artifact change (the set is the artifact's).
- An unknown URL shows the router's default English "Not Found" inside the shell: a not found page is a page beyond the status page, and its words are not in the glossary; a ticket of its own.
- `favicon.ico` is not generated: every link tag the favicon README gives is in place, and the README's `.ico` line is a server matter for the hosted deploy.

## Checks

- **Seam 1, the web app in a DOM** (`apps/clinic-web/src/app.test.tsx`, `src/pages/StatusPage.test.tsx`; jsdom, Testing Library, user-event, vitest-axe): the real route tree with the real translations; the named rail with its one routed place marked current, the skip link first in the tab order and focusing `main`, the h1 before the body, each language changing every word, `lang` and the stored choice, the status page's three states (loading, failed, loaded; it has nothing to be empty of), and axe with no violations in each language (colour contrast left to seam 2, since jsdom has no canvas; `document-title` left out, the title being in `index.html`).
- **Seam 2, the tokens as data** (`packages/ui/src/tokens/compile.test.ts`, `contrast.test.ts`): `tokens.css` equals what the compiler produces from `tokens.json` and reads only variables that are defined; and WCAG 2 contrast from relative luminance over the colour tokens for every pair the brand book names, 4.5:1 for text and 3:1 for controls and chart series: `text`, `text-secondary` and `text-muted` on `surface`, `surface-page` and `surface-sunken`; `on-primary` on `primary`, `primary-hover` and `primary-pressed`; `on-inverse` and `on-inverse-muted` on `surface-inverse`; each of `success`, `warning`, `danger` and `info` on its `-subtle` ground and its `on-` colour on the solid fill; `link` on `surface`; at 3:1, `border-strong` and `focus-ring` on `surface` and `chart-1` to `chart-5` on `surface`. A pair that fails is fixed in the artifact's tokens and re-copied, never dropped; a component fault is fixed in the repo (ADR 0005).
- **The package's own**: `packages/ui/src/index.test.ts` (the public surface is the artifact's index at the fork point plus the ledger's additions, and the print components are exported), `money.test.ts` (above).
- **Words**: `packages/i18n/src/index.test.ts` and `plurals.test.ts` (every key in three languages, the same counted nouns, each with its forms).
- **By hand**: the tablet check at 1024 by 768, recorded on ticket #12: the rail 240px, the header 69px with the h1 at 24/32, the body padding 24px, no horizontal scroll, the skip link, the rail item and the select each 36px tall (`control-md`) with a 2px ring and a 2px gap.
- **CI** (`.github/workflows/ci.yml`): `pnpm lint`, build and typecheck, the migration order, the OpenAPI diff, and `pnpm test` with the compose Postgres; the root `test` script builds `@vetora/ui` before Vitest, beside `contracts` and `i18n`.

## Not yet

- `date-fns` and `@date-fns/tz`: installed with the first screen that shows an instant (feature 5).
- The first counted noun in the translation files (feature 5).
- `InvoiceTable` and `Receipt` taking minor units with a currency and formatting through `formatMinorUnits`, so that no screen divides money to feed them: a repo change before the first invoice screen (feature 5), synced up.
- Rendering a sheet to a stored PDF in the worker (feature 14, ADR 0004).
- The first sync up of the sources to the artifact (ticket #15; the ledger's open questions settle there), and the step of turning the eleven Biome rules back on component by component.
- A not found page, a collapsed rail, the account entry and the language choice's final home (feature 5).
- New components, and token, word or icon changes: a component is a repo change synced up; a token, a word or an icon is made in the artifact and re-copied (ADR 0005).
