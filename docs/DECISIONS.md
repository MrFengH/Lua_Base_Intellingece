# Technical decisions

Lightweight ADR log. Decisions 1 to 9 are **Accepted** and implemented; they were recorded in a
short Decision / Why / Trade-off form and are left as written. Decisions from 10 onward use the
fuller Context / Decision / Reason / Consequences / Status form and may be **Proposed**, meaning
the question is open and nothing has been built.

Only architecturally significant decisions belong here. Do not change an accepted decision
without adding a new entry that supersedes it.

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

### Amendment, 2026-09-09 — the workbook arrived and its 20 records are now the seed

**What changed:** `Dummy_Installed_Base_Hackathon.xlsx` was supplied. Its README sheet states the
20 rows of `Dummy Installed Base` are "to use as expected output / database seed", so they replace
the three invented facilities outright. `DEVELOPMENT_SEED_KEY` moves from
`synthetic-development-v1` to `official-dummy-v1` so the idempotent seed re-applies over an
existing database. `Hospital DemoCare Pacific` keeps the id `seed-customer-democare`.

**What was ingested:** 20 equipment records as 13 visits over 13 facilities, in 13 cities and 10
countries, using the six fictional brands of the `Dummy Reference Lists` sheet. The rows are
transcribed into a static typed table,
`src/infrastructure/seed/official-installed-base-records.ts`. **There is no runtime XLSX parser
and no new dependency**; the data is static and a parser would add a parsing surface for nothing.

**Why replace rather than complement:** keeping the invented facilities alongside would populate
the aggregate view with sites a reviewer cannot find in the official file, which is worse than
either option alone. The guardrail is untouched: the workbook states that all of its customers,
brands, models and observations are synthetic and exist only for hackathon testing.

**Three mapping rules, and what each refuses to invent:**

1. **Age.** An official integer age `n` becomes `{ type: 'estimate', minYears: n, maxYears: n }`,
   never `exact`. That is decision 15 below, taken by a person. The derived installation year
   still equals the official `Estimated Installation Year` column on all 20 rows.
2. **Status and confidence level** are transcribed from the official `Status` and `Confidence`
   columns rather than re-derived, because the slice's purpose is to reproduce the workbook. No
   status or confidence _semantics_ changed: the derivation rules that apply to newly captured
   observations are untouched.
3. **Confidence score stays `null`.** The workbook supplies a level and no score. Attaching a
   number to a level the source never quantified would be the fabrication the schema exists to
   prevent, so the level carries coded reasons and no score.

**Trade-off:** the transcription is manual, so the workbook and the fixture can drift if the
official file is ever revised. `tests/infrastructure/official-seed.test.ts` pins the counts, the
brand set, the modality set, the age mapping and the derived installation years against the
transcribed table, which makes a drift visible but cannot detect a change made only in the
spreadsheet.

**Retiring the seed it replaces.** `seed_imports` recorded _that_ a seed key had been applied but
never _which rows it wrote_, so there was no safe way to remove the previous seed's data. Because
the official seed deliberately reuses `seed-customer-democare`, `seed-session-democare` and
`seed-visit-democare`, a database built by the previous seed failed to start with
`UNIQUE constraint failed: observation_sessions.id`. Migration `002_session_seed_ownership` adds a
nullable `observation_sessions.seed_key`, and `applySeed` now retires the seeds listed in
`SUPERSEDED_SEED_KEYS` before writing. Ownership, not a heuristic, decides what is removed: a
user-captured session always has `seed_key IS NULL` and is therefore never in range. The migration
backfills existing rows from the `fixture` key in `evidence_items.metadata_json`, which is exact,
because until then the seed was the only writer of evidence metadata and the capture workflow wrote
none. Retirement refuses to run rather than break a link if a surviving session supersedes a seeded
one.

**Two things the workbook contradicts itself about**, transcribed as the structured columns state
and flagged rather than silently resolved: observations 12 and 20 carry a model in the
`Dummy Model` column while their own `Follow-up Answer` and `Notes` say the model was not visible.
The structured column is the one the README designates as the seed, so it wins; the follow-up text
is retained verbatim as evidence, so both readings stay inspectable.

## 10. The model reports observations; rules derive everything else

**Context:** A language model asked for a confidence score will supply one, and it will look reasonable. The same applies to installation years, duplicate judgements, and provenance.

**Decision:** The extraction schema the model must satisfy contains only what a person could have said: modality, quantity, manufacturer, model, approximate age, notes, and how certain the speaker sounded. Confidence, installation estimates, field provenance, observation status, and duplicate scores are computed by inspectable domain rules after extraction.

**Reason:** It puts the boundary between "reported" and "derived" in the type system rather than in a prompt instruction. Derived values become versionable and testable, and a reviewer can disagree with a score by reading its reason codes.

**Consequences:** The model cannot express nuance the domain rules do not model, so new derived semantics need code rather than prompt changes. Every derived value carries a strategy version so stored records stay interpretable after the rules change.

**Status:** Accepted, implemented.

## 11. The smallest model that meets the bar

**Context:** QVAC's registry offers completion models from 0.6B to well beyond what a field laptop can run, and the SDK ships twelve worker plugins.

**Decision:** Use `QWEN3_600M_INST_Q4` and enable exactly one plugin. Escalate to a larger model only after measuring the smaller one against the extraction corpus and recording which cases it failed.

**Reason:** Model size costs download time, disk, RAM, latency, and battery on every device in the field. The extraction task is heavily constrained by a JSON schema and a six-value modality vocabulary, so structural correctness is enforced outside the model.

**Consequences:** Extraction quality is bounded by a small model, which makes the adversarial test corpus in TESTING.md the mechanism that detects when the bound has been reached. The escalation path to `QWEN3_1_7B_INST_Q4` is documented in MODEL_STRATEGY.md and costs about 2.8× the download.

**Status:** Accepted, implemented.

## 12. Voice capture via QVAC Whisper

**Context:** Someone walking a hospital corridor would rather speak than type. `SpeechToTextPort` and the `Voice` evidence source already exist as typed seams, unimplemented.

**Decision:** When voice ships, use the QVAC whispercpp transcription plugin with a tiny Whisper model, feeding its transcript into the existing extraction pipeline unchanged.

**Reason:** It reuses the whole downstream pipeline, adds about 42 MiB rather than a second large model, and keeps audio on the device. Transcription and extraction stay separate concerns, so a transcription error is visible as text before it becomes structured data.

**Consequences:** A second model lifecycle to manage, a second plugin in the bundle, and an open question about whether the two models may be resident simultaneously, which needs a measured RAM figure first. The quality bar must be defined against hospital vocabulary, not general word error rate.

**Status:** Proposed. Nothing implemented.

## 13. Deduplication stays deterministic and never auto-merges

**Context:** Two colleagues visiting the same hospital will both report a NovaMed MR. Deciding whether that is one scanner or two is the core data-quality problem, and embedding similarity is the obvious tempting answer.

**Decision:** Keep the transparent scored candidate model. Same customer and compatible known modality are hard gates; manufacturer, model, and age adjust a versioned score with coded reasons. Candidates are surfaced for human resolution and are never merged automatically.

**Reason:** An automatic merge on a low-certainty score destroys the audit trail the append-only design exists to protect, and it is unrecoverable. A wrong candidate is a review item; a wrong merge is lost evidence.

**Consequences:** Duplicates accumulate until someone reviews them, and the heuristics need calibration against real reviewed data that does not exist yet. Serial number and location within the facility would substantially improve matching and are not captured today.

**Status:** Accepted for the current scoring; the improvements are Proposed. See DATA_SCHEMA.md.

## 14. Local database is not encrypted at rest

**Context:** The SQLite file holds facility names, equipment details, reporter identity, and verbatim observation text, on laptops that travel to hospitals.

**Decision:** The prototype relies on operating-system account isolation and full-disk encryption. No application-level database encryption.

**Reason:** `node:sqlite` provides no encryption, and adding a native encrypted driver would reintroduce the native build step that decision 2 avoided. For a prototype with synthetic data the trade is acceptable.

**Consequences:** Device theft is an unmitigated gap, recorded as such in PRIVACY_OFFLINE.md. Any real deployment must revisit this before field use, which likely means changing the persistence driver.

**Status:** Accepted for the prototype. Revisiting it is Proposed and blocking for production.

## 15. Official integer ages map to `estimate`, not `exact` (`X-06`)

**Context:** The 20 official records in the challenge workbook carry a bare integer age. The age
union in `src/domain/model/age.ts` offers `exact`, `estimate`, `range`, `qualitative`, `unknown`.
Fifteen of the twenty official follow-up answers that produced those integers say "around",
"about", "maybe", "roughly", "I think" or "my best estimate". `P2-D1` in `docs/ROADMAP.md` names
this a human decision gate, not one an implementing agent may take, because it sets the honesty
baseline for every seeded record and for everything Customer 360 and the Dashboard display from
it.

**Decision (human, 2026-09-09):** An official integer age `n` maps to
`{ type: 'estimate', minYears: n, maxYears: n }`, **never** to `{ type: 'exact', years: n }`.

**Reason:** The source integers are hedged reported answers, not measurements. Recording a hedged
statement as exact would bake a violation of `AGENTS.md` rule 10 — never turn human uncertainty
into machine certainty — into the demo data itself.

**Consequences:**

1. `deriveInstallationEstimate` returns a single `year` when `minYears === maxYears`, so derived
   installation years still match the official `Estimated Installation Year` column exactly (row 1:
   2026 − 7 = 2019, official 2019). No divergence introduced there.
2. `capture-workflow-service.ts` derives `status` to `Estimated` whenever the age is an estimate or
   a range. This divergence is accepted for now; it is independent evidence that status should come
   from how the information was obtained rather than from age precision, which `B-01` addresses
   separately. It is not a reason to revisit this decision.

   **Narrowed on implementation, 2026-09-09.** The consequence is smaller than anticipated. It was
   written expecting every seeded row to become `Estimated`. The seed is a transcription, not a
   capture, so it carries the official `Status` column directly and keeps the workbook's 13
   `Reported` and 7 `Estimated`. The derivation rule is untouched and the divergence it describes
   now applies only to observations captured through the workflow, which is exactly the scope
   `B-01` covers.

**Status:** Accepted (human decision, resolves `X-06` / `P2-D1`). **Implemented** in `P2-S2`:
`src/infrastructure/seed/development-seed.ts` maps every official integer age through
`officialAge`, and `tests/infrastructure/official-seed.test.ts` fails if any seeded age is
recorded as `exact`. Folded into the amendment of decision 9 above.
