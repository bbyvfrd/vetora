# Grilling 2026-10-22: domain terms and boundaries

What the `/grill-with-docs` session of 2026-10-22 decided, and the edits those decisions imply outside `GLOSSARY.md` and `docs/adr/`. The terms themselves sit in `GLOSSARY.md` under "Terms added since domain.md" until they are folded into `docs/domain.md`; the Administration move is ADR 0001. Nothing here edits a spec or the scope: specs belong to `/architect`, the scope to `/scope`. Tick a line when the owning skill has applied it. The two `/architect` lists were applied on 2026-10-22 (specs cross checked on another model; eighteen further fixes landed, see each spec's change log); the `/scope` list was applied the same day.

## For `/architect`: spec 0002, data model

- [x] Staff roles: the `staff_member.roles` values become manager, veterinarian, assistant, receptionist, groomer (were owner, veterinarian, feldsher, administrator, groomer). Provisioning's "first owner" is the first manager.
- [x] Ownership roles: owner and authorised_person; caretaker dropped.
- [x] Encounter note: six text sections, `reason_for_visit`, `anamnesis`, `examination` (was `status_praesens`), `diagnosis_text`, `treatment` (was `plan`), `recommendations`; `encounter_amendment.section` names the same six; `note_format` dropped (SOAP is a labelling of the six, OPEN-10 decides labels only). `appointment.reason` prefills `reason_for_visit`. `reason_for_visit` is client reported, so CR-5's reporter attribution covers it as it covers anamnesis.
- [x] Lot: `goods_receipt_line.lot_id` is the lot it creates or tops up; a second delivery of the same series at the same stock location adds a receipt movement to the existing lot; `lot.cost_per_unit_minor` becomes the latest receipt's cost or goes, with cost kept on the receipt line; the movement kinds lack a transfer between stock locations.
- [x] `issued_document.kind`: drop `visit_summary`; `discharge_summary` is issued for an encounter or an admission. A `receipt` document has no `payment_id` to point at; it needs one.
- [x] Administration stays grouped under Prescription, Dispensing, and Administration (ADR 0001); its schema module lives in that module, not in hospitalization.
- [x] Prepayment: no new structure; the balance view goes negative by design and the screen shows Balance due or Prepayment by sign.
- [x] Fiscal receipt per payment stands, as the cross check decided.

- [x] Patient alerts: a patient level table (kind allergy, behaviour, contagious, other; text; set and cleared by staff), separate from `patient_problem`; the header shows three at most.
- [x] Invoice line: list price, discount, and reason beside the charged unit price, so a discount never edits a price; an invoice wide discount is written onto each line.
- [x] Invoice: an optional due date (`due_on`), set for clients paying by transfer; overdue is derived (issued, unpaid remainder, due date past), never stored.
- [x] `clinical_observation.kind`: `pulse`, not `heart_rate`.
- [x] House call: an appointment type whose `required_resource_kinds` is the provider alone, with the travel as a service; nothing else changes.
- [x] Boarding: `boarding_schedule_item` medication is the owner's own, so its `product_id` should give way to a medication name; what the clinic supplies to a boarder is a counter sale. The take-home table on the выписка comes from the issued prescription's lines, never from typed text.

## For `/architect`: spec 0001, stack

- [x] Two factor sign in is required for managers and the platform admin, not for receptionists, who rely on the device session plus PIN switching. "Owners and administrators" reads "managers".
- [x] "Owner app" keeps its name: it is the pet owner's app. Staff roles in `packages/contracts` follow spec 0002's list.

## For `/scope`

- [x] Feature 15: "vet, feldsher, administrator, groomer, owner" becomes "veterinarian, assistant, receptionist, groomer, manager".
- [x] Feature 8, done when: "each invoice can carry the clinic's receipt number" becomes "the fiscal receipt is recorded per payment".
- [x] Feature 14: "the visit summary (выписка)" becomes "the discharge summary (выписка)".
- [x] Feature 5: "the note follows the Russian structure (анамнез, статус, диагноз, назначения) until the interviews settle OPEN-10" becomes "the note has six sections; OPEN-10 decides their labels".
- [x] Languages: "Russian and Azerbaijani" (header, features 4, 5, 14) becomes Azerbaijani, Russian, and English, as spec 0001 and the design system settled on 2026-10-22.
- [x] Header: the lawyer or accountant also closes OPEN-13 and OPEN-14 (added to domain.md §12 on 2026-10-22).

- [x] Feature 24, done when: "feeding and medication are recorded like administrations" becomes "feeding and medication are recorded in the boarding log, outside the clinical record".

## For the design system spec (scope feature 4)

- [x] Add to the design system glossary before they reach a screen: Arrival (явка, gəliş; the Queue page lists arrivals), Authorised person (доверенное лицо, səlahiyyətli şəxs). Done 2026-10-24 (artifact version 19). Still owed: an Azerbaijani word for Estimate (смета), slice 8, and a UI word for DispenseEvent, slice 2.
- [x] Its Owner row says "the field on the patient record"; the model keeps ownership as a dated relationship (PT-1), and the field shows the current owner. Reworded 2026-10-24.

- [x] Glossary rows also needed: Alert (особая отметка, xüsusi qeyd), Stock location (место хранения, saxlama yeri). Added 2026-10-24. The navigation rail has no page yet for the queue, the ward, the pharmacy counter, grooming, or boarding; each arrives with its slice (unchanged, by design).

## For the interviews (OPEN register)

- [ ] Confirm what the design partner clinic calls the assistant role: ассистент or фельдшер. If фельдшер, the role name flips back and the glossary entry moves with it.
- [ ] OPEN-10 is now a labelling question: do vets accept the six section labels as they are?
