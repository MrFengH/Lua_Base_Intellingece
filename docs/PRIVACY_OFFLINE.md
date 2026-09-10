# Privacy and offline behaviour

## Why this document exists

Field colleagues record what they saw inside hospitals and clinics. That content can name a
facility, describe its equipment, and identify who reported it. It may be recorded where
connectivity is poor or absent. The architecture is local-first and privacy-first because both
constraints are real, not aspirational.

## The rule

**Capture and extraction must work in airplane mode once the required model is on the device.**

Everything below either supports that rule or explains the one narrow exception to it.

## Two kinds of traffic, never confused

### INFERENCE TRAFFIC — must be zero

No observation content ever crosses the network. There is no cloud model, no inference API, no
remote prompt, no remote validation.

Verifiable properties today:

- The only AI dependency is `@qvac/sdk`, running local llama.cpp and whisper.cpp workers.
- `@qvac/sdk` is imported only under `src/infrastructure/qvac/`: `qvac-observation-extraction.ts`
  (text) and `qvac-speech-to-text.ts` (voice). No other file in `src/` imports it.
- No HTTP client or `fetch` call exists anywhere in `src/`.
- The production renderer CSP permits only `connect-src 'self'`; it carries no development
  WebSocket or external network endpoint. Development alone permits `ws://localhost:*` for the
  Vite development socket.
- The renderer references no remote font, CDN, or external URL.
- `qvac.config.json` configures no remote inference endpoint, because 0.19.0 has none.

### OPTIONAL SYNC AND MODEL DOWNLOAD TRAFFIC — narrow and explicit

Only one kind of network operation exists: on first initialization of a given model, the QVAC
model registry may download that model's artifact to its local cache. There are now two models
that can each independently trigger this, once each, the first time they are used.

| Property               | Value                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| What is sent           | A model request. **No observation data, ever, for either model.**                                                |
| When                   | First initialization of a given model only, when it is not already cached                                        |
| Required for inference | No. Once cached, inference is fully local                                                                        |
| How to avoid entirely  | Set `CIB_QVAC_MODEL_PATH` (text) or `CIB_QVAC_VOICE_MODEL_PATH` (voice) to a locally provisioned file            |
| Size                   | ≈365 MiB (default text model) + ≈42 MiB (`WHISPER_TINY_Q8_0`, voice). See [MODEL_STRATEGY.md](MODEL_STRATEGY.md) |

For a genuinely disconnected deployment, provision the model file out of band and set
`CIB_QVAC_MODEL_PATH`. That path performs no network access at all.

**Sync is not implemented.** There is no server, no account, no upload. If synchronisation is
ever added it is a separate, opt-in, clearly labelled feature, and it must never be on the
critical path — see the sync section below.

## Data that must never leave the device

| Data                              | Where it lives                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw observation text              | `evidence_items.raw_text`, local SQLite                                                                                                                                                                                                                                                                      |
| Voice transcripts                 | Not a distinct category: a transcript is placed into the ordinary text input for review and, once sent, is stored exactly like `Raw observation text` above — no `Voice`-tagged evidence table exists                                                                                                        |
| Audio artifacts                   | **Deliberately never persisted.** Recorded audio is written to a single-use OS temp file only for the duration of one `transcribe()` call and is always deleted immediately after, success or failure (`src/main/voice-transcription.ts`). There is no `local_artifact_uri` and no setting that changes this |
| Photos (**PLANNED**)              | same                                                                                                                                                                                                                                                                                                         |
| Facility names, cities, countries | `customers`, `observation_sessions`                                                                                                                                                                                                                                                                          |
| Reporter identity                 | `observation_sessions.observer_id`, `observer_display_name`                                                                                                                                                                                                                                                  |
| Prompts sent to the model         | constructed in memory, never persisted or logged                                                                                                                                                                                                                                                             |
| Generated tokens                  | drained and discarded; only the validated final JSON is kept                                                                                                                                                                                                                                                 |

## Local storage

- SQLite via Node's built-in `node:sqlite`, WAL mode, foreign keys on.
- Default location is Electron's per-user `userData` directory. `CIB_DATABASE_PATH` overrides
  it. The seed script writes `data/customer-installed-base.sqlite`, which is gitignored.
- **Not encrypted at rest — PLANNED.** The prototype relies on operating-system user account
  isolation and full-disk encryption. Database encryption is a real gap for a production
  deployment and is recorded as an open decision in [DECISIONS.md](DECISIONS.md).
- Saved observations are append-only. There is no bulk delete or export path today.

## Logging

- `qvac.config.json` sets `loggerLevel: "warn"` and `loggerConsoleOutput: false`.
- The QVAC adapter deliberately does not log `contentDelta` events. The code says so at the
  drain loop, because that is the one place where a well-meaning debug line would write
  hospital observation content to a log.
- **Rule:** never log raw observation text, transcripts, prompts, generated tokens, facility
  names, or reporter identity. Log state transitions and error classes instead.
- Electron and Node may write crash information to the OS. That is outside application control
  and is called out here so it is not mistaken for a guarantee.

## Analytics, telemetry, crash reporting

**None. All three are prohibited.**

No analytics SDK, no telemetry endpoint, no crash reporter, no remote feature flags, no remote
configuration. Adding any of them requires an explicit product decision recorded in
DECISIONS.md, and even then must exclude observation content entirely.

## Behaviour with no network

| Operation                                       | Works offline                       |
| ----------------------------------------------- | ----------------------------------- |
| Application launch                              | yes                                 |
| Database read and write                         | yes                                 |
| Text capture                                    | yes                                 |
| Extraction, model already local                 | yes                                 |
| Voice dictation, model already local            | yes                                 |
| Follow-up questions, corrections, review, save  | yes, all deterministic domain logic |
| Customer 360 and Dashboard                      | yes                                 |
| Seed                                            | yes                                 |
| `npm test`                                      | yes                                 |
| `npm run qvac:smoke`, model already local       | yes                                 |
| `npm run qvac:voice-smoke`, model already local | yes                                 |
| First download of either model                  | **no**, this is the one exception   |

There is no degraded mode and no silent fallback. If QVAC cannot start or the model cannot
load, the user sees an error with the real state. The engine badge always names the engine that
actually ran.

## Electron hardening

Verified in `src/main/index.ts`:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `setWindowOpenHandler` denies all new windows
- The preload exposes a narrow typed API over named IPC channels only
- Every IPC payload is parsed with Zod before a use case runs

The renderer cannot reach the filesystem, the SDK, or arbitrary channels.

## Future synchronisation — PROPOSED, not implemented

If consolidating observations across colleagues is ever required, these constraints apply:

1. Opt-in per user, never a default.
2. Local capture and extraction must keep working with sync unavailable. Sync is never on the
   critical path.
3. What is synchronised must be enumerable and reviewable before it is sent.
4. Transport encrypted; at-rest encryption on the receiving side decided before any code.
5. Raw audio and photos are the highest-risk payloads and should be the last thing considered,
   if ever.
6. Recorded in DECISIONS.md before implementation, not after.

## Threat model, briefly

| Threat                                                 | Mitigation today                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Observation content reaching a third-party AI provider | No cloud provider exists in the dependency graph. Only one file imports the SDK                   |
| Content leaking through logs                           | Console output disabled, token logging deliberately omitted, rule documented                      |
| Content leaking through analytics                      | No analytics dependency exists                                                                    |
| Renderer compromise reaching the filesystem            | Context isolation, sandbox, no node integration, validated IPC                                    |
| Device theft                                           | **Gap.** Relies on OS account and disk encryption. See the storage section                        |
| Malicious dependency exfiltrating data                 | **Partial.** Dependency count is small and reviewed. No lockfile audit gate exists — **PROPOSED** |
| Model download revealing that the app is in use        | Accepted, and avoidable with `CIB_QVAC_MODEL_PATH`                                                |

## How to verify

Use the `offline-validation` skill. It has the static scan commands, the airplane-mode
procedure, and the pass criteria.

The pre-demo human checklist — physical network disconnection, full capture-to-save flow, Customer
360 and Dashboard checks — lives in
[docs/DEMO.md](DEMO.md#checklist-de-validación-offline--validación-humana-requerida) and is marked
**HUMAN VALIDATION REQUIRED** until a person has executed and checked it off. No agent session has
performed a physical airplane-mode run.
