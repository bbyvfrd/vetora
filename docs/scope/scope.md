# Scope: vetora

Practice management software for companion vet clinics in Azerbaijan, Baku first and then CIS countries: outpatient visits, a стационар, pharmacy and retail counter, in house lab, grooming, and boarding under one roof. The pilot release (slices 1 to 7) is built around one design partner clinic.

**Build approach:** Tracer Bullet (thin vertical slices, each working end to end through every layer before the next one starts).
**Workflow:** Beta (after `/develop`: `/check verify`, then `/test`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· GA`) to do more or less; the seven features where a bug becomes a legal or money problem carry `· GA` (basis: the domain.md §8 rules those features enforce).
**Domain model:** [`docs/domain.md`](../domain.md) is the source of truth for terms, the numbered rules cited below (CR-1, RX-3, BL-6, …), and the open questions (OPEN-n). Interviews with Baku vets close OPEN-1, 4, 9, 10, 11, 12; a local lawyer or accountant closes OPEN-2, 3, 5, 6, 7, 8. Features name the ones they lean on.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | in-progress |
| 2 | Coding standards & tooling | Foundation | planned |
| 3 | Data model | Foundation | in-progress |
| 4 | Design system & UI foundation | Foundation | planned |
| 5 | First visit from arrival to payment | Slice 1 | planned |
| 6 | Prescribe and dispense from stock | Slice 2 | planned |
| 7 | Controlled drug register | Slice 2 | planned |
| 8 | Payments and client debt | Slice 3 | planned |
| 9 | Stock receiving and counts | Slice 4 | planned |
| 10 | Counter sales | Slice 4 | planned |
| 11 | Bookings and waiting room | Slice 5 | planned |
| 12 | Patient chart | Slice 6 | planned |
| 13 | Vaccinations and due list | Slice 6 | planned |
| 14 | Client printouts | Slice 6 | planned |
| 15 | Practice settings | Slice 7 | planned |
| 16 | Client and pet import | Slice 7 | planned |
| 17 | Owner daily view | Slice 7 | planned |
| 18 | Monitoring and backups | Slice 7 | planned |
| 19 | Estimates and consent | Slice 8 | planned |
| 20 | Admissions and treatment sheet | Slice 8 | planned |
| 21 | Ward board and handover | Slice 8 | planned |
| 22 | Lab orders and results | Slice 9 | planned |
| 23 | Grooming | Slice 10 | planned |
| 24 | Boarding | Slice 10 | planned |

## Foundations

Stack, standards, data model, and design system come before any slice (basis: foundations before features).

### 1. Stack & architecture · in-progress
Decide the whole stack once, then scaffold a runnable project. The decision covers hosting (including where clinic data may legally live, a question for your lawyer), data store and backups, sign in, file storage, translation, printing, and monitoring, so later features install their own pieces without new tool decisions.
**Done when:** the stack is recorded in a spec, and an empty project boots locally and deploys once to a hosted environment.
- [x] Decide the stack (spec): `/architect stack & architecture`
- [ ] Scaffold from the decision: `/develop stack & architecture`
- [ ] Verify it: `/check verify stack & architecture`
- [ ] Test it: `/test stack & architecture`
[Spec 0001](../specs/0001-stack-architecture/index.md)

### 2. Coding standards & tooling
Capture conventions and tooling from the real scaffolded project, then install lint, format, and pre commit checks.
**Done when:** root `AGENTS.md` reflects the real stack and treats the domain.md rule IDs as shared vocabulary for code, tests, and reviews; lint, format, and pre commit run clean.
- [ ] Capture conventions + tooling choices: `/audit`
- [ ] Install the tooling: `/develop tooling`
- [ ] Check it runs clean: `/test`

### 3. Data model · in-progress · GA
Turn domain.md's 13 contexts and 36 rules into the persistence shape: modules inside one deployable, every record aware of its location from day one (IN-5), money as whole minor units with a currency (IN-4) (basis: the data model is the costliest thing to redo).
**Done when:** the entities cover every planned slice without a breaking migration, and the hard rules (finalised visits append only CR-1, dispense and stock movement in one transaction RX-3, debt derived from a ledger BL-6, ownership over time PT-1, weight as a dated observation PT-2) hold in the data layer itself, not only in screens.
- [x] Design it (spec): `/architect data model`
- [ ] Build it: `/develop data model`
  - [ ] Migration sets, the extensions schema, domains, and the shared functions (AC-8, AC-9, AC-13)
  - [ ] Foundation tables with audit, the table classes, and the grants pass (AC-1, AC-8, AC-9, AC-12)
  - [ ] The migrate and provision-practice commands with a role per practice (AC-10, AC-11)
  - [ ] Isolation and rule proofs on two local practices written to verify.md, plus the schema module skeleton (AC-1, AC-8, AC-10, AC-11)
- [ ] Verify it: `/check verify data model`
- [ ] Test it: `/test data model`
- [ ] Review it (fresh model): `/check review data model`
- [ ] Document it: `/document data model`
[Spec 0002](../specs/0002-data-model/index.md)

### 4. Design system & UI foundation · needs a decision
Visual language and base components for reception desktops and ward tablets, translation ready in Russian and Azerbaijani, with print layouts for client documents.
**Done when:** `design.md` covers type, color, spacing, components, and print; base components work by keyboard and by touch with readable contrast; no screen text lives outside the Russian and Azerbaijani translation files.
- [ ] Design it (spec): `/architect design system & UI foundation`

## Slice 1: Core loop

The thinnest real thread through a clinic day, and the walking skeleton for everything after it (basis: tracer bullet development).

### 5. First visit from arrival to payment · needs a decision · GA
A vet signs in, registers a walk in client and pet, records the weight, writes and finalises the visit note, invoices it, and takes a payment. Real sign in and real data; no bookings, stock, or printing yet. The note follows the Russian structure (анамнез, статус, диагноз, назначения) until the interviews settle OPEN-10.
**Done when:** a vet completes a walk in visit end to end in Russian or Azerbaijani; the finalised note is locked (CR-1) and only a vet can finalise it (CR-2); a note in progress survives a dropped connection; a part payment leaves the rest as client debt (BL-5); every action records who did it (IN-1).
- [ ] Design it (spec): `/architect first visit from arrival to payment`

## Slice 2: Medicines

Where clinical decisions become stock movements and legal records at the same moment, so it comes right after the core loop (basis: domain.md §6.1, Prescription & Dispensing is a core context).

### 6. Prescribe and dispense from stock · needs a decision · GA
The vet prescribes with a dose worked out from today's weight, and the clinic dispenses from a specific lot; the stock drop and the charge happen in the same step. Lots are entered by hand for now.
**Done when:** a dispense without lot and expiry cannot be saved (RX-1); dispensing lowers that lot's stock in the same transaction (RX-3); a dose keeps the weight and concentration it was worked out from (RX-5, PT-2); the line lands on the visit's invoice.
- [ ] Design it (spec): `/architect prescribe and dispense from stock`

### 7. Controlled drug register · needs a decision · GA
An append only register for controlled drugs, built in from the start on domain.md's interim rule (required, per administration, one signature, kept 7 years) until your lawyer answers OPEN-5 (basis: domain.md §5.5, relaxing a strict log later is cheap and retrofitting one is not).
**Done when:** every controlled dispense or administration writes a register entry that cannot be edited or deleted and ties back to a finalised visit (RX-2, RX-4); the register prints per drug for an inspection.
- [ ] Design it (spec): `/architect controlled drug register`

## Slice 3: Money at the desk

Cash, part payments, and running debt are everyday events here, not edge cases (basis: domain.md §4.2).

### 8. Payments and client debt · needs a decision · GA
Make front desk money real for a cash market: part payments, running client debt (долг, borc) across visits, paying off old debt, the fiscal receipt number from the clinic's own cash register, and fixing mistakes without deleting anything.
**Done when:** a client's debt is the sum of an append only ledger (BL-6); one payment can settle several invoices; each invoice can carry the clinic's receipt number while receipts stay a separate record (BL-4, OPEN-7); corrections are new entries, never edits; the day closes with a cash and card summary.
- [ ] Design it (spec): `/architect payments and client debt`

## Slice 4: Stock and the counter

### 9. Stock receiving and counts
Receive deliveries into lots with cost and expiry, count and adjust stock with a reason, and see what is running low or expiring soon (basis: the data model and dispensing specs already decide lots and movements, so no new decision).
**Done when:** received lots are available to dispense and sell; every adjustment is a recorded movement with a reason and an author; lots near expiry and items below their minimum are listed.
- [ ] Build it: `/develop stock receiving and counts`

### 10. Counter sales
Sell food, preventatives, and accessories over the counter to a known client or to nobody at all, from the same lot tracked stock.
**Done when:** a sale needs no patient or visit (BL-1); it lowers stock by lot; it uses the same payment, debt, and receipt flow as a visit invoice.
- [ ] Build it: `/develop counter sales`

## Slice 5: Bookings

### 11. Bookings and waiting room · needs a decision
Book appointments by type and length for a vet or a room, check in arrivals, and keep walk ins and emergencies in a live queue beside the booked list.
**Done when:** the appointment type sets length and resources (RS-2); no resource can be double booked (RS-1); a booking and a visit stay separate things (SC-1); reception sees who is waiting, for whom, and since when.
- [ ] Design it (spec): `/architect bookings and waiting room`

## Slice 6: Records and documents

### 12. Patient chart · needs a decision
Find any animal by client name or phone and open one page for it: visits over time, the problem list, weight trend, attached files (lab PDFs, photos, signed consent scans), and amendments to finalised visits.
**Done when:** the problem list lives on the patient across visits (CR-6); an amendment shows author, time, reason, and the earlier text (CR-1); files attach to a patient or a visit; a rehomed or deceased animal keeps its full history (PT-1, PT-4).
- [ ] Design it (spec): `/architect patient chart`

### 13. Vaccinations and due list · needs a decision
Record vaccinations with the vaccine lot, work out when the next ones are due per species, and give reception a list of vaccinations and rechecks that are due, with the client's phone and messenger at hand. Automated messages wait for OPEN-9.
**Done when:** a vaccination records vaccine, lot, and date; due dates follow a protocol per species (PT-3); staff mark each due item as contacted, booked, or declined.
- [ ] Design it (spec): `/architect vaccinations and due list`

### 14. Client printouts
Print or save as PDF, in Russian or Azerbaijani with the clinic's letterhead: the prescription, the visit summary (выписка), the invoice, and a consent form filled in with client and pet details (basis: builds on the design system's print layouts, so no new decision).
**Done when:** each document prints in the client's chosen language from real record data; a draft prints clearly marked as a draft.
- [ ] Build it: `/develop client printouts`

## Slice 7: Pilot go live

Everything the design partner clinic needs to switch over, and the end of the pilot release (basis: your answer, front desk to checkout with one design partner clinic).

### 15. Practice settings
The owner adds staff with their own logins and roles (vet, feldsher, administrator, groomer, owner), sets the services and price list, and enters clinic details for printouts. Role scope follows domain.md's interim answer to OPEN-4.
**Done when:** every person has their own login and none are shared; changing a price never touches past invoices; prices are whole minor units in AZN (IN-4).
- [ ] Build it: `/develop practice settings`

### 16. Client and pet import · needs a decision
Bring the pilot clinic's client and pet list, plus the debts they carry, in from Excel, so go live takes a day rather than a week.
**Done when:** a preview shows matches, duplicates, and errors before anything is saved; imported debts become opening ledger entries that match the clinic's own total; a bad import can be reversed as a whole before go live.
- [ ] Design it (spec): `/architect client and pet import`

### 17. Owner daily view
One screen for the owner: today's revenue by line (visits, medicines, retail), payments by method, total client debt, stock value, and lots expiring soon.
**Done when:** every figure ties back to the ledger and stock movements behind it, and splits by location (IN-5).
- [ ] Build it: `/develop owner daily view`

### 18. Monitoring and backups
Get ready for real clinic data: error monitoring, automated backups with a rehearsed restore, and a few key events (visits finalised, items dispensed, invoices paid) (basis: the stack spec picks the tools, so no new decision).
**Done when:** a production error reaches you within minutes; a restore from backup has been rehearsed once; key events are counted per clinic.
- [ ] Build it: `/develop monitoring and backups`

## Slice 8: Стационар

The first slice after go live, and where vetora should stand out: domain.md assumes nobody in this market serves the стационар well, and it is where charges leak and handovers fail (basis: domain.md §6.1; wiki pages Missed Charge Capture and Patient Flow).

### 19. Estimates and consent · needs a decision · GA
Agree the cost with the client before a procedure or admission, and record consent as a real record: who gave it, with what standing, for what.
**Done when:** an invoice that goes over its estimate is flagged until the client agrees (BL-3); consent records subject, scope, granter and their authority, time, and the signed form (IN-2); surgery, anaesthesia, and euthanasia require one.
- [ ] Design it (spec): `/architect estimates and consent`

### 20. Admissions and treatment sheet · needs a decision · GA
The стационар core: admit a patient to a cage, run the лист назначений of scheduled orders, record each administration as given, refused, or missed, and charge as care happens.
**Done when:** an admission books a cage without owning it (HS-4); every order ends as given, refused, or missed with who and when (HS-2); each administration is charged when it happens, not at discharge (HS-3); discharge produces take home meds and a recheck.
- [ ] Design it (spec): `/architect admissions and treatment sheet`

### 21. Ward board and handover · needs a decision
A tablet board of every inpatient right now (orders due and missed, results outstanding, owner) and a handover that passes the ward from one shift to the next.
**Done when:** the next shift can see what is due for each animal without asking anyone (HS-5); handover is a recorded event saying who handed over to whom; missed orders stand out.
- [ ] Design it (spec): `/architect ward board and handover`

## Slice 9: Lab

### 22. Lab orders and results · needs a decision
Order tests from a visit or an admission, type results in by hand against reference ranges per species, and never lose a result that arrives after the client has left. Analysers stay deferred.
**Done when:** results outside the species range are flagged (PT-3); a result that arrives after the visit closed sits on a loose ends list until someone acts on it; ordered tests are charged.
- [ ] Design it (spec): `/architect lab orders and results`

## Slice 10: Grooming and boarding

Last, because both lean on bookings and on the cages the стационар already uses (basis: domain.md RS-1).

### 23. Grooming
Book groomers and tables, charge for the service, and keep it out of the medical record.
**Done when:** a groom is a booking with no visit (SC-1); grooming revenue shows in the owner daily view.
- [ ] Build it: `/develop grooming`

### 24. Boarding · needs a decision
Board healthy animals (передержка) in the same cages the стационар uses, with a feeding and medication schedule and a nightly charge. If boarders' medication turns out to need a vet's supervision, that decides whether boarding splits out (domain.md §6.6).
**Done when:** boarding and the стационар can never claim the same cage at the same time (RS-1); feeding and medication are recorded like administrations; each night is charged.
- [ ] Design it (spec): `/architect boarding`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest. domain.md §11 lists what is out of scope on purpose (pet insurance, large animals, mobile vets, referrals, telemedicine, FHIR).
- **Automated client messaging**: reminders and results by WhatsApp, Telegram, or SMS, once OPEN-9 is answered · needs a decision
- **Fiscal receipts from vetora**: issue receipts directly, once OPEN-7 is answered · needs a decision · GA
- **Lab analyser integration**: results straight from the clinic's machines · needs a decision
- **Imaging**: X ray and ultrasound images (DICOM) on the record · needs a decision
- **Landing page**: a Russian and Azerbaijani site for when you look for clinic number two · needs a decision
- **Free vet calculators**: dose and fluid calculators as lead generation · needs a decision
- **Signup and subscription billing**: self serve onboarding and charging clinics, once pricing is chosen · needs a decision · GA
- **Client portal and online booking** · needs a decision
- **Managing several locations**: the data knows its location from day one; the screens come later · needs a decision
- **Exotics**: clinical support for rabbits, birds, and reptiles, if OPEN-11 says they are routine · needs a decision
- **AI scribing**: deferred on purpose until the record model is proven in use (domain.md §11) · needs a decision · GA
- **Full product analytics**: usage tracking beyond the key events · needs a decision
- **Pet owner app**: an iOS and Android app (Expo) where owners follow their pets' records, vaccinations, and due dates across clinics, signing in with a phone code; overlaps the client portal above · needs a decision · from spec 0001

## Legend

**The decision box.** A feature that needs a decision carries exactly one: the box whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills find it by that `(spec)` ending, never by an exact label. Every other box is an execution box, and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `planned` | `/scope` | one box: `Build it: /develop <feature>` (or `/audit` for standards & tooling) |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` with **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha and up, `Test it` Beta and up, `Review it` and `Document it` GA); any follow up it surfaced enrolled |
| `in-progress` (building) | `/develop` | milestone boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` and milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` after `/develop`; `Alpha` after `/check verify`; `Beta` and `GA` after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (built before this workflow) and `dropped` (taken out of scope, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag means it inherits.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits it. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
- **Rule IDs** (CR-1, RX-3, BL-6, and so on) are the numbered invariants in domain.md §8; **OPEN-n** are its open questions in §12.
- **(basis: …)** says where a recommendation came from; the sources are listed under References.

## References

**Project sources**
- `docs/domain.md` (moved here from the Vet Software vault): the 13 contexts, the 36 numbered rules, the OPEN register, and the out of scope list.
- `output/vet-interview-guide.md` in the Vet Software vault (`~/projects/personal/Vet Software/`): the Baku interview plan that closes the OPEN questions.
- Vault wiki pages behind specific calls: `wiki/concepts/missed-charge-capture.md` and `wiki/concepts/patient-flow.md` (why the стационар slice matters), `wiki/concepts/controlled-drug-tracking.md` (the drug register), `wiki/concepts/migration-playbook.md` (import and opening balances), `wiki/concepts/pms-pricing-models.md` (one login per person), `wiki/sources/raftlabs-build-vet-pms.md` (location aware from day one).
- Your answers in the scoping session on 2026-10-01: front desk to checkout first, one design partner clinic, pricing left open, solo part time pace, the clinic's own cash register for receipts, the drug register built in now, printouts plus a due list, lab results by hand, import plus files plus an owner view, Russian and Azerbaijani, desktop plus tablet, errors plus key events, no public site yet, Tracer Bullet, Beta.

**Practices & standards**
- Tracer bullet development and the walking skeleton: one thin thread through every layer first, then thicken it.
- Foundations before features.
- The data model is the costliest thing to redo.
- Append only ledgers for money and legal records: fix mistakes with new entries, never by editing old ones.
- Design partner pilots: shape the first release around one real customer's day.
- Domain driven design (bounded contexts, ubiquitous language), the method behind domain.md.
