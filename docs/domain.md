---
tags: [foundational, domain-model, ddd, architecture, azerbaijan, cis, product-strategy]
sources: [wiki]
created: 2026-09-10
updated: 2026-10-02
---

# Domain — Veterinary Practice Management

**Market:** Azerbaijan first, CIS / Russian-speaking second.
**Practice shape:** companion outpatient (dog, cat) + inpatient hospitalization (стационар),
with in-house laboratory, pharmacy and retail counter, grooming, and boarding under the same roof.
**Status:** foundation document. Load-bearing. Change it deliberately.
**Home:** the vetora repo (`docs/domain.md`), moved here from the Vet Software vault on 2026-10-02.
Every `[[wikilink]]` below cites a page in that vault's `wiki/` (`~/projects/personal/Vet Software/wiki/`).

---

## How to read this

This document has two halves that answer two different questions.

**Part I — The Domain** answers *how does a veterinary practice actually work?* It is narrative,
uses no modelling notation, and is meant to be readable by a designer, a founder, or a vet.

**Part II — The Model** answers *what shape must the software be?* It is the strategic
[[Domain-Driven Design]] layer: bounded contexts, ubiquitous language, aggregates, invariants,
and domain events.

Part II is derived from Part I. If Part I is wrong, Part II is wrong. Fix the top first.

### What this document deliberately does not contain

No database, framework, language, hosting, or API-style decisions. Not because they don't matter,
but because they are **downstream** of everything here. An invariant like "a finalised clinical
record cannot be destructively updated" constrains every storage technology equally; naming
PostgreSQL adds nothing to it and dates the document.

### Status markers

Every claim in this document carries one of these. There are no unmarked claims.

| Marker | Meaning |
|---|---|
| **[sourced]** | Traceable to an ingested source. Follow the link. |
| **[assumed]** | A reasoned assumption. Plausible, unverified, safe to act on provisionally. |
| **[OPEN-n]** | An unanswered question with a real consequence. Listed in §12. Answer before building the affected part. |

The markers exist because roughly 90% of the ingested corpus describes **United States** veterinary
practice, and this product is for Azerbaijan. Every US legal number in the wiki — DEA's two years,
the states' three years, AAHA accreditation — is reference material, not requirement. Anything not
marked **[sourced]** to something jurisdictionally relevant should be treated as a guess until a
practising Baku veterinarian says otherwise.

---
---

# Part I — The Domain

## 1. Three parties, not one

Human medical software has one person at its centre: the patient is the person examined, the person
who consents, and the person who pays. Veterinary software has **three parties, and none of them is
the same as the others.** [sourced: [[VCPR]]]

| | Role | Cannot |
|---|---|---|
| **The animal** | Subject of care | Consent. Describe symptoms. Pay. Choose to return. |
| **The client** | Consents, is legally responsible, pays | Be the patient |
| **The practice** | Delivers care, dispenses drugs, sells goods, bills | Act without the client's authority |

Every structural oddity of veterinary software descends from this split. Six consequences matter
enough to state directly.

**The history is hearsay.** Everything in a patient's history was reported by a human who was not
the patient, was not present for most of the animal's day, and is interpreting behaviour rather
than reporting symptoms. "He's been off his food since Tuesday" is not a symptom report — it is a
third-party observation of a proxy for a symptom. This is exactly why the [[SOAP Note]] separates
Subjective from Objective, and why that separation is a **provenance rule rather than a formatting
convention** [sourced: [[SOAP Note]]].

**The payer can decline the treatment the patient needs.** In human medicine, cost negotiation is
mostly displaced onto an insurer and happens after care. In Azerbaijani veterinary practice, with
pet insurance effectively absent, the cost conversation happens **in the consult room, before
treatment, with the decision-maker present** [assumed]. The estimate is therefore not a billing
artifact — it is a clinical-decision artifact, and it belongs to the encounter.

**The patient can be ended at the payer's request.** Euthanasia is routine, legal, and
client-authorised veterinary care. No human-medicine system models it. It is the single most
consequential act in the domain, the most likely to be disputed afterwards, and the one where
"who authorised this, and did they have standing to?" must be answerable years later
[sourced: [[Informed Consent (Veterinary)]]].

**The practice is also the pharmacy and the shop.** Human medicine separates prescriber from
dispenser deliberately, to remove the incentive to over-prescribe. Veterinary medicine does not:
the clinic diagnoses, prescribes, dispenses, and takes the margin. This is not a market defect to
be designed around — it is the revenue model (§4), and it is why the clinical record and the stock
ledger are **one system, not two** (§8, invariant IN-3).

**Ownership changes; the animal's history does not.** Animals are rehomed, inherited, surrendered,
adopted from shelters, and divided in separations. The medical record follows the *animal*. The
right to see it, and the authority to consent, follow whoever is **currently** responsible. Those
are two different links and they change independently [sourced: [[Veterinary Medical Record]]].

**The person in the room is often not the client.** A family member, a driver, a housemate, a
neighbour, an employee. The question "may this person authorise anaesthesia for this animal" has a
real legal answer that depends on the ownership relationship *at that moment*
[sourced: [[Informed Consent (Veterinary)]]].

### The relationship is the object

The three parties are not merely three tables joined by keys. The **relationship between them is
itself the thing that authorises action** — the veterinarian-client-patient relationship, or
[[VCPR]]. It "enables record creation and provides the authority to prescribe or dispense
medications. Without an established VCPR, no record obligation exists" [sourced: [[VCPR]]].

Four questions the software must be able to answer, all of which reduce to the same relationship:

- *May this vet prescribe for this animal?* → Is there a current care relationship?
- *Why does this record exist?* → Because a care relationship was established.
- *Can a phone call produce a prescription?* → Only against an already-established relationship.
- *Who is clinically accountable here?* → The veterinarian party to it.

Two properties matter for modelling. The relationship is **temporal** — established, maintained,
and capable of lapsing; one formed three years ago may no longer authorise anything today. And it
may bind to **an individual veterinarian rather than the clinic**, which decides whether a locum or
a colleague can act on an existing relationship [OPEN-3].

> **Note on the term.** "VCPR" is US-originated vocabulary. Whether Azerbaijani law recognises an
> equivalent construct is unverified [OPEN-2]. The model should carry it regardless: even where
> unregulated, it is the honest description of how clinical accountability works, and it is far
> cheaper to model now than to retrofit.

---

## 2. The practice day

> **Confidence warning — read this before using this section.** Nothing in this wiki describes an
> Azerbaijani clinic. This is reconstructed from US and Western European sources
> [sourced: [[Episode of Care]], [[Patient Flow]], [[StringSoft: Top 5 Simple Workflows for a Veterinary Practice]]]
> plus reasoning about the market. It is the **weakest section of this document** and the one most
> likely to be wrong in ways that matter. Half a day of observation in two Baku clinics would be
> worth more than every source ingested so far. [[Workflow Analysis]] describes how to do that.

Four streams of work run simultaneously through one building, competing for the same rooms, people,
and cages.

### 2.1 The consult stream (outpatient)

    arrival ──▶ reception ──▶ weigh ──▶ wait ──▶ consult room ──▶ history ──▶ examination
                                                                                    │
                    ┌───────────────────────────────────────────────────────────────┘
                    ▼
              diagnostics? ──yes──▶ in-house lab / imaging ──▶ results ──▶ back to the room
                    │                                                            │
                    no                                                           │
                    ▼                                                            ▼
              decision ──▶ estimate ──▶ consent ──▶ treat / dispense / admit / refer
                                                              │
                                                              ▼
                                              invoice ──▶ payment ──▶ discharge ──▶ follow-up

Five things about this flow drive the model.

**Arrival is not booking.** Walk-ins exist, and in an emergency they take priority over the booked
schedule. An appointment is a *prediction*; an arrival is an *event*. They are not the same object
and the schedule is a poor description of the building's actual state [sourced: [[Patient Flow]]].

**Weighing happens before the consult, by whoever is free.** The weight is captured by a technician
or receptionist minutes before the vet sees the animal, it goes into the Objective section
[sourced: [[SOAP Note]]], and **every dose calculated that day depends on it**. It is a measurement
event with a time and an author, not an attribute of the animal (§8, invariant PT-2).

**Diagnostics break the flow into two.** In-house results take fifteen to forty minutes; send-out
results take days. The client may leave before the result exists. A visit is therefore not a
contiguous block of time — it has **a tail that outlives the client's presence in the building**
[sourced: [[Episode of Care]], [[Loose-End Tracking]]].

**The estimate sits between decision and consent.** In a cash market the vet proposes, prices, and
obtains agreement in the room, and if the procedure reveals more work than expected, the
conversation reopens mid-procedure with a sedated animal on the table [assumed].

**Discharge is a document, not a door.** A discharge summary is a required component of the medical
record [sourced: [[AAHA]] via [[Veterinary Medical Record]]], not a courtesy. So is the consent
that preceded any procedure. Both are compliance gates that live *inside* the visit, and a system
that models the visit as pure workflow will happily let a vet walk through them without producing
the artifact.

### 2.2 The стационар stream (inpatient)

A hospitalised patient is not a long consultation. It is a different object with a different
lifecycle, different staff, and a different rhythm.

    admission ──▶ cage assigned ──▶ treatment sheet opened
                                            │
                          ┌─────────────────┴─────────────────┐
                          ▼                                   ▼
                    scheduled orders                    daily rounds
              (drugs, fluids, feeding, obs)          (SOAP per day, plan revised)
                          │                                   │
                          ▼                                   │
                 administration records ◀────────────────────┘
                 (given / refused / missed, by whom, when)
                          │
                          ▼
                    discharge ──▶ take-home meds ──▶ recheck booked

Four differences from the consult stream, each with modelling weight:

- **It spans days and shifts.** The person who admits is not the person who discharges. Handover is
  a first-class event, and "what is the current state of this patient" must be answerable by
  someone who was not there yesterday [sourced: [[Patient Flow]]].
- **The treatment sheet is the central document** — *лист назначений*. Scheduled orders with due
  times, against which administrations are recorded. It is the inpatient analogue of the SOAP plan,
  and it is where **missed doses** become visible.
- **Charges accrue continuously.** Every administration is billable. In outpatient work, charge
  capture happens once at checkout; in the стационар it happens forty times over three days, and
  each miss is silent revenue loss [sourced: [[Missed Charge Capture]]].
- **It occupies a cage** — a scarce physical resource that the boarding stream also wants (§2.4).

### 2.3 The counter stream (pharmacy and retail)

Someone walks in and buys flea treatment, a bag of food, a lead, or a repeat of a medication.
No animal is examined. Frequently **no animal is present**, and the buyer may not own a registered
patient at all.

This stream is short, high-frequency, and it **breaks the assumption that everything descends from
a visit**. An invoice can exist with no encounter and no patient (§8, invariant BL-1). Two
operations that look identical at the till are different acts underneath:

| | Dispensing | Selling |
|---|---|---|
| Authorised by | A prescription, under a care relationship | Nothing clinical |
| Records | Drug, strength, quantity, **lot, expiry**, instructions [sourced: [[Veterinary Medical Record]]] | Item, quantity, price |
| Attaches to | A patient and a prescriber | A client, or nobody |
| Stock effect | Decrements a specific lot | Decrements a specific lot |

Same shelf, same stock movement, different domain operation, different legal weight.

### 2.4 The salon and the hotel (non-clinical)

**Grooming** is booked, performed by a non-veterinary staff member, occupies a table and a person
for one to three hours, and produces **no medical record**. It is often the highest-volume booking
type by count [assumed].

Grooming is the cleanest proof that appointment and encounter are different things: a groom is all
appointment and no encounter, while a walk-in emergency is all encounter and no appointment.

**Boarding** — *передержка* — is a stay with no illness. It occupies a cage for days, has a feeding
and medication schedule, is staffed by non-veterinary personnel, and has a completely different
lifecycle from hospitalization.

And it wants **the same cages**. A clinic with twelve cages cannot board eight animals and
hospitalise six. Boarding and hospitalization are different aggregates competing for one scarce
resource, which is why neither may own it (§8, invariant RS-1).

### 2.5 What runs across all four

- **Reminders and preventive care.** Vaccination due dates, deworming, parasite prevention. These
  fire on a schedule the clinic keeps, not in response to anything the client does
  [sourced: [[StringSoft: Top 5 Simple Workflows for a Veterinary Practice]]].
- **Client messaging.** Reminders, results, follow-ups. In this market that means WhatsApp before
  it means email [assumed — WhatsApp dominance in Azerbaijan is well established generally, but its
  role in clinic–client communication specifically is unverified, OPEN-9].
- **Loose ends.** Results that arrived after the client left; recheck bookings never made; a
  medication that was never collected [sourced: [[Loose-End Tracking]]].

---

## 3. Who does what

Roles are not a permissions convenience. Who may perform an act is partly law, partly practice
policy, and the difference between them decides whether a rule is configurable or fixed.

| Role | RU | AZ | Typically may |
|---|---|---|---|
| **Veterinarian** | ветеринарный врач | baytar həkimi | Diagnose, prescribe, perform surgery, anaesthetise, euthanise, finalise a clinical record |
| **Veterinary technician** | ветфельдшер / ассистент | baytar feldşeri | Restrain, sample, weigh, administer under direction, nurse inpatients, record observations |
| **Receptionist / administrator** | администратор | administrator | Book, register clients and patients, take payment, sell over the counter |
| **Groomer** | грумер | qulluqçu *(uncertain)* | Perform grooming. No clinical access. |
| **Practice owner / manager** | руководитель | rəhbər | Configure, price, report, manage staff |

> All Russian and Azerbaijani terms in this document are **[review needed]** — see the note
> opening §7.

Three things this table implies for the model:

**Finalising a clinical record is a veterinarian act.** A technician may record observations into a
draft; only the veterinarian's finalisation makes it a legal record with their name and
accountability attached [sourced: [[VCPR]], [[Veterinary Medical Record]]].

**The feldsher is a real trained role, not an assistant.** In CIS veterinary practice *ветфельдшер*
is a distinct qualification with genuine clinical scope. A permissions model imported from a US
product — where "vet tech" maps differently — will misfit. What a feldsher may independently do
under Azerbaijani law is [OPEN-4].

**Role is not the whole answer; the care relationship is.** "May Dr. X prescribe for this animal"
is not answered by Dr. X's role. Both must hold: the role permits prescribing, *and* a current care
relationship exists (§8, invariant CR-4).

---

## 4. How the money actually works

Software that models a clinic as a scheduler with billing attached misreads the business. A
veterinary practice is closer to a **clinic, a pharmacy, and a shop sharing one roof, one staff,
and one client list.**

### 4.1 Where the money comes from

| Line | Character |
|---|---|
| Consultations and procedures | Time-based; the vet is the scarce resource |
| **Drug dispensing margin** | Product margin on drugs the practice itself prescribed |
| Retail — food, preventatives, accessories | Pure product margin; often no patient involved |
| In-house laboratory | High fixed cost, near-zero marginal cost; utilisation is everything |
| Imaging | Same shape as lab, larger fixed cost |
| Grooming | Labour-based, non-clinical, high frequency |
| Boarding | Capacity-based; revenue per cage per night |
| Vaccination and preventive care | Recurring, schedulable, forecastable — the closest thing here to predictable revenue |

The second line is the structurally important one. **The practice profits from the drug it
prescribed.** Human medicine treats that as a conflict to be legislated away; veterinary medicine
treats it as the business model. Two direct consequences for the software:

- Clinical decisions and stock movements are **the same transaction viewed from two sides**. They
  cannot live in systems that reconcile nightly.
- Every uncharged administration is margin gone. In the стационар, where charges accrue
  continuously across shifts, this is the largest silent leak in the business
  [sourced: [[Missed Charge Capture]]].

### 4.2 How the money arrives

[assumed throughout — this section is reasoning about the market, not sourced observation]

Cash is heavy. Cards are common in Baku, less so outside it. Bank transfer appears for corporate
clients such as shelters, breeders, and municipal contracts.

Three patterns that most PIMS treat as edge cases and this market treats as Tuesday:

**Partial payment.** The client pays part now and part later. An invoice is therefore not
binary — paid or unpaid — and a *partially settled invoice* is a normal steady state, not an error.

**Client debt** — *долг*, *borc*. A running balance owed by the client to the practice, accumulated
across visits, often informally, often for regulars. It is a first-class concept, not an
accounts-receivable module for enterprises. And per [[Veterinary Medical Record]], an unpaid balance
**does not entitle the practice to withhold the medical record** (US rule; whether AZ law agrees is
[OPEN-6], but the practice-policy question exists either way).

**The estimate as a commitment.** In a cash market the estimate is what the client agreed to. When
actual charges exceed it, that is a conversation, not a silent invoice adjustment. Estimate and
invoice are different documents with different meanings (§8, invariant BL-3).

### 4.3 The receipt is not the invoice

An **invoice** is a commercial document: what was done, what it costs, who owes it. A **fiscal
receipt** is a legally-registered artifact produced through a device or channel the tax authority
recognises, with its own numbering, timing, and correction rules.

Azerbaijan operates a fiscal-receipt regime for retail transactions and an e-invoice system, but
**exactly what applies to a veterinary clinic — which transactions, which device, what happens on
refund or correction — is unverified** [OPEN-7].

The model separates them anyway (§8, invariant BL-4). If they turn out to be one thing, the cost is
one redundant object. If they turn out to be different and were modelled as one, the fix touches
every financial record ever written. Cheap insurance either way.

---

## 5. What the law requires

### 5.1 The honest position

The best source in this wiki on record-keeping [sourced: [[Veterinary Record Keeping Standards]]]
is **entirely United States law**: DEA, state practice acts, AAHA accreditation, FDA. None of it is
binding in Azerbaijan.

What transfers is the **structure** — the categories of obligation that every mature regime
converges on. What does not transfer is every **number and body name**. This section keeps the two
separated by force.

### 5.2 What transfers

**Authority to prescribe is conditional.** Somewhere in every regime, a relationship or a prior
examination is what makes prescribing lawful [sourced: [[VCPR]]].

**The record has required content, not just required existence.** Patient identification, problem
list, examination findings, diagnostic results, diagnoses, treatment plans, discharge summaries;
plus dispensing records and consent documentation [sourced: [[Veterinary Medical Record]]].

**Finalised records are append-only.** *"EMR entries cannot be deleted retroactively; amendments
must be clearly marked as corrections with date and author notation."* This is now corroborated by
**two independent sources** — the best-evidenced constraint in this wiki
[sourced: [[Veterinary Medical Record]], [[Veterinary Software Development Guide (PDF Synthesis)]]].

**Controlled drugs reconcile against the clinical record.** The point that generalises is not the
schedule numbers but the **join**: every dispensing event must reconcile to a documented encounter.
*Medication dispensed without a documented patient encounter* is the discrepancy that triggers
investigation [sourced: [[DEA]] via [[Controlled Drug Tracking]]]. The drug log and the clinical
record are one join, not two ledgers.

**Consent to material clinical acts is documented** — procedures, anaesthesia, euthanasia
[sourced: [[Informed Consent (Veterinary)]]].

**Records outlive the relationship.** Retention extends past the last visit, past the client
leaving, past the animal's death. Purge logic is never "delete inactive."

**The practice holds the record; the client holds a right to a copy.** Two different relations
[sourced: [[Veterinary Medical Record]]].

### 5.3 The line worth remembering

> *"Legal requirements attach to content and retention rather than format."*
> — [[Veterinary Record Keeping Standards]]

Paper and electronic records are equally valid. A paper daybook is not a compliance failure.

Which means: **this software competes with a notebook on convenience, never on compliance.** Any
pitch built on "you need this to be compliant" is factually wrong and a vet will know it. The
honest argument is that the software makes compliance a by-product of work the vet was doing
anyway, instead of a second job performed at 9pm.

### 5.4 What does not transfer — reference only

DEA schedules II–V and the two-year log · US state practice-act retention of ~3 years · AAHA
accreditation standards · FDA Veterinary Feed Directive · pet-insurance documentation requirements
(no meaningful pet insurance market in Azerbaijan) · US recording-consent statutes
[sourced: [[Recording Consent Laws]]].

Keep these visible as a **checklist of question shapes** to put to an Azerbaijani regulator or
lawyer — not as requirements.

### 5.5 Azerbaijan — unanswered

Everything specific to Azerbaijan is unverified and recorded in §12: OPEN-2 through OPEN-8. They
are not decoration. **OPEN-5 (controlled substances) is the one that must be answered before
building**, because if a register is required it is an append-only invariant rather than a report,
and retrofitting that is expensive.

---
---

# Part II — The Model

## 6. Bounded contexts and the context map

Thirteen contexts. A [[Bounded Context]] here means **a region within which one term has exactly
one meaning** — not a microservice, not a team, not a database. All thirteen can and probably
should start life as modules inside one deployable.

Contexts are grouped by how much they should cost you. Core contexts are where the product is won
or lost; supporting contexts must exist and should be built plainly; generic contexts should be
adopted rather than invented.

### 6.1 Core

| Context | Owns | Why it is core |
|---|---|---|
| **Clinical Record** | Encounter, CareRelationship, ProblemList, ClinicalObservation, Diagnosis | The legal record and the reason the product exists |
| **Hospitalization** | Admission, TreatmentSheet, TreatmentOrder, Administration, Handover | Nobody in this market serves the стационар well [assumed]; it is where charge leakage and handover failure concentrate |
| **Prescription & Dispensing** | Prescription, DoseCalculation, DispenseEvent | Where clinical decisions become stock movements and legal artifacts simultaneously |

### 6.2 Supporting

| Context | Owns | Note |
|---|---|---|
| **Client** | Client, ConsentRecord, ClientBalance, ContactPoint | Includes legal entities — shelters, breeders — not only people |
| **Patient** | Patient, OwnershipRelationship, PatientIdentity, LifeStatus | Ownership is time-boxed here, not a field |
| **Scheduling & Resources** | Appointment, Resource, ResourceBooking | Owns cages, rooms, tables, provider time. Neutral between clinical and non-clinical claimants |
| **Diagnostics** | LabOrder, LabResult, ImagingStudy, ReferenceRange | In-house and send-out differ only in latency and in who fulfils |
| **Inventory** | StockItem, Lot, StockMovement, StockLocation, PurchaseOrder | Lot-level, because dispensing legally requires lot and expiry |
| **Billing & Payments** | Estimate, Invoice, LineItem, Payment, FiscalReceipt | Independent of the clinical record by necessity, not by preference |
| **Non-Clinical Services** | BoardingStay, GroomingService, FeedingSchedule | Boarding and grooming merged: both non-clinical, staff-performed, resource-consuming, no medical record |
| **Preventive Care** | PreventiveProtocol, DueItem, VaccinationRecord | Separate because it is *time-driven*, not visit-driven |
| **Client Communication** | Conversation, Message, Reminder, Channel | Downstream aggregator; owns no clinical truth |

### 6.3 Generic

| Context | Owns |
|---|---|
| **Identity & Access** | StaffMember, Role, Permission, Session, AuditEvent |

### 6.4 The context map

Arrows point **downstream** — from the context that constrains to the context that depends.

```
            ┌──────────┐         ┌──────────┐
            │  Client  │◀───────▶│ Patient  │      Shared Kernel:
            └────┬─────┘  owner  └────┬─────┘      OwnershipRelationship
                 │       -ship        │            is co-owned. Neither
                 │                    │            side may change it alone.
                 └────────┬───────────┘
                          │ Customer-Supplier
                          ▼
                 ┌────────────────────┐
                 │  CLINICAL RECORD   │  ◀── holds CareRelationship (VCPR);
                 │  Encounter · SOAP  │      nothing downstream may act
                 │  ProblemList       │      without one
                 └─┬────┬────┬────┬───┘
        C-S ┌───────┘    │    │    └────────┐ C-S
            ▼            │    │             ▼
  ┌──────────────────┐   │    │   ┌───────────────────┐
  │  PRESCRIPTION &  │   │    │   │  HOSPITALIZATION  │
  │    DISPENSING    │   │    │   │  TreatmentSheet   │
  └────────┬─────────┘   │    │   └─────────┬─────────┘
           │ C-S         │    │             │
           ▼             │    │             │
  ┌──────────────────┐   │    │             │
  │    INVENTORY     │◀──┼────┼─────────────┘  both decrement stock
  │  Lot · Movement  │   │    │
  └──────────────────┘   │    ▼
                         │  ┌──────────────┐
                         │  │ DIAGNOSTICS  │──ACL──▶ [analysers]
                         │  └──────┬───────┘──OHS──▶ [PACS / DICOMweb]
                         │         │ results return late
                         │         ▼
                         └──▶ back into the Encounter

  ┌──────────────────────┐        ┌──────────────────────┐
  │ SCHEDULING &         │◀──────▶│ NON-CLINICAL         │
  │ RESOURCES            │  books │ SERVICES             │
  │ Appointment · Cage   │◀───────│ Boarding · Grooming  │
  └──────────────────────┘  books └──────────────────────┘
             ▲
             │ books cages
             └──── HOSPITALIZATION

  ┌──────────────────────┐
  │ BILLING & PAYMENTS   │◀── subscribes to events from Clinical Record,
  │ Estimate · Invoice   │    Hospitalization, Dispensing, Non-Clinical,
  │ FiscalReceipt        │    Diagnostics — and from the counter, which
  └──────────┬───────────┘    has no upstream at all
             │ ACL
             ▼
      [fiscal device / tax authority]

  ┌──────────────────────┐
  │ PREVENTIVE CARE      │◀── consumes VaccinationAdministered
  └──────────┬───────────┘
             │ raises DueItemApproaching
             ▼
  ┌──────────────────────┐
  │ CLIENT COMMUNICATION │──ACL──▶ [WhatsApp / SMS / email]
  └──────────────────────┘

  IDENTITY & ACCESS ── Conformist for every context above
```

### 6.5 The relationships that need naming

| Edge | Pattern | Why |
|---|---|---|
| Client ↔ Patient | **Shared Kernel** | `OwnershipRelationship` genuinely belongs to both. Neither may change it unilaterally. |
| Clinical Record → Prescription | **Customer-Supplier** | Prescription cannot exist without an encounter under a care relationship |
| Prescription → Inventory | **Customer-Supplier** | Inventory supplies lot and expiry; dispensing is legally incomplete without them |
| Hospitalization → Scheduling | **Customer-Supplier** | It books cages; it does not own them |
| Non-Clinical → Scheduling | **Customer-Supplier** | Same cages, same booking mechanism, different claimant |
| Everything → Billing | **Published Language** (domain events) | Billing must not reach into clinical internals. It subscribes to events |
| Billing → fiscal authority | **Anti-Corruption Layer** | External, legally rigid, and its model must not leak inward |
| Diagnostics → analysers | **Anti-Corruption Layer** | Machines speak proprietary protocols [sourced: [[PIMS Integration Layer]]] |
| Diagnostics → PACS | **Open Host Service** via [[DICOMweb]] | Imaging is already a standardised published language [sourced: [[DICOM]]] |
| Client Communication → channels | **Anti-Corruption Layer** | WhatsApp's model must not become the clinic's model |
| Identity & Access → all | **Conformist** | One identity model; nobody translates it |

### 6.6 Two boundary calls worth arguing about

**Client and Patient as separate contexts.** They are tightly coupled and could be one registry
module. They are kept apart because their languages genuinely diverge — a Client has a balance and
consents; a Patient has a species and a weight — and because the ownership link between them is
temporal, which is easier to see when neither side owns it. **If in six months no rule has ever
needed them apart, merge them.**

**Boarding and grooming merged into one context.** They share everything that matters: non-clinical,
staff-performed, resource-consuming, no medical record produced. They differ in duration and in
which resource they consume. **If a boarding-specific medication schedule turns out to need clinical
supervision, boarding will need to split out** — that is the signal to watch for.

---

## 7. Ubiquitous language

> **All Russian and Azerbaijani terms below are [review needed].** They were produced by an English-
> language model with limited Azerbaijani and non-expert Russian veterinary vocabulary. They are a
> starting point for a conversation with a practising Baku veterinarian, **not a glossary**. Terms
> that survive that conversation should be marked verified; terms that do not should be replaced
> with what the vet actually says.

### 7.1 The naming rule

Model identifiers are **English**. Meaning is **Russian-authoritative.**

That is not a contradiction. It means: where a Russian clinical concept exists, the English
identifier is chosen to fit *that* concept — not imported from a US product and translated
outward. `Hospitalization` is defined as "what *стационар* means," not as "what an American PIMS
calls hospitalization, rendered in Russian."

Where no English name fits, **the Russian term survives untranslated in the model.** A forced
translation that loses the concept is worse than a foreign-looking identifier.

The rule matters most in a place that looks trivial. Russian-tradition veterinary documentation
uses **анамнез / статус презенс / диагноз / назначения** — the same reasoning sequence as
[[SOAP Note|SOAP]], inherited from a different medical education, not translated from English
[sourced: [[SOAP Note]], [[Ubiquitous Language]]]. Whether Baku vets document in S/O/A/P or in the
Russian tradition determines what the note editor should show, and getting it wrong makes the
product feel foreign in the first five minutes [OPEN-10].

### 7.2 The same word in four contexts

The clearest demonstration of why bounded contexts exist [sourced: [[Bounded Context]]]:

| Context | "Patient" means |
|---|---|
| Clinical Record | An animal with history, problems, observations, diagnoses |
| Billing | Something that generates chargeable line items owed by a client |
| Scheduling | A booking subject with a reason for visit and an expected duration |
| Non-Clinical Services | An occupant of a cage with feeding requirements |

Four valid meanings. One unified `Patient` object serving all four is either too broad to reason
about or too narrow to be useful.

### 7.3 Core glossary

**Clinical Record**

| Model term | RU | AZ | Precise meaning |
|---|---|---|---|
| `Encounter` | приём | qəbul | One clinical interaction between a veterinarian and a patient, with a start and an end. **Not** an appointment. |
| `CareRelationship` | — | — | The [[VCPR]]. No established local term found; likely does not exist as a named concept [OPEN-2] |
| `ProblemList` | список проблем | problem siyahısı | Longitudinal, patient-level, persists across encounters |
| `ClinicalObservation` | объективное обследование | müayinə | A measured finding with value, unit, time, and measuring party |
| `Anamnesis` | анамнез | anamnez | Client-reported history. Retained untranslated — "history" loses the provenance connotation |
| `Diagnosis` | диагноз | diaqnoz | Working or definitive; distinct from a differential |
| `DischargeSummary` | выписка | — | Required record component, not a courtesy |

**Hospitalization**

| Model term | RU | AZ | Precise meaning |
|---|---|---|---|
| `Admission` | госпитализация | stasionara qəbul | Entry into inpatient care; opens the stay |
| `TreatmentSheet` | лист назначений | — | The central inpatient document: scheduled orders and their administration |
| `TreatmentOrder` | назначение | təyinat | One scheduled instruction with a due time |
| `Administration` | введение / выполнение | — | Record that an order was carried out, refused, or missed — by whom, when |
| `Handover` | передача смены | növbə təhvili | Shift change; a first-class event, not a report |

**Client, Patient, Money**

| Model term | RU | AZ | Precise meaning |
|---|---|---|---|
| `Client` | клиент | müştəri | The responsible, consenting, paying party. May be a legal entity |
| `Owner` | владелец | sahib | The clinical-conversation term for the same party. Kept distinct: ownership is a *relationship*, client is a *role* |
| `Patient` | пациент | pasiyent | The animal. See §7.2 |
| `Prescription` | рецепт | resept | The authorising document |
| `DispenseEvent` | отпуск препарата | — | The act of handing over, with lot and expiry |
| `Estimate` | смета | — | What the client agreed to before work began |
| `Invoice` | счёт | hesab | The commercial document |
| `FiscalReceipt` | чек | — | The legally-registered artifact. **Not** the invoice |
| `ClientBalance` | долг | borc | Running amount owed across visits |
| `Lot` | партия | partiya | Stock batch with an expiry. The unit dispensing legally requires |
| `BoardingStay` | передержка | — | A non-clinical stay |

---

## 8. Aggregates and invariants

An **invariant** is a rule that must be true at every moment, that no code path may violate, and
that should be enforced as close to the data as possible. These are numbered so they can be cited
in code comments, tests, and reviews.

They are the reason this document exists. Everything else can be renegotiated cheaply; these cannot.

### 8.1 Clinical Record

**Aggregate root: `Encounter`.** Contains observations, anamnesis, diagnoses, plan, and its own
finalisation state. References — never contains — Patient, Client, and Veterinarian.

| # | Invariant | Consequence of violating it |
|---|---|---|
| **CR-1** | A finalised Encounter is **immutable**. Corrections are separate `Amendment` records carrying author, timestamp, reason, and prior-version reference. No storage technology may permit destructive update or delete on a finalised clinical record. [sourced — 2 independent sources: [[Veterinary Medical Record]], [[Audit Trail]]] | The record stops being legal evidence |
| **CR-2** | Only a veterinarian may finalise an Encounter. Others may contribute to a draft. | Clinical accountability becomes unattributable |
| **CR-3** | Every observation carries **value, unit, time, and measuring party**. No unitless clinical numbers. | Silent unit errors; unusable for dosing |
| **CR-4** | No Encounter may be finalised, and no Prescription issued, without a **current** `CareRelationship`. [sourced: [[VCPR]]] | Prescribing without authority |
| **CR-5** | Subjective content is attributed to its reporter; objective content to its measurer. They are **never one field**. [sourced: [[SOAP Note]]] | Hearsay becomes clinical fact — the exact failure mode of AI scribes [sourced: [[Three Failure Modes of AI Scribes]]] |
| **CR-6** | The `ProblemList` belongs to the **Patient**, not to any Encounter. Encounters open, update, and resolve entries on it. **[D13]** | The longitudinal view of the animal is lost; the record becomes a pile of visits |

### 8.2 Patient

**Aggregate root: `Patient`.**

| # | Invariant |
|---|---|
| **PT-1** | Ownership is a **time-boxed relationship** (`valid_from`, `valid_to`), never a foreign key on Patient. An animal may be rehomed; the record follows the animal, access follows the current owner. [sourced: [[Veterinary Medical Record]], [[Informed Consent (Veterinary)]]] |
| **PT-2** | **Weight is a timestamped observation, never a mutable field on Patient.** Any dose derived from a weight stores the specific observation it used. Correcting a weight later never alters a past calculation. [sourced: [[SOAP Note]]] |
| **PT-3** | Species is a **modelling parameter**, not a display label. Reference ranges, dose ceilings, templates, and vaccination protocols are all keyed by it. Dog ≠ cat in every one. [sourced: [[Multi-Species Support]]] |
| **PT-4** | Death is a **lifecycle state**, not a deletion. A deceased patient's record is retained in full, remains accessible, and must never be purged as "inactive." |

### 8.3 Prescription & Dispensing

**Aggregate root: `Prescription`.**

| # | Invariant |
|---|---|
| **RX-1** | A DispenseEvent records drug, strength, quantity, **lot number**, **expiry date**, and client instructions. A dispense that cannot supply lot and expiry is **not a valid dispense**. [sourced: [[Veterinary Medical Record]]] |
| **RX-2** | Every DispenseEvent reconciles to a documented Encounter under a valid CareRelationship. *Dispensed with no encounter* is the canonical audit failure. [sourced: [[DEA]], [[Controlled Drug Tracking]]] |
| **RX-3** | Every DispenseEvent produces exactly one StockMovement against a specific Lot. Dispensing and stock depletion are **one transaction**, never a nightly reconciliation. |
| **RX-4** | Controlled-substance events are **append-only and independently reconcilable** — like CR-1, not like a report. [sourced: [[Controlled Drug Tracking]]] · Applicability in AZ is [OPEN-5] |
| **RX-5** | A dose calculation stores its **inputs** (weight observation, species, concentration, drug) alongside its output. A dose is not a number; it is a derivation. [sourced: [[Veterinary Clinical Calculators]]] |

### 8.4 Hospitalization

**Aggregate root: `Admission`.** Owns the treatment sheet for the duration of the stay.

| # | Invariant |
|---|---|
| **HS-1** | An Admission is its own aggregate with its own lifecycle — **not a long Encounter**. Encounters occur *within* it (daily rounds). |
| **HS-2** | Every TreatmentOrder resolves to an Administration recording **given, refused, or missed**, with actor and timestamp. **A missing administration is itself a fact**, not an absence of data. |
| **HS-3** | Every Administration is billable at the moment it occurs. Charge capture is continuous, not deferred to discharge. [sourced: [[Missed Charge Capture]]] |
| **HS-4** | An Admission holds a **ResourceBooking** for a cage. It does not own the cage. |
| **HS-5** | At any moment, the current state of every admitted patient — orders due, orders missed, results outstanding, owner — is answerable **without reconstructing it from a person's memory.** [sourced: [[Patient Flow]]] |

### 8.5 Scheduling & Resources

**Aggregate roots: `Appointment`, `Resource`.**

| # | Invariant |
|---|---|
| **SC-1** | **Appointment and Encounter are separate aggregates in separate contexts.** A grooming appointment produces no encounter; a walk-in emergency produces an encounter with no appointment; one appointment may produce several encounters. [sourced: [[StringSoft: Top 5 Simple Workflows for a Veterinary Practice]]] |
| **RS-1** | A Resource — cage, room, table, provider — is owned by Scheduling and **claimed** by Hospitalization and Non-Clinical Services. Neither claimant owns it. Double-booking is impossible by construction. |
| **RS-2** | Appointment **type** determines booked duration and required resources. It is not a label. [sourced: [[StringSoft: Top 5 Simple Workflows for a Veterinary Practice]]] |

### 8.6 Billing & Payments

**Aggregate root: `Invoice`.**

| # | Invariant |
|---|---|
| **BL-1** | An Invoice requires **neither a Patient nor an Encounter**. The retail counter sells to walk-ins. |
| **BL-2** | Billing learns of clinical activity through **domain events only**. It never reads clinical internals. |
| **BL-3** | Estimate and Invoice are **different documents**. An Invoice exceeding its Estimate is a flagged condition requiring client agreement, not a silent adjustment. |
| **BL-4** | Invoice and FiscalReceipt are **different objects** with independent lifecycles. Issuing a fiscal receipt is a legally significant event. [OPEN-7] |
| **BL-5** | Payment is **partial by default**. Full settlement is one case of a general model, not the assumed case. |
| **BL-6** | `ClientBalance` is derived from an append-only ledger of charges and payments. It is never a stored mutable number. |
| **BL-7** | An unpaid balance **never** blocks access to the medical record. [sourced: [[Veterinary Medical Record]]; AZ status OPEN-6, but this is defensible as policy regardless] |

### 8.7 Cross-context

| # | Invariant |
|---|---|
| **IN-1** | Every state-changing action records **who, what, when** — no exceptions, no system-actor shortcuts. [sourced: [[Audit Trail]]] |
| **IN-2** | Consent is an **object**, never a boolean: subject, scope, granter, granter's authority, timestamp, form, artifact. Three consents to the same procedure are three objects. [sourced: [[Informed Consent (Veterinary)]]] |
| **IN-3** | Clinical activity and stock movement are **the same transaction seen from two sides**. They never reconcile after the fact. |
| **IN-4** | Money is stored in **minor units as integers**, with an explicit currency. Never floating point. |
| **IN-5** | Every context is **location-aware from day one**, even with one location. Retrofitting multi-location is a rewrite. [sourced: [[RaftLabs — How to Build Vet PMS]]] |
| **IN-6** | Records are **retained past** the end of the relationship, the client, and the animal. There is no "delete inactive." [sourced: [[Veterinary Medical Record]]] |

---

## 9. Domain events

The events that cross context boundaries. This list is the **integration contract**: if a context
needs something not on it, either the event is missing or the boundary is wrong.

| Event | Raised by | Consumed by |
|---|---|---|
| `CareRelationshipEstablished` | Clinical Record | Prescription, Client Communication |
| `EncounterOpened` | Clinical Record | Scheduling, Patient Flow views |
| `EncounterFinalized` | Clinical Record | Billing, Preventive Care, Client Communication |
| `EncounterAmended` | Clinical Record | Audit, Billing |
| `ProblemOpened` / `ProblemResolved` | Clinical Record | Preventive Care |
| `ObservationRecorded` | Clinical Record | Diagnostics, Hospitalization |
| `ConsentGranted` / `ConsentWithdrawn` | Client | Clinical Record, Hospitalization, Audit |
| `EstimateApproved` | Billing | Clinical Record, Hospitalization |
| `PrescriptionIssued` | Prescription | Billing, Client Communication, Inventory |
| `MedicationDispensed` | Prescription | Inventory, Billing, Controlled-drug register |
| `PatientAdmitted` / `PatientDischarged` | Hospitalization | Scheduling, Billing, Client Communication |
| `TreatmentAdministered` | Hospitalization | Billing, Inventory |
| `TreatmentMissed` | Hospitalization | Patient Flow views, Handover |
| `ShiftHandedOver` | Hospitalization | Patient Flow views |
| `LabResultReceived` | Diagnostics | Clinical Record, Loose-End tracking, Client Communication |
| `StockMovementRecorded` | Inventory | Billing, Reporting |
| `LotExpiringSoon` | Inventory | Operations views |
| `InvoiceIssued` / `PaymentReceived` | Billing | Client, Reporting |
| `FiscalReceiptIssued` | Billing | Audit, Reporting |
| `VaccinationAdministered` | Clinical Record | Preventive Care |
| `DueItemApproaching` | Preventive Care | Client Communication |
| `BoardingStayStarted` / `Ended` | Non-Clinical Services | Scheduling, Billing |

Two properties any implementation must satisfy: events are **immutable facts in the past tense**,
and every consumer is **idempotent** — the same event delivered twice must not double-charge,
double-dispense, or double-message.

---

## 10. Cross-cutting concerns

**Species.** A parameter running through dosing, reference ranges, templates, and vaccination
protocols. Companion-only still means dog ≠ cat everywhere [sourced: [[Multi-Species Support]]].
The exotics seen in Baku practice — rabbits, birds, reptiles — are [OPEN-11]; if they are routine,
PT-3 becomes considerably more expensive.

**Time.** Azerbaijan is UTC+4 and has observed no daylight saving since 2016 — a genuine
simplification for treatment-sheet scheduling, which is the part of the system where a DST
discontinuity would cause real harm. Store instants in UTC; render in clinic-local time.
CIS expansion introduces multiple zones, so do not bake the offset in.

**Tenancy.** Practice → Location → Resource, from day one, with one location (IN-5).

**Language.** English model, Russian-authoritative meaning, Russian and Azerbaijani UI (§7.1).
Clinical free text may be in either language, or mixed within a sentence — which it will be
[assumed]. Never assume one language per record, and never machine-translate stored clinical text.

**Money.** AZN, minor units, integers, explicit currency (IN-4).

**Connectivity.** No ambulatory practice in v1, so full offline-first is out of scope. But a clinic
losing internet mid-consultation must not lose the note being written. Local draft durability with
recovery on reconnect — considerably weaker than the offline-first architecture described in
[[Offline-First Mobile Vet Architecture]], and adequate here.

**Attribution.** Every actor is a real identified person (IN-1). Shared logins destroy the audit
trail [sourced: [[Audit Trail]]], which means **per-user pricing that pushes a clinic to share
logins is a compliance defect, not a pricing choice** [sourced: [[PMS Pricing Models]]].

---

## 11. Deliberately out of scope

Each of these is excluded on purpose. Excluding them is a decision that can be revisited; drifting
into them without deciding is not.

| Excluded | Reason |
|---|---|
| **Pet insurance** | Effectively absent in Azerbaijan. Large parts of US PIMS design exist to serve it |
| **Mixed and large-animal practice** | Explicitly out of v1 practice scope. Would force herd-as-subject, food-animal withdrawal periods, and a 0.5–800 kg weight range [sourced: [[Multi-Species Support]]] |
| **Ambulatory / mobile practice** | Would make offline-first a core invariant and conflict resolution a **domain** decision rather than an infrastructure one |
| **Referral networks** | Assumes a specialist ecosystem; unverified for Baku [OPEN-12] |
| **Telemedicine** | Turns entirely on whether a care relationship may be established remotely [OPEN-3] |
| **AI scribing** | Deliberately deferred. The domain model must be right first — a scribe writes *into* this model, and building it early would let the tool's convenience shape the record. [sourced: [[Three Failure Modes of AI Scribes]]] |
| **[[FHIR]] compliance** | No interoperability partner exists to exchange with. Revisit when a lab, insurer, or registry requires it [sourced: [[FHIR]]] |
| **US regulatory frameworks** | DEA, HIPAA, state practice acts. Reference only (§5.4) |

---

## 12. OPEN register

Unanswered questions with real consequences. **Not decoration** — each names what the model needs,
why it matters, and what is assumed meanwhile.

| # | Question | Why it matters | Interim assumption |
|---|---|---|---|
| **OPEN-1** | How does a Baku companion clinic actually run its day? | §2 is reconstructed from US and Western European sources. It is the weakest part of this document | The flow in §2. **Highest-value question here.** Resolve by observation, not reading — see [[Workflow Analysis]] |
| **OPEN-2** | Does AZ law condition prescribing on a prior examination or relationship? | Determines whether CR-4 is a legal invariant or a product choice | Model the relationship regardless |
| **OPEN-3** | Is prescribing authority attached to the individual vet or the clinic? Can it be established remotely? | Decides locum and colleague workflows, and whether telemedicine is possible at all | Attach to the individual; permit clinic-level delegation as configuration |
| **OPEN-4** | What may a *ветфельдшер* do independently under AZ law? | The permissions model. A US-derived vet-tech scope will misfit | Administer under direction; record observations; not finalise records |
| **OPEN-5** | Does AZ require a controlled-substance register in veterinary practice? Per administration or per container? Who signs? Retention? | **Answer before building.** If required it is an append-only invariant (RX-4), not a report. Retrofitting is expensive | Assume required, per administration, single signature, 7 years |
| **OPEN-6** | Does AZ grant clients a right of access to their animal's record? On what terms? | Decides whether BL-7 is law or policy | Grant access on request; never withhold over debt |
| **OPEN-7** | Which veterinary transactions require a fiscal receipt in AZ? Through what device or channel? What happens on refund or correction? | Decides whether BL-4 is one integration or several, and how refunds work | Invoice and FiscalReceipt separate; fiscal issuance is an event |
| **OPEN-8** | What retention period applies to AZ veterinary clinical records? | Purge policy, storage cost, export obligations | 7 years minimum, append-only, never purge deceased patients |
| **OPEN-9** | Is WhatsApp actually the clinic–client channel in Baku, or is it Telegram, SMS, or a phone call? | Decides the first Client Communication adapter, and whether messaging is core or peripheral | WhatsApp first, channel modelled as a port |
| **OPEN-10** | Do Baku vets document in SOAP, or in the анамнез / статус / диагноз / назначения tradition? | Decides what the note editor shows. Getting it wrong makes the product feel foreign in five minutes | Offer the Russian-tradition structure by default, SOAP as an option |
| **OPEN-11** | How routine are exotics — rabbits, birds, reptiles — in Baku companion practice? | Determines how much PT-3 costs. Exotic dosing and reference ranges are a large body of work | Dog and cat first-class; exotics recorded but not clinically supported |
| **OPEN-12** | Does a specialist referral ecosystem exist in Baku? | Decides whether referral is a real workflow or a v3 fantasy | No referral workflow in v1 |

### How to close these

OPEN-1, -4, -9, -10, -11, -12 close by **talking to two or three practising Baku veterinarians**.
That is one week of work and it would resolve half this register.

OPEN-2, -3, -5, -6, -7, -8 close with **a local lawyer or accountant** familiar with veterinary
practice and the fiscal regime. OPEN-5 is the one that gates building.

---

## Change log

| Date | Change |
|---|---|
| 2026-09-10 | Created. Derived from the wiki at 155 pages / 54 of 75 raw sources ingested, following the record-keeping ingest that introduced [[VCPR]], [[Veterinary Medical Record]], [[SOAP Note]], and [[Informed Consent (Veterinary)]] |
| 2026-10-02 | Moved from the Vet Software vault root into the vetora repo as `docs/domain.md`, so the build workflow can read it. Content unchanged; wikilinks still cite the vault's `wiki/` |
