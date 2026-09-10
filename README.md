# Customer Installed Base Intelligence

An offline-first desktop vertical slice for turning field observations into an evidence-backed customer installed-base view. The application captures a visit conversationally, asks one deterministic follow-up at a time, lets the user correct and review the structured result, and saves the observation locally as immutable evidence.

This repository is a prototype, not a production medical or asset-management system. It contains no real patient, hospital, or Philips product data.

## What is implemented

- Conversational text capture with explicit `Unknown` handling and no invented facts.
- Structured review and correction before saving.
- Multiple equipment groups in one visit, including heterogeneous modalities.
- Transactional SQLite persistence of customer, session, evidence, equipment, provenance, confidence, and duplicate candidates.
- Customer 360 projection with supporting evidence and traceable observation IDs.
- Human review of duplicate candidates with side-by-side evidence and persisted resolutions.
- Dashboard by modality and country, plus incomplete-observation counts.
- Deterministic, idempotent seed of the official synthetic challenge dataset.
- A real QVAC on-device inference adapter and a visibly labelled development mock.
- Ports for future Voice/STT and Photo evidence without pretending those sources are implemented.

The seed is the official challenge dataset: the 20 records of the `Dummy Installed Base` sheet, as 13 visits over 13 facilities in 13 cities and 10 countries, using the six fictional brands from the workbook's own reference list. Every facility, brand, model and observation in it is synthetic by construction; the workbook states that they exist only for hackathon testing. The rows are transcribed into a static typed table, so there is no spreadsheet parser and no extra dependency at runtime.

## Runtime modes

Development defaults to `Development Mock` so the entire workflow can be exercised without a model download. The UI always shows the exact engine, execution location, model, network requirement, and runtime state; the mock displays a warning and is never presented as QVAC.

QVAC mode uses `@qvac/sdk` directly. It initializes only after the user requests it, loads the configured model into the local llama.cpp completion worker, requests strict JSON-schema output, drains the QVAC event stream, and validates the final JSON again with Zod. There is no cloud provider and no silent fallback to the mock.

The default model is the SDK descriptor `QWEN3_600M_INST_Q4` (`Qwen3-0.6B-Q4_0.gguf`, approximately 382 MB). Its first download needs network access; inference after the model is cached and loaded runs on the device.

## Requirements

- Node.js `>=24.20.0` and npm `>=10.9.0`; this repository has been verified with Node 24.20.0.
- A desktop environment supported by Electron.
- For QVAC on Windows, a Vulkan 1.4-capable runtime/driver as described in the [QVAC system requirements](https://docs.qvac.tether.io/system-requirements/).

Install dependencies once:

```powershell
npm install
```

Start the development workflow with the labelled deterministic mock:

```powershell
npm run dev
```

Start development with real on-device QVAC:

```powershell
$env:CIB_INFERENCE_MODE = 'qvac'
npm run dev
```

Optional QVAC configuration:

```powershell
$env:CIB_QVAC_MODEL_PATH = 'C:\models\model.gguf'
$env:CIB_QVAC_MODEL_NAME = 'Locally managed model'
```

`CIB_QVAC_MODEL_PATH` selects a local GGUF file and avoids the SDK registry download. `CIB_QVAC_MODEL_NAME` is display metadata. `CIB_DATABASE_PATH` overrides the application database path. An invalid `CIB_INFERENCE_MODE` fails explicitly; accepted values are `qvac` and `mock`. In an unpackaged development run the default is `mock`; in a packaged runtime the default is `qvac`.

### Provisioning the model on another machine

1. After QVAC has downloaded the default model, take `%USERPROFILE%\.qvac\models\*_Qwen3-0.6B-Q4_0.gguf` from the source machine.
2. Copy that GGUF file to the target machine, for example as `C:\models\Qwen3-0.6B-Q4_0.gguf`.
3. On the target, set `$env:CIB_QVAC_MODEL_PATH = 'C:\models\Qwen3-0.6B-Q4_0.gguf'` before starting in QVAC mode.
4. With dependencies already installed, this explicit local path avoids a registry download; inference remains on-device.

This procedure is documented but has not yet been followed on a second machine; that human
validation remains pending.

## Demo path

1. Open **Capture** and confirm the inference badge.
2. With the development mock, enter: `I visited Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.`
3. Answer each follow-up. `I don't know` records a declared unknown and the same field is not asked repeatedly.
4. Use the structured cards to correct a field, then choose **Review current information** and **Save observation**.
5. Inspect the append-only evidence and current projection in **Customer 360**.
6. Inspect local aggregate counts in **Dashboard**.

The application database lives in Electron's per-user `userData` directory unless `CIB_DATABASE_PATH` is set. The standalone seed command writes `data/customer-installed-base.sqlite`; this path is ignored by Git.

### Duplicate detection: a corroboration run and a conflict run

The official seed already carries one MR observation for Hospital DemoCare Pacific (`seed-customer-democare`): 2 × MR, NovaMed, approximately 7 years old, stored as `seed-equipment-01` (workbook row 1). Reporting the same facility again as a fresh capture — the way a second field colleague would — exercises the duplicate-scoring rules in [Technical decisions](docs/DECISIONS.md) decision 7 against a real comparison instead of an invented one. Neither run below changes the 0.65 candidate threshold or the scoring weights in `duplicate-detection-service.ts`; they only choose answers that land on either side of it.

**What you will see on screen.** After saving, Customer 360 shows a pending-candidate count and a review action. The review panel presents the new observation beside the existing comparable, including relationship, score, `duplicate-v1`, the detector's real reason codes, relevant field differences and the supporting account. A person can record `NotDuplicate`, `SameEquipment` or `CorroboratingEvidence`; the decision moves to resolved history and persists without merging or modifying either observation.

Start each run as a **new** capture (do not edit the seeded record), against a freshly seeded database if you want the candidate count to match exactly — otherwise the second run's comparables also include the first run's saved observation, which still produces a conflict but no longer only against `seed-equipment-01`. Type the messages **exactly** as written, including "Panama" with no accent — see the caveat below. The follow-up question text on screen is still English until the interface is localized; only the typed answers are Spanish, per the demo-language decision.

**Known trap in the development mock: do not write an accented "Panamá".** `DevelopmentMockObservationExtractionService.extractCustomer` looks up the known customer by name, then unconditionally overwrites `city`/`country` with whatever it parses from the "en `<place>`" phrase in the same sentence, even when a known customer was already matched. The official seed stores this facility's country as plain-ASCII `Panama`. Typing "en Panamá" makes the parsed country `Panamá` (accented), which no longer equals the seeded `Panama` in `findByNormalizedIdentity`'s exact string comparison, so the save creates a **second, unrelated Hospital DemoCare Pacific customer record** with no prior equipment — zero comparables, zero duplicate candidates, and no "Possible matches detected" banner, even though everything else (facility, modality, quantity, brand, age) extracted correctly. This is exactly the failure a first run of this script hit. It is a pre-existing defect in the development mock, out of scope for this walkthrough and not fixed here — worth its own follow-up. Typing the plain-ASCII "Panama" below avoids it entirely and is what the seed itself uses.

**Run 1 — corroboration. Stored candidate expected: `seed-equipment-01`, score 0.80, relationship `PossibleCorroboration`.**

1. `Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores.`
2. When asked "Do you know the manufacturer of the MR systems?", answer `NovaMed.`
3. When asked "Do you know the approximate age of the MR systems?", answer `Siete años.`
4. When asked for the model, choose **Review current information** without answering — the model question is optional and is not required to save.
5. **Save observation**. The app switches to **Customer 360** on Hospital DemoCare Pacific automatically. Open **Review possible matches** and confirm the relationship, score, reasons and both observations.

**Run 2 — conflict. Stored candidate expected: `seed-equipment-01`, score 0.56, relationship `PossibleConflict`.**

1. `Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores.`
2. Answer the manufacturer question with `Orion Imaging.`
3. Answer the age question with `Siete años.`
4. Review and save as in run 1.

The score comes out lower than the 0.65 candidate threshold in run 2, but the candidate is still stored: a manufacturer disagreement marks the pair `PossibleConflict` regardless of the numeric score, because a conflict is exactly the case a reviewer must see. Run at least one of the two scripts in QVAC mode as well before presenting — the scoring rule is identical under both engines, but real-model extraction is not deterministic, so the relationship is the signal to watch and the score may vary slightly from the numbers above.

**Resolution check.** Choose one of the three human decisions and then select **Record human decision**. The candidate leaves the pending count and remains visible under **Resolved**. Close and reopen the application to confirm the decision remains there and that both supporting observations are still present.

A freshly seeded database, before either run, shows 50 total equipment units on the Dashboard (15 MR, 12 CT, 23 Ultrasound) — that is the official-seed baseline, not a fixed number the Dashboard always shows. Saving both runs above adds two more MR observations on top of it, so a Dashboard reading taken after this walkthrough will read higher, and any database that already has its own captured observations will read higher still. Both are expected, not a discrepancy.

## Commands

```powershell
npm run typecheck       # strict TypeScript validation
npm run lint            # ESLint
npm test                # domain, application, mock, and persistence tests
npm run build           # typecheck plus Electron/Vite bundles
npm run sqlite:smoke    # real node:sqlite transaction smoke
npm run seed            # idempotent local seed of the official synthetic dataset
npm run qvac:smoke      # real SDK/model/inference/schema smoke; never uses the mock
```

The QVAC smoke must print four lifecycle checks—runtime initialized, model loaded, local inference completed, and structured output validated—plus confirmation that the direct SDK path was used. Failure to download/load the model is reported as a failure; it does not switch engines.

## Data semantics

- Saved sessions and evidence are append-only. Corrections apply to the mutable draft before save.
- Approximate ages remain exact, estimated, ranged, qualitative, or unknown. Numeric installation estimates are derived only when the reported age supports them and are marked `Derived`.
- Confidence is an explainable `confidence-v1` strategy with evidence IDs, not a bare trusted number.
- Duplicate detection creates scored `PossibleDuplicate`, `PossibleCorroboration`, or `PossibleConflict` candidates. Human resolutions are `NotDuplicate`, `SameEquipment`, or `CorroboratingEvidence`; none merges records automatically.
- Customer 360 currently uses `latest-per-signature-v1`; its contributing observation IDs retain the projection-to-evidence trace.
- `observedAt`, optional `lastVerifiedAt`, and elapsed-day values are stored/exposed. Freshness remains `Unknown` because no business thresholds were supplied.

## Current boundaries

- Text evidence is operational. Voice capture/STT and Photo ingestion are typed extension points only.
- No freshness/aging policy is invented; aging dashboard values remain unclassified.
- The deterministic mock recognizes the supplied demonstration grammar, not arbitrary language.
- Natural-language analytics, authentication, multi-user synchronization, automatic entity merging, model packaging, and production installers are outside this vertical slice.
- The QVAC smoke depends on the local machine's network for the first model acquisition and on its QVAC/Vulkan compatibility.

## Documentation

| Document                                           | Covers                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)               | Components, layers, data flow, module responsibilities     |
| [QVAC architecture](docs/QVAC_ARCHITECTURE.md)     | Where QVAC lives, model lifecycle, failure handling        |
| [QVAC compliance](docs/QVAC_COMPLIANCE.md)         | SDK, plugin, model, structured output, network posture     |
| [Data schema](docs/DATA_SCHEMA.md)                 | What an observation is, and how uncertainty is preserved   |
| [Model strategy](docs/MODEL_STRATEGY.md)           | Which model for which capability, and why not a bigger one |
| [Privacy and offline](docs/PRIVACY_OFFLINE.md)     | Threat model, what may touch the network                   |
| [Performance budgets](docs/PERFORMANCE_BUDGETS.md) | What to measure and how                                    |
| [Testing](docs/TESTING.md)                         | Strategy for testing local AI, including extraction cases  |
| [Technical decisions](docs/DECISIONS.md)           | ADR log                                                    |
