# Testing

Testing strategy for an application whose core behaviour is produced by a local model.

## The split that makes this tractable

| Suite                | Uses a real model | Deterministic | Command                |
| -------------------- | ----------------- | ------------- | ---------------------- |
| Unit and integration | no                | yes           | `npm test`             |
| Application boot     | no                | yes           | `npm run app:smoke`    |
| QVAC smoke           | **yes**           | no            | `npm run qvac:smoke`   |
| SQLite smoke         | no                | yes           | `npm run sqlite:smoke` |

`npm test` runs against the development mock and test doubles, so it is fast and repeatable in
CI. **A green `npm test` is not evidence that QVAC works.** The smoke command is the only proof
of that, and it needs a real model and compatible hardware. Never report one as the other.

`npm run app:smoke` builds and launches Electron against a temporary database in Development
Mock mode. It fails if the built preload cannot expose `window.installedBaseApi`, if
`getInferenceStatus()` fails, if React does not render, if the console reports a preload or
renderer error, or if the application database schema is not created.

## Unit tests

Ordinary application logic, no model involved. Vitest, in `tests/`, mirroring the `src/` layer.

Current coverage:

| File                                                       | Covers                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tests/domain/normalization-and-age.test.ts`               | MRI to MR normalization; installation year derived from age and marked `Derived`; qualitative age never becoming a number |
| `tests/domain/follow-up.test.ts`                           | Question ordering; a field declared unknown is never asked again                                                          |
| `tests/domain/duplicate.test.ts`                           | Scoring on matching fields; modality as a hard gate even at the same hospital                                             |
| `tests/application/capture-workflow.test.ts`               | Extraction, unknown handling, append-only save                                                                            |
| `tests/application/extraction-schema.test.ts`              | Malformed extraction rejection: inverted ages, invalid modalities and extra properties; valid extraction acceptance       |
| `tests/infrastructure/persistence.test.ts`                 | Atomic multi-equipment save; rollback on partial failure; idempotent seed                                                 |
| `tests/infrastructure/development-mock-extraction.test.ts` | Heterogeneous age groups split rather than averaged                                                                       |

Domain rules are pure functions and should stay that way. Every anti-fabrication rule that can
be expressed as a pure function belongs here rather than in a model prompt, because a test is
cheaper and more reliable than a prompt instruction.

## Integration tests

The seam between the application and QVAC.

**Built** (P4-S4) — `tests/infrastructure/qvac-observation-extraction.test.ts`, mocking `@qvac/sdk`
at the module boundary so no real model or hardware is needed in `npm test`. Covers:

- initialization is explicit and idempotent; a second `initialize()` does not reload;
- model selection: the default registry model, a configured alternate `modelDescriptor` (used for
  the 0.6B vs 1.7B vs 4B comparison — see `MODEL_STRATEGY.md`), and a local `modelPath` override each
  load through the correct `loadModel` call;
- a load failure surfaces as an error and leaves the runtime in `error`, not `ready`;
- an inference failure — truncated/malformed JSON, or JSON that fails schema validation — does not
  produce a partial or default record; it rejects;
- a well-formed extraction with `Unknown`/`null` fields passes through unchanged;
- `dispose()` unloads and the reported status returns to `model-not-loaded`.

**No fallback to the mock ever occurs** when the engine is QVAC — there is no code path for it in
`QvacObservationExtractionService`, so this is verified by inspection rather than a dedicated test.

Malformed payload rejection at the contract boundary is covered directly by
`tests/application/extraction-schema.test.ts`. The adapter integration tests above prove that the
resulting validation failure is surfaced rather than silently repaired.

## Structured extraction tests

The heart of the strategy. Each case is an input plus assertions about what must and must not
appear in the output.

Run them against the mock for plumbing, and against the real model when verifying model
behaviour or a model change.

### Required cases

| Case                            | Input sketch                                              | Must produce                                               | Must never produce                       |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| Complete observation            | facility, modality, quantity, brand, age all stated       | all fields `Known`, certainty `Explicit`                   | any invented field                       |
| Partial observation             | modality and quantity only                                | brand and model `null`, follow-up offered                  | a guessed brand                          |
| Unknown manufacturer            | "un tomógrafo, no vi la marca"                            | `manufacturer: null`                                       | a brand inferred from context            |
| Unknown model                   | "un equipo de Orion Imaging, no pude ver el modelo"       | `model: null`                                              | a model name inferred from the brand     |
| Several devices in one sentence | "dos resonadores NovaMed y un tomógrafo Orion Imaging"    | separate MR and CT groups                                  | one merged group                         |
| Differing ages, same modality   | "dos tienen unos nueve años y uno unos tres"              | two groups, 2 at ≈9 and 1 at ≈3                            | one group of three with an averaged age  |
| Speaker self-corrects           | "primero pensé que eran tres, pero en realidad había dos" | quantity 2                                                 | quantity 3, or both                      |
| Ambiguous quantity              | "había varios ecógrafos"                                  | `quantity: null`, follow-up offered                        | an invented number                       |
| Approximate age                 | "quizá unos ocho años"                                    | `{ type: 'estimate', ... }`, certainty `Uncertain`         | `{ type: 'exact', years: 8 }`            |
| Qualitative age                 | "parece bastante nuevo"                                   | `{ type: 'qualitative', label: ... }`                      | any numeric age                          |
| Contradictory information       | "era de NovaMed... bueno, quizá de Aurelia Health"        | both claims kept, field `Uncertain`, follow-up naming both | a silent pick between the two            |
| Colloquial phrasing             | "tenían un par de máquinas de resonancia bastante viejas" | MR, quantity 2, qualitative age                            | a numeric age from "viejas"              |
| Spanish                         | the README demo sentence in Spanish                       | correct extraction                                         | untranslated field values                |
| English                         | the same in English                                       | correct extraction                                         | —                                        |
| Declared unknown                | "no sé" answering a follow-up                             | `DeclaredUnknown`, question not repeated                   | the field left `Missing` and asked again |

### The assertion that matters most

Every case asserts an absence as well as a presence. Checking that "NovaMed" appears is easy;
checking that no manufacturer appears when none was stated is the test that actually protects
the data. Write both.

### Project-authored reference cases

```
"Había dos equipos NovaMed, creo que ambos eran resonadores."
  → 2 × MR, manufacturer NovaMed, certainty Uncertain on modality

"El equipo de Orion Imaging parecía viejo, quizá diez años, pero no pude ver el modelo."
  → 1 × unknown-or-stated modality, manufacturer Orion Imaging, age estimate ≈10, model null

"Primero pensé que eran tres, pero en realidad había dos."
  → quantity 2
```

### Genuine examples from the challenge brief

```
"I visited Hospital Alpha today. They have three MR systems, two CT systems and four
 ultrasound systems. Two of the MR systems appear to be around 8-10 years old."

"I'm at Hospital Alpha in Sao Paulo. I saw two CT systems and three MR systems.
 One of the MR systems looks relatively new."

"There are three MR systems."

User: "They have two CTs."
Assistant: "Do you know the manufacturer or model?"
User: "I know one is approximately six years old, but I don't know the model."
```

## Offline tests

The critical path must complete with no network. Procedure, static scan commands, and pass
criteria are in the `offline-validation` skill. Summary:

1. Static scan for hidden network dependencies: analytics, remote fonts, CDNs, telemetry,
   remote configuration.
2. Ensure the model is cached locally, or set `CIB_QVAC_MODEL_PATH`.
3. Disable network adapters.
4. Run capture, follow-up, correction, review, save, Customer 360, and Dashboard.
5. Run `npm test` and `npm run qvac:smoke` offline.
6. Confirm no silent degradation: the engine badge still reads QVAC and On-device throughout.

## Regression tests

**Built — a versioned extraction corpus** (`extraction-corpus-v1`), under `tests/fixtures/corpus/`
and exercised by `tests/application/extraction-corpus.test.ts` as part of `npm test`, against the
development mock only:

- the 10 official Voice Test Prompts, the 3 reusable official Installed Base rows (7, 13, 15), the
  4 genuine challenge-brief examples, and the project-authored cases from this file and from
  `README.md`, each carrying its real `origin.source` (`official-workbook`, `challenge-brief` or
  `project-authored`) and locator;
- each case asserts a structured expectation per field using one of `Known`, `DeclaredUnknown` or
  `MustNotInfer` — never a bare `null` — so "the model correctly recognised an explicit unknown" is
  distinguishable from "the model simply never fabricated anything";
- **every case in the corpus asserts at least one absence**, enforced by a dedicated test
  (`extraction-corpus.test.ts`, "asserts at least one absence... in every case (P4-S2)"), so the
  corpus proves nothing was invented and not only that something was found;
- eight cases are explicitly adversarial anti-fabrication tests, named in
  `docs/ROADMAP.md` P4-S2: official prompts 4, 5, 6, 8, 9 and 10, plus Installed Base rows 7 and
  15;
- `validateCorpus` checks structural consistency (unique ids, valid ages, recognised modalities and
  follow-up fields) and is itself covered by a test that a broken case is flagged, not silently
  accepted.

Scoring the real QVAC model against this corpus is a separate, on-demand step — see `P4-S3` below
and `scripts/qvac-corpus-eval.ts` — because it needs a real model and is not deterministic, so it
must never join `npm test`.

Alongside it: any bug fixed gets a test in the same change, and any documented behaviour that
changes gets its documentation updated in the same change.

### P4-S3 — real-model scoring run

`scripts/qvac-corpus-eval.ts` runs the same corpus against the real `@qvac/sdk` adapter
(`QvacObservationExtractionService`, the identical class the application uses) and the real
`FollowUpQuestionService`. It is invoked with `npm run corpus:eval`, needs a real model and
compatible hardware, and is **not** part of `npm test`. It never changes the model, the
quantization or the prompt; it only measures. Results are written under `docs/qvac-eval-runs/`,
dated, with one JSON file per run recording every case's pass/fail status and, for each failure,
the input, the expected value and what the model actually produced. The pass rate is summarised in
[PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md) and [MODEL_STRATEGY.md](MODEL_STRATEGY.md).

### Manual walkthrough — duplicate detection, a corroboration run and a conflict run

Moved here from the public README, which now stays a first-read overview. This is a developer/QA
script, not demo material — see [docs/DEMO.md](DEMO.md) for the judge-facing walkthrough.

The official seed already carries one MR observation for Hospital DemoCare Pacific
(`seed-customer-democare`): 2 × MR, NovaMed, approximately 7 years old, stored as
`seed-equipment-01` (workbook row 1). Reporting the same facility again as a fresh capture — the
way a second field colleague would — exercises the duplicate-scoring rules in
[Technical decisions](DECISIONS.md) decision 7 against a real comparison instead of an invented
one. Neither run below changes the 0.65 candidate threshold or the scoring weights in
`duplicate-detection-service.ts`; they only choose answers that land on either side of it.

**What you will see on screen.** After saving, Customer 360 shows a pending-candidate count and a
review action. The review panel presents the new observation beside the existing comparable,
including relationship, score, `duplicate-v1`, the detector's real reason codes, relevant field
differences and the supporting account. A person can record `NotDuplicate`, `SameEquipment` or
`CorroboratingEvidence`; the decision moves to resolved history and persists without merging or
modifying either observation. The interface is in Spanish; the enum values above are the internal
codes, shown on screen with their Spanish labels (e.g. `SameEquipment` → "Mismo equipo").

Start each run as a **new** capture (do not edit the seeded record), against a freshly seeded
database if you want the candidate count to match exactly — otherwise the second run's comparables
also include the first run's saved observation, which still produces a conflict but no longer only
against `seed-equipment-01`. Type the messages **exactly** as written, including "Panama" with no
accent — see the caveat below.

**Known trap in the development mock: do not write an accented "Panamá".**
`DevelopmentMockObservationExtractionService.extractCustomer` looks up the known customer by name,
then unconditionally overwrites `city`/`country` with whatever it parses from the "en `<place>`"
phrase in the same sentence, even when a known customer was already matched. The official seed
stores this facility's country as plain-ASCII `Panama`. Typing "en Panamá" makes the parsed country
`Panamá` (accented), which no longer equals the seeded `Panama` in `findByNormalizedIdentity`'s
exact string comparison, so the save creates a **second, unrelated Hospital DemoCare Pacific
customer record** with no prior equipment — zero comparables, zero duplicate candidates, and no
"Possible matches detected" banner, even though everything else (facility, modality, quantity,
brand, age) extracted correctly. It is a pre-existing defect in the development mock, out of scope
for this walkthrough and not fixed here — worth its own follow-up. Typing the plain-ASCII "Panama"
below avoids it entirely and is what the seed itself uses.

**Run 1 — corroboration. Stored candidate expected: `seed-equipment-01`, score 0.80, relationship
`PossibleCorroboration`.**

1. `Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores.`
2. When asked "¿Conoce el fabricante de los equipos de MR?", answer `NovaMed.`
3. When asked "¿Conoce la antigüedad aproximada de los equipos de MR?", answer `Siete años.`
4. When asked for the model, choose **Revisar información actual** without answering — the model
   question is optional and is not required to save.
5. **Guardar observación**. The app switches to **Customer 360** on Hospital DemoCare Pacific
   automatically. Open **Revisar posibles coincidencias** and confirm the relationship, score,
   reasons and both observations.

**Run 2 — conflict. Stored candidate expected: `seed-equipment-01`, score 0.56, relationship
`PossibleConflict`.**

1. `Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores.`
2. Answer the manufacturer question with `Orion Imaging.`
3. Answer the age question with `Siete años.`
4. Review and save as in run 1.

The score comes out lower than the 0.65 candidate threshold in run 2, but the candidate is still
stored: a manufacturer disagreement marks the pair `PossibleConflict` regardless of the numeric
score, because a conflict is exactly the case a reviewer must see. Run at least one of the two
scripts in QVAC mode as well before presenting — the scoring rule is identical under both engines,
but real-model extraction is not deterministic, so the relationship is the signal to watch and the
score may vary slightly from the numbers above.

**Resolution check.** Choose one of the three human decisions and then select **Registrar decisión
humana**. The candidate leaves the pending count and remains visible under **Resueltos**. Close and
reopen the application to confirm the decision remains there and that both supporting observations
are still present.

A freshly seeded database, before either run, shows 50 total equipment units on the Dashboard (15
MR, 12 CT, 23 Ultrasound) — that is the official-seed baseline, not a fixed number the Dashboard
always shows. Saving both runs above adds two more MR observations on top of it, so a Dashboard
reading taken after this walkthrough will read higher, and any database that already has its own
captured observations will read higher still. Both are expected, not a discrepancy.

## Running everything

```powershell
npm run typecheck
npm run lint
npm test
npm run format:check
npm run app:smoke
npm run sqlite:smoke
npm run qvac:smoke   # real model, real hardware
```

The QVAC smoke prints four lifecycle checks — runtime initialized, model loaded, local
inference completed, structured output validated — plus confirmation that the direct SDK path
was used. A failure to download or load the model is reported as a failure and does not switch
engines.
