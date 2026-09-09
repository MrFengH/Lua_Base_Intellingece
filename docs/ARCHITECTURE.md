# Architecture

## Shape of the vertical slice

The dependency direction is inward: Electron/UI adapters depend on application ports and use cases, which depend on domain concepts. QVAC and SQLite are replaceable infrastructure implementations rather than domain dependencies.

```mermaid
flowchart LR
  subgraph Renderer[React renderer]
    Capture[Conversational capture]
    C360[Customer 360]
    Dash[Dashboard]
  end

  subgraph Electron[Electron boundary]
    Preload[Typed preload API]
    IPC[Validated IPC handlers]
  end

  subgraph Application[Application layer]
    Workflow[CaptureWorkflowService]
    Queries[InstalledBaseQueryService]
    ExtractPort[ObservationExtractionPort]
    RepoPort[Repository ports]
  end

  subgraph Domain[Domain]
    Rules[Normalization and age derivation]
    Confidence[Confidence strategy]
    Duplicate[Duplicate/corroboration scoring]
    Evidence[Observation evidence aggregate]
  end

  subgraph Infrastructure[Infrastructure]
    QVAC[QVAC on-device adapter]
    Mock[Development Mock]
    SQLite[(node:sqlite)]
  end

  Capture --> Preload --> IPC --> Workflow
  C360 --> Preload
  Dash --> Preload
  IPC --> Queries
  Workflow --> ExtractPort
  Workflow --> RepoPort
  Workflow --> Rules
  Workflow --> Confidence
  Workflow --> Duplicate
  Workflow --> Evidence
  ExtractPort -. implemented by .-> QVAC
  ExtractPort -. implemented by .-> Mock
  RepoPort -. implemented by .-> SQLite
  Queries --> RepoPort
```

The renderer has no Node integration and cannot invoke arbitrary Electron channels. `contextIsolation` and the renderer sandbox are enabled; preload exposes a narrow typed API. IPC payloads are parsed with Zod before a use case is called.

## Capture and save flow

```mermaid
sequenceDiagram
  participant U as Field user
  participant UI as React capture
  participant W as Capture workflow
  participant X as QVAC or labelled mock
  participant D as Domain rules
  participant DB as SQLite repository

  U->>UI: Free-text observation
  UI->>W: submit(captureId, text)
  W->>X: extract(text, draft context)
  X-->>W: Zod-validated structured facts
  W->>D: normalize, preserve uncertainty, select follow-up
  D-->>UI: draft + one next question
  U->>UI: answers / corrections / review
  UI->>W: save(captureId)
  W->>D: derive estimates, confidence, duplicate candidates
  W->>DB: save aggregate
  Note over DB: BEGIN IMMEDIATE / COMMIT or ROLLBACK
  DB-->>UI: saved observation + customer ID
```

The conversational state is deliberately ephemeral until save. Once saved, the `ObservationSession`, `EvidenceItem`, and `EquipmentObservation` records are inserted together in one transaction. A failure in any equipment row rolls the complete write back.

## Evidence and projection

An observation describes what one observer reported during one visit, not an unquestionable current truth. Each equipment field carries knowledge state, origin, certainty, and evidence IDs. Raw text is retained as evidence; inference tokens and hidden reasoning are not logged.

The Customer 360 read model is a projection over immutable observations. `latest-per-signature-v1` groups by modality/manufacturer/model signature and selects the latest group while returning contributing observation IDs. This keeps the current UI useful without destroying the audit trail.

Duplicate scoring first requires the same customer and a compatible known modality. Manufacturer, model, and numeric age compatibility adjust a transparent score. Independent observers/visits can classify a candidate as possible corroboration; conflicting facts are surfaced as possible conflict. All outcomes remain review candidates, never automatic merges.

## Local data and migrations

`LocalSqliteDatabase` wraps Node's built-in `node:sqlite`, enables foreign keys and WAL, and owns explicit transactions. Migration `001` creates customers, sessions, evidence, equipment observations, evidence links, duplicate candidates, and seed imports. JSON is used only for bounded typed value objects such as age, confidence, and provenance.

The seed is guarded by `synthetic-development-v1`, so reopening the application or rerunning the seed does not duplicate fixtures.

## Extension seams

- `ObservationExtractionPort`: additional local inference engines can be added without changing capture rules.
- `SpeechToTextPort`: reserved for local voice transcription; the UI currently labels voice as unavailable.
- `EvidenceSource`: already includes Text, Voice, and Photo so later sources can attach to the same immutable session.
- `ConfidenceScoringService`: `confidence-v1` can be replaced/versioned while stored explanations remain interpretable.
- repository/query ports: allow projection or persistence evolution without coupling the domain to SQLite.

No remote sync or delegated inference is implied by these seams.
