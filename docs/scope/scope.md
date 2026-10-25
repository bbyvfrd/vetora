# Scope: vetora

Practice management software for companion vet clinics in Azerbaijan, Baku first and then CIS countries: outpatient visits, a стационар, pharmacy and retail counter, in house lab, grooming, and boarding under one roof. The pilot release (slices 1 to 7) is built around one design partner clinic.

**How work moves:** this file is the roadmap, not a task list. A feature starts with `/grill-with-docs <feature>` (its decisions become ADRs in `docs/adr/`), then `/implement` in the same window when it fits one session, or `/to-spec` and `/to-tickets` on GitHub Issues when it spans several; `docs/RUNBOOK.md` has the flow. Tracer bullets throughout: every ticket cuts one thin path through every layer it touches and can be demoed on its own.
**Domain model:** [`docs/domain.md`](../domain.md) is the source of truth for terms, the numbered rules cited below (CR-1, RX-3, BL-6, …), and the open questions (OPEN-n). Interviews with Baku vets close OPEN-1, 4, 9, 10, 11, 12; a local lawyer or accountant closes OPEN-2, 3, 5, 6, 7, 8, 13, 14. Features name the ones they lean on.
**Tags:** *decide first* marks a feature whose design is still open (grill it before any ticket); *high stakes* marks the seven features where a bug becomes a legal or money problem (basis: the domain.md §8 rules those features enforce): write their tests first and review them before merging.

_These are recommendations to keep your build orderly, not requirements. You decide what is done and when._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | in progress |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Data model | Foundation | done |
| 4 | Design system & UI foundation | Foundation | in progress |
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

### 1. Stack & architecture · in progress
Decide the whole stack once, then scaffold a runnable project. The decision covers hosting (including where clinic data may legally live, a question for your lawyer), data store and backups, sign in, file storage, translation, printing, and monitoring, so later features install their own pieces without new tool decisions.
**Done when:** the stack is recorded in a spec, and an empty project boots locally and deploys once to a hosted environment.
[Spec 0001](../specs/0001-stack-architecture/index.md) · code in `apps/api`, `apps/clinic-web`, `packages/`, `infra/`, `compose.yaml` · the local checks are the Commands and UI sections of the spec's `verify.md`
_Deferred on 2026-10-22: the hosted deploy (the last Done when clause) waits until a server and a domain are affordable; the Hosted section of `verify.md` is its checklist, a `/wizard` job when the day comes._

### 2. Coding standards & tooling · done
Capture conventions and tooling from the real scaffolded project, then install lint, format, and pre commit checks.
**Done when:** root `AGENTS.md` reflects the real stack and treats the domain.md rule IDs as shared vocabulary for code, tests, and reviews; lint, format, and pre commit run clean.
Done on 2026-10-22 · code in `biome.jsonc`, `lefthook.yml`, `vitest.config.ts`, `.vscode/`, `.github/workflows/ci.yml`

### 3. Data model · done · high stakes
Turn domain.md's 13 contexts and 36 rules into the persistence shape: modules inside one deployable, every record aware of its location from day one (IN-5), money as whole minor units with a currency (IN-4) (basis: the data model is the costliest thing to redo).
**Done when:** the entities cover every planned slice without a breaking migration, and the hard rules (finalised visits append only CR-1, dispense and stock movement in one transaction RX-3, debt derived from a ledger BL-6, ownership over time PT-1, weight as a dated observation PT-2) hold in the data layer itself, not only in screens.
Done on 2026-10-24 · [Spec 0002](../specs/0002-data-model/index.md) · code in `apps/api/drizzle/` (the control and practice migration sets), `apps/api/src/platform/db/` (the migrator, provisioning, the grants pass and table classes, the platform tables, the rules fixture), `apps/api/src/modules/*/schema.ts`, `infra/postgres/init/01-vetora.sql` · the checks are the spec's `verify.md` and `apps/api/src/rehearsal.test.ts`
_Deferred on 2026-10-24 to slices 1 and 2: the Done when clauses that name slice tables are proven on their own tables by the slices that build them. Finalised visits append only (CR-1): `freeze_record` and `lock_parent` on `encounter`, feature 5, the triggers proven on the rules fixture today. Dispense and stock movement in one transaction (RX-3): the deferred check convention on `dispense_event`, feature 6, worked once on the fixture. Debt derived from a ledger (BL-6): the append only class on `ledger_entry` and the `client_balance` view, feature 5 and then feature 8, the class proven on scratch tables by the grants pass. Ownership over time (PT-1): an exclusion constraint on `ownership`, feature 5, nothing of it yet beyond the `btree_gist` extension it needs. Weight as a dated observation (PT-2): the append only `clinical_observation`, feature 5._

### 4. Design system & UI foundation · in progress
Visual language and base components for reception desktops and ward tablets, translation ready in Azerbaijani, Russian, and English, with print layouts for client documents.
**Done when:** `design.md` covers type, color, spacing, components, and print; base components work by keyboard and by touch with readable contrast; no screen text lives outside the Azerbaijani, Russian, and English translation files.
_Grilled on 2026-10-24 (`docs/research/2026-10-24-grilling-next-after-0002.md`): the web app vendors the design system's source into `packages/ui` (ADR 0003); the print sheets are the one implementation of each document, rendered to PDF in the worker at feature 14 (ADR 0004); the spec is [issue #9](https://github.com/bbyvfrd/vetora/issues/9), its tickets #10 to #13. On 2026-10-26 ADR 0005 amended ADR 0003's source of truth: once every component is vendored (#11), component code is fixed in `packages/ui` and synced up to the artifact, while tokens, words, icons and the examples stay the artifact's and come down by re-copy._

## Slice 1: Core loop

The thinnest real thread through a clinic day, and the walking skeleton for everything after it (basis: tracer bullet development).

### 5. First visit from arrival to payment · decide first · high stakes
A vet signs in, registers a walk in client and pet, records the weight, writes and finalises the visit note, invoices it, and takes a payment. Real sign in and real data; no bookings, stock, or printing yet. The note has six sections (reason for visit, history, examination, diagnosis, treatment, recommendations); the interviews settle their labels (OPEN-10).
**Done when:** a vet completes a walk in visit end to end in Azerbaijani, Russian, or English; the finalised note is locked (CR-1) and only a vet can finalise it (CR-2); a note in progress survives a dropped connection; a part payment leaves the rest as client debt (BL-5); every action records who did it (IN-1).
_Before its grilling: a one session `/prototype` spike of Better Auth 1.7.12 (the relations-v2 Drizzle adapter) on Drizzle 1.0 rc, scoped in `docs/research/2026-10-24-grilling-next-after-0002.md`, Feature 5 spike._

## Slice 2: Medicines

Where clinical decisions become stock movements and legal records at the same moment, so it comes right after the core loop (basis: domain.md §6.1, Prescription & Dispensing is a core context).

### 6. Prescribe and dispense from stock · decide first · high stakes
The vet prescribes with a dose worked out from today's weight, and the clinic dispenses from a specific lot; the stock drop and the charge happen in the same step. Lots are entered by hand for now.
**Done when:** a dispense without lot and expiry cannot be saved (RX-1); dispensing lowers that lot's stock in the same transaction (RX-3); a dose keeps the weight and concentration it was worked out from (RX-5, PT-2); the line lands on the visit's invoice.

### 7. Controlled drug register · decide first · high stakes
An append only register for controlled drugs, built in from the start on domain.md's interim rule (required, per administration, one signature, kept 7 years) until your lawyer answers OPEN-5 (basis: domain.md §5.5, relaxing a strict log later is cheap and retrofitting one is not).
**Done when:** every controlled dispense or administration writes a register entry that cannot be edited or deleted and ties back to a finalised visit (RX-2, RX-4); the register prints per drug for an inspection.

## Slice 3: Money at the desk

Cash, part payments, and running debt are everyday events here, not edge cases (basis: domain.md §4.2).

### 8. Payments and client debt · decide first · high stakes
Make front desk money real for a cash market: part payments, running client debt (долг, borc) across visits, paying off old debt, the fiscal receipt number from the clinic's own cash register, and fixing mistakes without deleting anything.
**Done when:** a client's debt is the sum of an append only ledger (BL-6); one payment can settle several invoices; the clinic's fiscal receipt number is recorded per payment, so one payment that settles several invoices has one receipt and two part payments have two (BL-4, OPEN-7); corrections are new entries, never edits; the day closes with a cash and card summary.

## Slice 4: Stock and the counter

### 9. Stock receiving and counts
Receive deliveries into lots with cost and expiry, move stock between stock locations, count and adjust stock with a reason, and see what is running low or expiring soon (basis: the data model and dispensing specs already decide lots and movements, so no new decision).
**Done when:** received lots are available to dispense and sell; every adjustment is a recorded movement with a reason and an author; lots near expiry and items below their minimum are listed.

### 10. Counter sales
Sell food, preventatives, and accessories over the counter to a known client or to nobody at all, from the same lot tracked stock.
**Done when:** a sale needs no patient or visit (BL-1) and never sells a product that needs a prescription; it lowers stock by lot; it uses the same payment, debt, and receipt flow as a visit invoice.

## Slice 5: Bookings

### 11. Bookings and waiting room · decide first
Book appointments by type and length for a vet or a room, check in arrivals, and keep walk ins and emergencies in a live queue beside the booked list.
**Done when:** the appointment type sets length and resources (RS-2); no resource can be double booked (RS-1); a booking and a visit stay separate things (SC-1); reception sees who is waiting, for whom, and since when.

## Slice 6: Records and documents

### 12. Patient chart · decide first
Find any animal by client name or phone and open one page for it: visits over time, the problem list, handling alerts, weight trend, attached files (lab PDFs, photos, signed consent scans), and amendments to finalised visits.
**Done when:** the problem list lives on the patient across visits (CR-6); an amendment shows author, time, reason, and the earlier text (CR-1); files attach to a patient or a visit; a rehomed or deceased animal keeps its full history (PT-1, PT-4).

### 13. Vaccinations and due list · decide first
Record vaccinations with the vaccine lot, work out when the next ones are due per species, and give reception a list of vaccinations and rechecks that are due, with the client's phone and messenger at hand. Automated messages wait for OPEN-9.
**Done when:** a vaccination records vaccine, lot, and date; due dates follow a protocol per species (PT-3); staff mark each due item as contacted, booked, or declined.

### 14. Client printouts
Print or save as PDF, in the client's language (Azerbaijani, Russian, or English) with the clinic's letterhead: the prescription, the discharge summary (выписка, one document for a visit or a stay), the invoice, and a consent form filled in with client and pet details (basis: builds on the design system's print sheets, rendered to PDF in the worker, ADR 0004, so no new decision).
**Done when:** each document prints in the client's chosen language from real record data; a draft prints clearly marked as a draft.

## Slice 7: Pilot go live

Everything the design partner clinic needs to switch over, and the end of the pilot release (basis: your answer, front desk to checkout with one design partner clinic).

### 15. Practice settings
The manager adds staff with their own logins and roles (veterinarian, assistant, receptionist, groomer, manager), sets the services and price list, and enters clinic details for printouts. Role scope follows domain.md's interim answer to OPEN-4.
**Done when:** every person has their own login and none are shared; changing a price never touches past invoices; prices are whole minor units in AZN (IN-4).

### 16. Client and pet import · decide first
Bring the pilot clinic's client and pet list, plus the debts they carry, in from Excel, so go live takes a day rather than a week.
**Done when:** a preview shows matches, duplicates, and errors before anything is saved; imported debts become opening ledger entries that match the clinic's own total; a bad import can be reversed as a whole before go live.

### 17. Owner daily view
One screen for the manager, usually the clinic's owner: today's revenue by line (visits, medicines, retail), payments by method, total client debt, stock value, and lots expiring soon.
**Done when:** every figure ties back to the ledger and stock movements behind it, and splits by location (IN-5).

### 18. Monitoring and backups
Get ready for real clinic data: error monitoring, automated backups with a rehearsed restore, and a few key events (visits finalised, items dispensed, invoices paid) (basis: the stack spec picks the tools, so no new decision).
**Done when:** a production error reaches you within minutes; a restore from backup has been rehearsed once; key events are counted per clinic.

## Slice 8: Стационар

The first slice after go live, and where vetora should stand out: domain.md assumes nobody in this market serves the стационар well, and it is where charges leak and handovers fail (basis: domain.md §6.1; wiki pages Missed Charge Capture and Patient Flow).

### 19. Estimates and consent · decide first · high stakes
Agree the cost with the client before a procedure or admission, and record consent as a real record: who gave it, with what standing, for what.
**Done when:** an invoice that goes over its estimate is flagged until the client agrees (BL-3); consent records subject, scope, granter and their authority, time, and the signed form (IN-2); surgery, anaesthesia, and euthanasia require one.

### 20. Admissions and treatment sheet · decide first · high stakes
The стационар core: admit a patient to a cage, run the лист назначений of scheduled orders, record each administration as given, refused, or missed, and charge as care happens.
**Done when:** an admission books a cage without owning it (HS-4); every order ends as given, refused, or missed with who and when (HS-2); each administration is charged when it happens, not at discharge (HS-3); discharge produces take home meds and a recheck.

### 21. Ward board and handover · decide first
A tablet board of every inpatient right now (orders due and missed, results outstanding, owner) and a handover that passes the ward from one shift to the next.
**Done when:** the next shift can see what is due for each animal without asking anyone (HS-5); handover is a recorded event saying who handed over to whom; missed orders stand out.

## Slice 9: Lab

### 22. Lab orders and results · decide first
Order tests from a visit or an admission, type results in by hand against reference ranges per species, and never lose a result that arrives after the client has left. Analysers stay deferred.
**Done when:** results outside the species range are flagged (PT-3); a result that arrives after the visit closed sits on a loose ends list until someone acts on it; ordered tests are charged.

## Slice 10: Grooming and boarding

Last, because both lean on bookings and on the cages the стационар already uses (basis: domain.md RS-1).

### 23. Grooming
Book groomers and tables, charge for the service, and keep it out of the medical record.
**Done when:** a groom is a booking with no visit (SC-1); grooming revenue shows in the owner daily view.

### 24. Boarding · decide first
Board healthy animals (передержка) in the same cages the стационар uses, with a feeding and medication schedule and a nightly charge. If boarders' medication turns out to need a vet's supervision, that decides whether boarding splits out (domain.md §6.6).
**Done when:** boarding and the стационар can never claim the same cage at the same time (RS-1); feeding and medication are recorded in the boarding log, outside the clinical record; each night is charged.

## Deferred
Out of scope for the current build pass, kept so the plan stays honest. domain.md §11 lists what is out of scope on purpose (pet insurance, large animals, mobile vets, referrals, telemedicine, FHIR). Each of these needs a decision before it starts.
- **Automated client messaging**: reminders and results by WhatsApp, Telegram, or SMS, once OPEN-9 is answered
- **Fiscal receipts from vetora**: issue receipts directly, once OPEN-7 is answered · high stakes
- **Lab analyser integration**: results straight from the clinic's machines
- **Imaging**: X ray and ultrasound images (DICOM) on the record
- **Landing page**: a Russian and Azerbaijani site for when you look for clinic number two
- **Free vet calculators**: dose and fluid calculators as lead generation
- **Signup and subscription billing**: self serve onboarding and charging clinics, once pricing is chosen · high stakes
- **Client portal and online booking**
- **Managing several locations**: the data knows its location from day one; the screens come later
- **Exotics**: clinical support for rabbits, birds, and reptiles, if OPEN-11 says they are routine
- **AI scribing**: deferred on purpose until the record model is proven in use (domain.md §11) · high stakes
- **Full product analytics**: usage tracking beyond the key events
- **Pet owner app**: an iOS and Android app (Expo) where owners follow their pets' records, vaccinations, and due dates across clinics, signing in with a phone code; overlaps the client portal above · from spec 0001

## References

**Project sources**
- `docs/domain.md` (moved here from the Vet Software vault): the 13 contexts, the 36 numbered rules, the OPEN register, and the out of scope list.
- `output/vet-interview-guide.md` in the Vet Software vault (`~/projects/personal/Vet Software/`): the Baku interview plan that closes the OPEN questions.
- Vault wiki pages behind specific calls: `wiki/concepts/missed-charge-capture.md` and `wiki/concepts/patient-flow.md` (why the стационар slice matters), `wiki/concepts/controlled-drug-tracking.md` (the drug register), `wiki/concepts/migration-playbook.md` (import and opening balances), `wiki/concepts/pms-pricing-models.md` (one login per person), `wiki/sources/raftlabs-build-vet-pms.md` (location aware from day one).
- Your answers in the scoping session on 2026-10-01: front desk to checkout first, one design partner clinic, pricing left open, solo part time pace, the clinic's own cash register for receipts, the drug register built in now, printouts plus a due list, lab results by hand, import plus files plus an owner view, Russian and Azerbaijani, desktop plus tablet, errors plus key events, no public site yet, tracer bullets.

**Practices & standards**
- Tracer bullet development and the walking skeleton: one thin thread through every layer first, then thicken it.
- Foundations before features.
- The data model is the costliest thing to redo.
- Append only ledgers for money and legal records: fix mistakes with new entries, never by editing old ones.
- Design partner pilots: shape the first release around one real customer's day.
- Domain driven design (bounded contexts, ubiquitous language), the method behind domain.md.
