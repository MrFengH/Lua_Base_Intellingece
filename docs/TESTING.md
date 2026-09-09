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

Test through `ObservationExtractionPort` with a double. What matters is behaviour the adapter
must guarantee regardless of model output:

- initialization is explicit and idempotent; a second `initialize()` does not reload;
- a load failure surfaces as an error and leaves the runtime in `error`, not `ready`;
- an inference failure does not produce a partial or default record;
- **no fallback to the mock ever occurs** when the engine is QVAC;
- `dispose()` unloads and the reported status returns to `model-not-loaded`;

Malformed payload rejection at the contract boundary is covered directly by
`tests/application/extraction-schema.test.ts`. An adapter integration test must still prove that
the resulting validation failure is surfaced rather than silently repaired.

## Structured extraction tests

The heart of the strategy. Each case is an input plus assertions about what must and must not
appear in the output.

Run them against the mock for plumbing, and against the real model when verifying model
behaviour or a model change.

### Required cases

| Case                            | Input sketch                                              | Must produce                                       | Must never produce                       |
| ------------------------------- | --------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| Complete observation            | facility, modality, quantity, brand, age all stated       | all fields `Known`, certainty `Explicit`           | any invented field                       |
| Partial observation             | modality and quantity only                                | brand and model `null`, follow-up offered          | a guessed brand                          |
| Unknown manufacturer            | "un tomógrafo, no vi la marca"                            | `manufacturer: null`                               | a brand inferred from context            |
| Unknown model                   | "un GE, no pude ver el modelo"                            | `model: null`                                      | a model name inferred from the brand     |
| Several devices in one sentence | "dos resonadores Siemens y un tomógrafo GE"               | separate MR and CT groups                          | one merged group                         |
| Differing ages, same modality   | "dos tienen unos nueve años y uno unos tres"              | two groups, 2 at ≈9 and 1 at ≈3                    | one group of three with an averaged age  |
| Speaker self-corrects           | "primero pensé que eran tres, pero en realidad había dos" | quantity 2                                         | quantity 3, or both                      |
| Ambiguous quantity              | "había varios ecógrafos"                                  | `quantity: null`, follow-up offered                | an invented number                       |
| Approximate age                 | "quizá unos ocho años"                                    | `{ type: 'estimate', ... }`, certainty `Uncertain` | `{ type: 'exact', years: 8 }`            |
| Qualitative age                 | "parece bastante nuevo"                                   | `{ type: 'qualitative', label: ... }`              | any numeric age                          |
| Contradictory information       | "era un Siemens... bueno, quizá un Philips"               | explicit uncertainty or a follow-up                | a silent pick between the two            |
| Colloquial phrasing             | "tenían un par de máquinas de resonancia bastante viejas" | MR, quantity 2, qualitative age                    | a numeric age from "viejas"              |
| Spanish                         | the README demo sentence in Spanish                       | correct extraction                                 | untranslated field values                |
| English                         | the same in English                                       | correct extraction                                 | —                                        |
| Declared unknown                | "no sé" answering a follow-up                             | `DeclaredUnknown`, question not repeated           | the field left `Missing` and asked again |

### The assertion that matters most

Every case asserts an absence as well as a presence. Checking that "Siemens" appears is easy;
checking that no manufacturer appears when none was stated is the test that actually protects
the data. Write both.

### Reference cases from the brief

```
"Había dos Siemens, creo que ambos eran resonadores."
  → 2 × MR, manufacturer Siemens, certainty Uncertain on modality

"El GE parecía viejo, quizá diez años, pero no pude ver el modelo."
  → 1 × unknown-or-stated modality, manufacturer GE, age estimate ≈10, model null

"Primero pensé que eran tres, pero en realidad había dos."
  → quantity 2
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

**PROPOSED — a versioned extraction corpus.** The cases above currently live as individual
tests. A small versioned dataset would make model changes comparable:

- 20 to 40 observations covering the case table, Spanish and English;
- each with expected structured output and, importantly, expected **absences**;
- stored under `tests/fixtures/`, synthetic only, no real facility or patient data;
- versioned, so a model or prompt change is scored as a delta rather than argued about;
- reported as a pass rate, which becomes the structured-output success rate in
  [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md).

Not built in this change. Build it when the first model or prompt change needs to be justified,
which is the moment it stops being speculative.

Alongside it: any bug fixed gets a test in the same change, and any documented behaviour that
changes gets its documentation updated in the same change.

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
