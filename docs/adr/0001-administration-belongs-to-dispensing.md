---
status: accepted
date: 2026-10-22
---

# Administration belongs to Prescription & Dispensing

`docs/domain.md` §6 and §7 placed `Administration` in Hospitalization, as the record that a treatment order was carried out, refused, or missed. An injection or a vaccination in the consult room is the same act with the same consequences, stock moves and a charge arises (RX-3, HS-3), but no order stands behind it, which is why spec 0002 already had to give an administration an encounter as its alternative parent. We widen `Administration` to "the act of giving a medication, fluid, feeding, or procedure to a patient by a named staff member at a time, with outcome given, refused, or missed", and move it to Prescription & Dispensing, the context whose reason for being is that clinical acts become stock movements and charges there: on the ward a TreatmentOrder's due time is resolved by one, in the consult room it stands alone under the Encounter.

## Considered options

- **Stay in Hospitalization**, with a consult room exception: the ward would own a concept the consult room uses every day, and the Hospitalization → Inventory edge would carry outpatient stock movements.
- **Clinical Record**: an administration is a clinical fact, but Clinical Record would then depend on Inventory and own stock moving acts it otherwise never touches.
- **Prescription & Dispensing** (chosen): prescribe, dispense, and administer are the three acts that turn a clinical decision into a stock movement and a charge.

## Consequences

- domain.md §6.1: Prescription & Dispensing owns Prescription, DoseCalculation, DispenseEvent, Administration; Hospitalization owns Admission, TreatmentSheet, TreatmentOrder, Handover.
- domain.md §6.4 and §6.5: Hospitalization → Prescription & Dispensing becomes a Customer-Supplier edge (orders are resolved by administrations); the "both decrement stock" edge from Hospitalization to Inventory goes.
- domain.md §9: `TreatmentAdministered` and `TreatmentMissed` follow the administration record, so Prescription & Dispensing raises them and Hospitalization consumes them for the treatment sheet and the ward board.
- Spec 0002 already groups the administration table under Prescription, Dispensing, and Administration; the module layout in spec 0001 follows it.
- A boarder's feeding and medication log in Non-Clinical Services is not an Administration: it produces no medical record, moves no stock, and charges nothing per dose. A boarder's medication is the owner's own; what the clinic supplies to a boarder is sold over the counter, and only a vet's order turns a boarder into an inpatient (domain.md §6.6).
