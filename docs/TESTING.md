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
