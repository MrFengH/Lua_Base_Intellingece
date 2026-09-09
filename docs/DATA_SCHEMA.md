# Data schema

The conceptual model for a field observation of installed medical equipment, and how it maps to
the TypeScript types and the SQLite tables that exist today.

## The governing principle

An observation records **what one person reported during one visit**, not the current truth
about a hospital's equipment. The schema therefore separates four things that a naive design
would collapse into one value:

| Question                                              | Where the answer lives                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| What was said?                                        | `EvidenceItem.rawText`, retained verbatim              |
| What was directly observed vs. inferred?              | `FieldProvenance.origin`                               |
| Is the value known, unknown, or simply not asked yet? | `FieldProvenance.knowledgeState`                       |
| How sure was the speaker?                             | `FieldProvenance.certainty` and `ConfidenceAssessment` |

**`null` or `Unknown` always beats a plausible guess.** A field that cannot represent "not
known" is a schema defect.

## Knowledge state, origin, certainty

These are three independent axes, defined in `src/domain/model/enums.ts`.

**`KnowledgeState`** — is there a value at all?

- `Missing` — never mentioned, never asked. Justifies one follow-up question.
- `Known` — a value exists.
- `DeclaredUnknown` — the person said they do not know. This is information. The system must
  never ask the same field again, and must never later fill it by inference.

**`FieldOrigin`** — where did the value come from?

- `Observed` — seen directly.
- `Reported` — stated by the person.
- `Derived` — computed by a rule, for example an installation year from an age.
- `Unknown`.

**`FactCertainty`** — how firm was the statement?

- `Explicit` — "the manufacturer is NovaMed".
- `Uncertain` — "I think the manufacturer was NovaMed".
- `Unknown`.

For live extraction, `certainty` may also be `null` when the extractor supplied no certainty at
all. `null` means "not supplied"; `Unknown` means the extractor explicitly classified certainty as
unknown. Neither is promoted to `Explicit`.

The combination is what makes the record honest. "I think the manufacturer was NovaMed" is
`Known` + `Reported` + `Uncertain`, not `Known` + `Observed` + `Explicit`.

During a pending follow-up, declared-unknown replies are recognised deterministically rather than
sent to the extraction engine. Supported Spanish forms include `no sé`, `no se`, `no lo sé`,
`no lo se`, `ni idea`, `no estoy seguro`, `no estoy segura`, `no me fijé`, `no sabría decir` and
`ni idea la verdad`; the existing English forms include `I don't know`, `I do not know`, `unknown`
and `not sure`. An isolated `no` is recognised only while answering a `Do you know…?` follow-up.
The longer matcher is anchored to the start of the reply, while the short `no` form must be the
entire reply, so a correction such as `no es NovaMed, es Orion Imaging` remains a known answer and
proceeds through extraction.

## Age is a union, not a number

`ApproximateAge` in `src/domain/model/age.ts`:

```ts
| { type: 'exact'; years: number }
| { type: 'estimate'; minYears: number; maxYears: number }
| { type: 'range'; minYears: number; maxYears: number }
| { type: 'qualitative'; label: string }
| { type: 'unknown' }
```

"About eight years old" is `estimate`, never `exact`. "Fairly old" is `qualitative` and must
never acquire a number. This is the single most important anti-fabrication guard in the schema,
because age is the field a model is most tempted to invent.

`InstallationEstimate` is derived from age and the observation date. It carries its own
`origin`, is marked `Estimated` rather than `Exact` when the age was approximate, and stays
`unknown` when the age was qualitative or unknown.

## Entities

### Customer

The facility. `src/domain/model/observation.ts`, table `customers`.

| Field                    | Required           | Notes                      |
| ------------------------ | ------------------ | -------------------------- |
| `id`                     | yes                |                            |
| `name`                   | yes                | as reported                |
| `normalizedName`         | yes                | derived, used for identity |
| `city`, `country`        | optional, nullable |                            |
| `createdAt`, `updatedAt` | yes                |                            |

Identity is the unique index on `(normalized_name, city, country)`. Two spellings of the same
hospital in different cities stay separate rather than being merged on a guess.

### ObservationSession

One visit by one observer. Table `observation_sessions`. **Append-only once saved.**

| Field                 | Required           | Notes                                               |
| --------------------- | ------------------ | --------------------------------------------------- |
| `id`                  | yes                | the `observationId` the UI and the projection trace |
| `customerId`          | yes                |                                                     |
| `observer`            | yes                | `{ id, displayName }`, the reporter                 |
| `visitId`             | yes                | groups evidence from one visit                      |
| `observedAt`          | yes                | when the observation happened                       |
| `createdAt`           | yes                | when it was recorded                                |
| `lastVerifiedAt`      | optional, nullable |                                                     |
| `rawInput`            | nullable           | the primary capture, retained for audit             |
| `reportedFacility`    | yes                | the facility as reported, before matching           |
| `evidence`            | yes                | the `EvidenceItem` list                             |
| `supersedesSessionId` | optional, nullable | a later visit correcting an earlier one             |

The table also carries `seed_key`, which is not part of the domain type. It names the seed that
wrote the row and is `NULL` for everything a user captured, so a superseded seed can be retired
without a heuristic guessing which rows were fixtures. Nothing but the seed machinery reads it.

`reportedFacility` is kept separate from the resolved `Customer` on purpose. What the person
said and what the system matched it to are two different facts.

### EvidenceItem

The raw material. Table `evidence_items`.

| Field              | Required           | Notes                                                          |
| ------------------ | ------------------ | -------------------------------------------------------------- |
| `id`               | yes                | referenced by every field's provenance                         |
| `sessionId`        | yes                |                                                                |
| `source`           | yes                | `Text`, `Voice`, or `Photo`                                    |
| `capturedAt`       | yes                |                                                                |
| `rawText`          | nullable           | the verbatim text or transcript                                |
| `localArtifactUri` | optional, nullable | a local file, never uploaded — **PLANNED** for voice and photo |
| `metadata`         | optional           | bounded JSON                                                   |

`Voice` and `Photo` are declared in the enum and the table constraint but no adapter produces
them yet — **PLANNED**. A voice transcript belongs here as `rawText` with `source: 'Voice'`.

A manual correction applied in the review step is itself evidence. Each applied correction is
recorded as an evidence item whose id is prefixed `correction:`, so a corrected field's
provenance points at something that exists rather than at a dangling reference.

### EquipmentObservation

One group of equipment reported in one session. Table `equipment_observations`.

| Field                  | Required           | Kind        | Notes                                                           |
| ---------------------- | ------------------ | ----------- | --------------------------------------------------------------- |
| `id`                   | yes                |             |                                                                 |
| `sessionId`            | yes                |             |                                                                 |
| `groupOrder`           | yes                |             | preserves the order the person described things                 |
| `modality`             | yes                | inferred    | the closed vocabulary below                                     |
| `rawModality`          | optional, nullable | observed    | the words actually used, kept when normalization is not certain |
| `quantity`             | nullable           | inferred    | positive integer or null                                        |
| `manufacturer`         | nullable           | inferred    |                                                                 |
| `model`                | nullable           | inferred    |                                                                 |
| `approximateAge`       | yes                | inferred    | the union above                                                 |
| `installationEstimate` | yes                | **derived** | from age plus `observedAt`                                      |
| `confidence`           | yes                | derived     | `ConfidenceAssessment`                                          |
| `status`               | yes                | derived     | `Confirmed`, `Reported`, `Estimated`, `Unknown`                 |
| `notes`                | nullable           | observed    |                                                                 |
| `evidenceIds`          | yes                |             | which evidence supports this group                              |
| `fieldProvenance`      | yes                |             | per-field knowledge state, origin, certainty, evidence ids      |

#### Modality vocabulary

A closed set, defined once in `src/domain/model/enums.ts` and embedded in the JSON schema the
model must satisfy. The six values match the official `Dummy Reference Lists` modality list;
`Unknown` is this project's addition and exists so uncertainty stays uncertain.

| Value                  | Recognised synonyms, case and accent insensitive                                         |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `MR`                   | `mr`, `mri`, `magnetic resonance`, `resonancia`, `resonador`, `resonadores`              |
| `CT`                   | `ct`, `cat scan`, `computed tomography`, `tomografia`, `tomografo`, `tomografos`         |
| `Ultrasound`           | `ultrasound`, `ultrasonido`, `ultrasonidos`                                              |
| `X-Ray`                | `x-ray`, `xray`, `rayos x`                                                               |
| `Patient Monitoring`   | `patient monitoring`, `patient monitor`, `monitor de paciente`, `monitoreo de pacientes` |
| `Image Guided Therapy` | `image guided therapy`, `image-guided therapy`, `igt`, `terapia guiada por imagen`       |
| `Unknown`              | `unknown`, `desconocido`, and **anything unrecognised**                                  |

`normalizeModality` never guesses. A bare `scanner` is ambiguous between MR and CT, so it
normalizes to `Unknown` and the original wording is kept in `rawModality`. The correction form
presents modality as a select over this vocabulary, so a typed value can no longer be silently
discarded.

**Grouping matters.** "Two are about nine years old and one is about three" is two groups, not
one group of three with an averaged age. Averaging would fabricate.

**Serial number** is not in the schema. It is theoretically observable from a device label, but
nothing in the current capture flow collects it, and adding an unused field invites a model to
fill it. Add it when a capture path actually produces it — **PROPOSED**, see
[DECISIONS.md](DECISIONS.md).

### ConfidenceAssessment

Not a bare number. `src/domain/model/confidence.ts`.

| Field             | Notes                                                              |
| ----------------- | ------------------------------------------------------------------ |
| `level`           | `High`, `Medium`, `Low`, `Unknown`                                 |
| `score`           | 0 to 1, or `null` when nothing is known                            |
| `reasons`         | coded reasons, for example `UNCERTAINTY_LANGUAGE`, `DERIVED_FACTS` |
| `evidenceIds`     | what the assessment was based on                                   |
| `strategyVersion` | `confidence-v1`, so stored assessments stay interpretable          |

A score with no explanation is not acceptable output. The reason codes are what let a reviewer
disagree with the number.

### DuplicateCandidate

Table `duplicate_candidates`. See the deduplication section below.

## Field classification summary

| Classification        | Fields                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required              | `observationId` (session id), `customerId`, `observer`, `visitId`, `observedAt`, `modality`, `approximateAge`, `confidence`, `fieldProvenance`, `evidenceIds` |
| Optional / nullable   | `city`, `country`, `quantity`, `manufacturer`, `model`, `notes`, `rawModality`, `lastVerifiedAt`, `localArtifactUri`                                          |
| Inferred by the model | `modality`, `quantity`, `manufacturer`, `model`, `approximateAge`, `notes`, `certainty`                                                                       |
| Derived by rules      | `normalizedName`, `installationEstimate`, `confidence`, `status`, duplicate scores                                                                            |
| Explicitly unknowable | any field with `knowledgeState: 'DeclaredUnknown'`                                                                                                            |
| Not modelled yet      | `serialNumber`, `locationWithinFacility`, `condition` — **PROPOSED**                                                                                          |

`locationWithinFacility` and `condition` were considered and left out. Neither is collected by
the current follow-up flow, and an unused nullable field is an invitation to hallucinate. Both
are reasonable additions once the capture flow asks for them.

## The extraction contract

`src/application/contracts/extraction.ts` defines the Zod schema the model must satisfy. It is
deliberately narrower than the domain model: the model produces observations, and the domain
derives everything else.

The model returns: `customer { name, city, country }` and `equipment[] { modality, rawModality,
quantity, manufacturer, model, approximateAge, notes, certainty }`. `certainty` is nullable when
the extractor supplies no assessment. It does **not** return
confidence scores, installation years, provenance, or duplicate judgements. Those are computed
from rules the team can inspect and version, not asserted by a model.

That split is the second anti-fabrication guard. A model asked for `confidence: 0.9` will
supply 0.9.

## Worked example

Input:

> "Vi dos resonadores NovaMed. Uno parece bastante nuevo y el otro probablemente tenga unos
> ocho años. También había un tomógrafo Orion Imaging, pero no pude ver el modelo."

Three groups, because the two MR units have different ages:

| Group | modality | quantity | manufacturer    | model  | approximateAge                                     | certainty   |
| ----- | -------- | -------- | --------------- | ------ | -------------------------------------------------- | ----------- |
| 1     | `MR`     | 1        | `NovaMed`       | `null` | `{ type: 'qualitative', label: 'bastante nuevo' }` | `Uncertain` |
| 2     | `MR`     | 1        | `NovaMed`       | `null` | `{ type: 'estimate', minYears: 7, maxYears: 9 }`   | `Uncertain` |
| 3     | `CT`     | 1        | `Orion Imaging` | `null` | `{ type: 'unknown' }`                              | `Explicit`  |

Note what does **not** happen: "bastante nuevo" does not become 2 years; the missing models stay
`null` rather than being guessed from the manufacturer; "probablemente" makes the age
`Uncertain` rather than confident; and the original Spanish stays in `rawText`.

## Deduplication

The problem: two colleagues visit the same hospital and both report a NovaMed MR. Are those the
same scanner, or two scanners?

**What exists today.** `DuplicateDetectionService` scores a pair and produces a
`DuplicateCandidate` with a relationship of `PossibleDuplicate`, `PossibleCorroboration`,
`PartialMatch`, `PossibleConflict`, or `NoMatch`, plus coded reasons and a version tag. Same
customer and compatible known modality are hard gates. Manufacturer, model, and age
compatibility adjust a transparent score. Independent observer or visit pushes toward
corroboration rather than duplication.

**Records are never merged automatically.** A candidate is a review item with a
`resolution` that a human sets. Merging on a low-certainty score would destroy the audit trail
that the append-only design exists to protect.

**What would make this better — PROPOSED, not implemented:**

- Serial number, which would make identity near-certain when available.
- Location within the facility, which distinguishes two identical scanners in different rooms.
- Room or department labels.
- Installation year narrowed by a second observation.
- A stable local equipment identity that survives across observations, so corroboration
  accumulates instead of producing pairwise candidates.

**The rule to preserve:** a low-certainty match produces a candidate for a human, never a merge.
See [DECISIONS.md](DECISIONS.md) for the recorded decision.
