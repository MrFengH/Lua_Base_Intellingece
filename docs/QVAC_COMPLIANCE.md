# QVAC compliance

## Integration inventory

| Requirement              | Implementation                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK                      | `@qvac/sdk` 0.19.0, imported directly only under `src/infrastructure/qvac/`: `qvac-observation-extraction.ts` (text) and `qvac-speech-to-text.ts` (voice)                                                                                        |
| Runtime modules          | `@qvac/sdk/llamacpp-completion/plugin` (text) and `@qvac/sdk/whispercpp-transcription/plugin` (voice), both enabled in `qvac.config.json`                                                                                                        |
| Execution location       | On-device in the QVAC llama.cpp completion worker (text) and whisper.cpp transcription worker (voice)                                                                                                                                            |
| Default text model       | SDK descriptor `QWEN3_600M_INST_Q4` / `Qwen3-0.6B-Q4_0.gguf`                                                                                                                                                                                     |
| Default voice model      | SDK descriptor `WHISPER_TINY_Q8_0` / `ggml-tiny-q8_0.bin`                                                                                                                                                                                        |
| Alternate model          | Local file supplied through `CIB_QVAC_MODEL_PATH` (text) or `CIB_QVAC_VOICE_MODEL_PATH` (voice)                                                                                                                                                  |
| Structured output        | Text: QVAC `responseFormat: json_schema`, generated from Zod 4 with `z.toJSONSchema`, followed by local Zod validation. Voice: plain transcript text placed into the existing text input for human review — no structured-output claim for voice |
| Network during inference | None required after each model is present and loaded                                                                                                                                                                                             |
| Initial network use      | The SDK registry may download either model to its local cache on that model's first initialization                                                                                                                                               |
| Cloud AI                 | None configured or called                                                                                                                                                                                                                        |
| Fallback                 | None in QVAC mode; initialization/inference errors are surfaced for both capabilities                                                                                                                                                            |

## Observable lifecycle

Model initialization is explicit. The renderer displays:

- engine (`QVAC` or `Development Mock`);
- execution (`On-device` or deterministic local rules);
- selected model;
- whether inference needs network access;
- model-not-loaded, downloading, loading, ready, processing, or error state;
- download/load detail and progress when QVAC supplies it.

The real text adapter performs this sequence:

1. `heartbeat()` verifies and starts the local QVAC runtime.
2. `loadModel(...)` loads a local model path or the official default descriptor.
3. `getLoadedModelInfo(...)` verifies that the completion handler exists.
4. `completion(...)` runs with the observation system/user messages and a strict JSON schema.
5. `run.events` is drained; raw generated tokens are not logged.
6. `run.final.contentText` is parsed and validated by `ObservationExtractionSchema`.
7. `unloadModel(...)` releases the model during disposal.

The real voice adapter (`QvacSpeechToTextService`) performs the equivalent sequence, lazily on
first use rather than on an explicit user action:

1. `heartbeat()` verifies and starts the local QVAC runtime (idempotent alongside the text
   adapter's own call — see docs/QVAC_ARCHITECTURE.md's "Recommendation, not yet implemented").
2. `loadModel(...)` loads a local voice model path or `WHISPER_TINY_Q8_0`, with
   `language: 'auto'` and `translate: false`.
3. `getLoadedModelInfo(...)` verifies that a transcription handler exists.
4. `transcribe({ modelId, audioChunk })` runs against a local WAV file path — never a raw
   in-memory buffer sent anywhere else, and never streamed off-device.
5. The returned text is trimmed and handed back; nothing is drained/logged beyond the adapter's
   own state-transition messages (never the transcript itself).
6. `unloadModel(...)` releases the model during application disposal.

Recorded audio itself never reaches this adapter as a persisted artifact: `src/main/voice-transcription.ts` writes it to a single-use OS temp file for the duration of step 4 only and
deletes it in a `finally` block regardless of outcome.

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

For voice, `npm run qvac:voice-smoke` runs the equivalent proof against the real whisper adapter:
model load, a transcription call against a synthesized (non-speech) WAV file, and unload. It
proves the pipeline runs on this machine; it does not measure transcription accuracy — see
docs/MODEL_STRATEGY.md's Capability 2 "Open questions" for why that is a separate, not-yet-built
exercise. For a managed local voice model:

```powershell
$env:CIB_QVAC_VOICE_MODEL_PATH = 'C:\models\ggml-tiny-q8_0.bin'
npm run qvac:voice-smoke
```

The standard unit/integration suite intentionally uses the development mock or test doubles so it is deterministic. A green `npm test` is not represented as proof that either QVAC model loaded; the two smoke commands above are the separate proof path, and neither runs as part of `npm test`.

## Privacy boundary

Observation text crosses the renderer/main boundary only through explicit IPC and is sent to the selected local extraction adapter. Recorded voice audio crosses that same boundary as a byte buffer, is written to a local temp file only for the duration of one transcription call, and is deleted immediately afterward — it is never sent anywhere else and never persisted. QVAC mode has no cloud completion or transcription endpoint. SQLite data stays on the local device. The application does not include telemetry, analytics, remote sync, or external URL navigation.

The default model registry download is transport for acquiring a model artifact, not remote inference. Users who require a fully disconnected setup can provision a model file out of band and select it with `CIB_QVAC_MODEL_PATH` (text) or `CIB_QVAC_VOICE_MODEL_PATH` (voice) before initialization.

## Version-specific limitation

This implementation does not claim peer-to-peer inference delegation. The [QVAC SDK 0.19 release](https://github.com/tetherto/qvac/releases/tag/sdk-v0.19.0) removed inference delegation/provider mode. Both the extraction port and the speech-to-text port remain implementation-neutral for future supported local or distributed strategies, but their current QVAC implementations are strictly on-device.

References: [QVAC JavaScript/TypeScript SDK](https://docs.qvac.tether.io/js-ts-sdk/), [Electron tutorial](https://docs.qvac.tether.io/tutorials/electron/), and [system requirements](https://docs.qvac.tether.io/system-requirements/).
