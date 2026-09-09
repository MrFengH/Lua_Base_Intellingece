# Customer Installed Base Intelligence

An offline-first desktop vertical slice for turning field observations into an evidence-backed customer installed-base view. The application captures a visit conversationally, asks one deterministic follow-up at a time, lets the user correct and review the structured result, and saves the observation locally as immutable evidence.

This repository is a prototype, not a production medical or asset-management system. It contains no real patient, hospital, or Philips product data.

## What is implemented

- Conversational text capture with explicit `Unknown` handling and no invented facts.
- Structured review and correction before saving.
- Multiple equipment groups in one visit, including heterogeneous modalities.
- Transactional SQLite persistence of customer, session, evidence, equipment, provenance, confidence, and duplicate candidates.
- Customer 360 projection with supporting evidence and traceable observation IDs.
- Dashboard by modality and country, plus incomplete-observation counts.
- Deterministic, idempotent synthetic seed data.
- A real QVAC on-device inference adapter and a visibly labelled development mock.
- Ports for future Voice/STT and Photo evidence without pretending those sources are implemented.

The workbook and DOCX referenced by the challenge were not present in the supplied repository or attachments. The seed therefore uses fictitious facilities and manufacturers and is explicitly marked synthetic.

## Runtime modes

Development defaults to `Development Mock` so the entire workflow can be exercised without a model download. The UI always shows the exact engine, execution location, model, network requirement, and runtime state; the mock displays a warning and is never presented as QVAC.

QVAC mode uses `@qvac/sdk` directly. It initializes only after the user requests it, loads the configured model into the local llama.cpp completion worker, requests strict JSON-schema output, drains the QVAC event stream, and validates the final JSON again with Zod. There is no cloud provider and no silent fallback to the mock.

The default model is the SDK descriptor `QWEN3_600M_INST_Q4` (`Qwen3-0.6B-Q4_0.gguf`, approximately 382 MB). Its first download needs network access; inference after the model is cached and loaded runs on the device.

## Requirements

- Node.js `>=22.17.0` and npm `>=10.9.0`; this repository has been verified with Node 24.
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

## Demo path

1. Open **Capture** and confirm the inference badge.
2. With the development mock, enter: `I visited Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.`
3. Answer each follow-up. `I don't know` records a declared unknown and the same field is not asked repeatedly.
4. Use the structured cards to correct a field, then choose **Review current information** and **Save observation**.
5. Inspect the append-only evidence and current projection in **Customer 360**.
6. Inspect local aggregate counts in **Dashboard**.

The application database lives in Electron's per-user `userData` directory unless `CIB_DATABASE_PATH` is set. The standalone seed command writes `data/customer-installed-base.sqlite`; this path is ignored by Git.

## Commands

```powershell
npm run typecheck       # strict TypeScript validation
npm run lint            # ESLint
npm test                # domain, application, mock, and persistence tests
npm run build           # typecheck plus Electron/Vite bundles
npm run sqlite:smoke    # real node:sqlite transaction smoke
npm run seed            # idempotent synthetic local seed
npm run qvac:smoke      # real SDK/model/inference/schema smoke; never uses the mock
```

The QVAC smoke must print four lifecycle checks—runtime initialized, model loaded, local inference completed, and structured output validated—plus confirmation that the direct SDK path was used. Failure to download/load the model is reported as a failure; it does not switch engines.

## Data semantics

- Saved sessions and evidence are append-only. Corrections apply to the mutable draft before save.
- Approximate ages remain exact, estimated, ranged, qualitative, or unknown. Numeric installation estimates are derived only when the reported age supports them and are marked `Derived`.
- Confidence is an explainable `confidence-v1` strategy with evidence IDs, not a bare trusted number.
- Duplicate detection creates scored `PossibleDuplicate`, `PossibleCorroboration`, or `PossibleConflict` candidates. It never merges records automatically.
- Customer 360 currently uses `latest-per-signature-v1`; its contributing observation IDs retain the projection-to-evidence trace.
- `observedAt`, optional `lastVerifiedAt`, and elapsed-day values are stored/exposed. Freshness remains `Unknown` because no business thresholds were supplied.

## Current boundaries

- Text evidence is operational. Voice capture/STT and Photo ingestion are typed extension points only.
- No freshness/aging policy is invented; aging dashboard values remain unclassified.
- The deterministic mock recognizes the supplied demonstration grammar, not arbitrary language.
- Natural-language analytics, authentication, multi-user synchronization, automatic entity merging, model packaging, and production installers are outside this vertical slice.
- The QVAC smoke depends on the local machine's network for the first model acquisition and on its QVAC/Vulkan compatibility.

See [Architecture](docs/ARCHITECTURE.md), [technical decisions](docs/DECISIONS.md), and [QVAC compliance](docs/QVAC_COMPLIANCE.md).
