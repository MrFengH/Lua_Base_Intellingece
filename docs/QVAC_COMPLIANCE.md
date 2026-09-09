# QVAC compliance

## Integration inventory

| Requirement              | Implementation                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| SDK                      | `@qvac/sdk` 0.19.0, imported directly by `src/infrastructure/qvac/qvac-observation-extraction.ts`                |
| Runtime module           | `@qvac/sdk/llamacpp-completion/plugin`, enabled in `qvac.config.json`                                            |
| Execution location       | On-device in the QVAC llama.cpp completion worker                                                                |
| Default model            | SDK descriptor `QWEN3_600M_INST_Q4` / `Qwen3-0.6B-Q4_0.gguf`                                                     |
| Alternate model          | Local GGUF supplied through `CIB_QVAC_MODEL_PATH`                                                                |
| Structured output        | QVAC `responseFormat: json_schema`, generated from Zod 4 with `z.toJSONSchema`, followed by local Zod validation |
| Network during inference | None required after the model is present and loaded                                                              |
| Initial network use      | The SDK registry may download the default model to its local cache on first initialization                       |
| Cloud AI                 | None configured or called                                                                                        |
| Fallback                 | None in QVAC mode; initialization/inference errors are surfaced                                                  |

## Observable lifecycle

Model initialization is explicit. The renderer displays:

- engine (`QVAC` or `Development Mock`);
- execution (`On-device` or deterministic local rules);
- selected model;
- whether inference needs network access;
- model-not-loaded, downloading, loading, ready, processing, or error state;
- download/load detail and progress when QVAC supplies it.

The real adapter performs this sequence:

1. `heartbeat()` verifies and starts the local QVAC runtime.
2. `loadModel(...)` loads a local model path or the official default descriptor.
3. `getLoadedModelInfo(...)` verifies that the completion handler exists.
4. `completion(...)` runs with the observation system/user messages and a strict JSON schema.
5. `run.events` is drained; raw generated tokens are not logged.
6. `run.final.contentText` is parsed and validated by `ObservationExtractionSchema`.
7. `unloadModel(...)` releases the model during disposal.

## Verification

Run:

```powershell
npm run qvac:smoke
```

This script imports the production QVAC adapter—not the mock—and fails unless it observes:

- QVAC runtime initialization;
- model load;
- a local completion;
- valid structured output containing at least two equipment groups.

For a managed local model:

```powershell
$env:CIB_QVAC_MODEL_PATH = 'C:\models\model.gguf'
npm run qvac:smoke
```

The standard unit/integration suite intentionally uses the development mock or test doubles so it is deterministic. A green `npm test` is not represented as proof that the QVAC model loaded; the smoke command is the separate proof path.

## Privacy boundary

Observation text crosses the renderer/main boundary only through explicit IPC and is sent to the selected local extraction adapter. QVAC mode has no cloud completion endpoint. SQLite data stays on the local device. The application does not include telemetry, analytics, remote sync, or external URL navigation.

The default model registry download is transport for acquiring a model artifact, not remote inference. Users who require a fully disconnected setup can provision a GGUF file and select it with `CIB_QVAC_MODEL_PATH` before initialization.

## Version-specific limitation

This implementation does not claim peer-to-peer inference delegation. The [QVAC SDK 0.19 release](https://github.com/tetherto/qvac/releases/tag/sdk-v0.19.0) removed inference delegation/provider mode. The extraction port remains implementation-neutral for future supported local or distributed strategies, but its current QVAC implementation is strictly on-device.

References: [QVAC JavaScript/TypeScript SDK](https://docs.qvac.tether.io/js-ts-sdk/), [Electron tutorial](https://docs.qvac.tether.io/tutorials/electron/), and [system requirements](https://docs.qvac.tether.io/system-requirements/).
