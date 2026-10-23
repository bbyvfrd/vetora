---
status: accepted
date: 2026-10-24
---

# One implementation per printed document, rendered to PDF in the worker from the same sheet

Spec 0001 ("Documents", and the Documents row of its stack table) chose `@react-pdf/renderer` components rendered only in the worker, "not HTML", each issued PDF stored with its bytes, SHA-256 hash and template version and never rendered again, and asked the design system feature to reconcile that with the design system's print documents. Those documents are HTML sheets: `PrintSheet` with `Letterhead`, `PrintSection` and `SignatureBlock`, or a `Receipt`, on A4, A5 and 80 mm paper through `@page` rules, printed from a `PrintPreview` through the browser's print dialog, with pagination, repeated table headings and page numbers already designed; the roadmap's feature 14 assumes them. We keep the sheets as the one implementation of each document: drafts and on screen printing go through the browser as designed, and from slice 6 the worker renders the same sheet to PDF with a headless Chromium (Playwright's pinned build) and stores the bytes, hash and template version exactly as spec 0001 requires. `@react-pdf/renderer` is dropped. This amends spec 0001's Documents row and Documents section, and its consequence that nothing in the stack runs a browser engine: the worker image does.

## Considered options

- **Rebuild the five documents in React PDF** beside the sheets: two implementations of five documents in three languages, drift between what the clinic previews and what it stores, and React PDF's CSS subset against print CSS that already exists.
- **Store the HTML and its data, no PDF**: the content is exact but the rendering is not fixed, which is weaker for an inspection or a dispute than a hashed PDF.
- **Capture the browser's own print to PDF**: not possible from code; the dialog belongs to the user.
- **Render the sheets in the worker with Chromium** (chosen): one implementation, the stored document still a PDF with a hash.

## Consequences

- The worker image carries Chromium (hundreds of megabytes, pinned with Playwright) and the Roboto file; rendering stays in the worker, never in the API process that serves live streams (spec 0001's rule stands).
- The print components land in `packages/ui` with the rest of the design system now (feature 4, ADR 0003); the worker rendering is built at feature 14 (slice 6) with the slice 6 spike, which adds font embedding, `@page` fidelity and the stored document's template version to its list.
- The design system's rule that nobody prints what they have not seen holds for drafts through `PrintPreview`; an issued document is the stored PDF, served back as bytes.
- The roadmap's feature 14 keeps its "no new decision" basis, now pointing at this record.
