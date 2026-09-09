# Technical decisions

## 1. A small offline-first Electron slice

**Decision:** Use Electron, React, TypeScript, and local SQLite, with one end-to-end workflow rather than a broad platform skeleton.

**Why:** The challenge needs a demonstrable desktop path from field input to locally persisted intelligence. A narrow typed IPC boundary preserves desktop security and keeps the UI testable.

**Trade-off:** Packaging, authentication, synchronization, and production deployment are intentionally deferred.

## 2. Built-in `node:sqlite` behind a repository adapter

**Decision:** Use Node 24's `node:sqlite` through `LocalSqliteDatabase` and repository ports.

**Why:** It provides real transactions without a native addon build/install step. The adapter contains its release-candidate API surface, so another driver can replace it later.

**Trade-off:** The prototype requires a compatible modern Node/Electron runtime and should reassess the adapter when the API stabilizes.

## 3. Real QVAC path, explicit development mock

**Decision:** Implement QVAC with `@qvac/sdk` 0.19.0 and keep a separate deterministic mock that is named `Development Mock` at runtime.

**Why:** Local structured extraction is the product path, while deterministic development and automated testing must not depend on a model download. A failed QVAC load/inference remains a visible error; engine identity never changes silently.

**Trade-off:** The first real run needs the model artifact and compatible local hardware. The mock handles a constrained demonstration grammar only.

## 4. On-device inference, not delegated inference

**Decision:** Use QVAC's local llama.cpp completion handler. Do not describe peer-to-peer model execution as part of this implementation.

**Why:** QVAC SDK 0.19 removed inference delegation/provider APIs. Keeping the extraction port independent preserves an extension seam without claiming a capability the installed SDK does not expose.

**Trade-off:** Every real inference run consumes resources on the user's device.

## 5. Immutable observations and derived projections

**Decision:** Save visits as append-only evidence aggregates and build Customer 360 as a versioned read projection.

**Why:** A new field report can corroborate or contradict older evidence. Overwriting the prior row would erase source, observer, time, uncertainty, and auditability.

**Trade-off:** Read logic is more deliberate than CRUD over one mutable equipment table.

## 6. Unknown is a first-class state

**Decision:** Distinguish `Missing`, `Known`, and `DeclaredUnknown`; keep age as a discriminated union.

**Why:** Missing input can justify one follow-up, while “I don't know” must be retained and must not trigger the same question forever. Qualitative ages must not become fabricated numeric years.

**Trade-off:** Consumers must handle nulls and tagged unions explicitly.

## 7. Explainable confidence and duplicates

**Decision:** Store versioned confidence reasons/evidence IDs and versioned duplicate scores/reasons. Never auto-merge.

**Why:** A business user must be able to trace why information appears and distinguish repeated entry, independent corroboration, and conflict.

**Trade-off:** The current heuristics are intentionally simple and will need calibration against real reviewed data.

## 8. No invented freshness policy

**Decision:** Calculate observation/verification elapsed days but return freshness and aging classifications as unknown/not configured.

**Why:** No authoritative business thresholds were supplied. Showing a guessed red/amber/green policy would present invention as domain fact.

**Trade-off:** Aging counts remain unavailable until product owners define thresholds.

## 9. Synthetic fixtures only

**Decision:** Seed three fictitious facilities with fictitious manufacturers and mark every fixture as synthetic.

**Why:** The referenced workbook and DOCX were unavailable. Synthetic data provides a stable demo and automated-test baseline without implying source provenance that does not exist.

**Trade-off:** Spreadsheet ingestion and mapping to official challenge records remain unimplemented until the source file is provided.
