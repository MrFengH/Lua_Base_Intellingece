# Model strategy

Which local models this application needs, and why the smallest one that works is the right
one.

## Selection rule

**Use the smallest local model that meets the stated quality bar.** Model size costs download
time, disk, RAM, latency, battery, and bundle weight on every device in the field. A larger
model is justified only after a smaller one has been measured and shown to fail.

A capability is added when the product needs it, not because the SDK supports it. QVAC 0.19.0
ships plugins for embeddings, RAG, OCR, translation, text-to-speech, diffusion, classification,
and vision. **None of those are enabled**, and none should be until a real requirement exists.

All model constants and sizes below are verified against
`node_modules/@qvac/inference/dist/models/registry/models.js`. Re-verify them there before
relying on a figure, and re-verify after any SDK upgrade.

## Capability 1 — Text extraction (implemented)

Natural-language observation to a validated structured record.

|                    |                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**        | Turn "vi dos resonadores NovaMed..." into schema-conformant equipment groups                                                                              |
| **Model type**     | Instruction-tuned LLM with JSON-schema-constrained generation                                                                                             |
| **QVAC plugin**    | `@qvac/sdk/llamacpp-completion/plugin`                                                                                                                    |
| **Selected model** | `QWEN3_600M_INST_Q4` (`Qwen3-0.6B-Q4_0.gguf`)                                                                                                             |
| **Size**           | 382,156,480 B ≈ 365 MiB                                                                                                                                   |
| **Quantization**   | Q4_0                                                                                                                                                      |
| **Context size**   | 4096, set in the adapter                                                                                                                                  |
| **Languages**      | Spanish and English input required; Qwen3 is multilingual                                                                                                 |
| **Platform**       | Windows desktop via Electron; Vulkan 1.4 driver per QVAC system requirements                                                                              |
| **Quality bar**    | The extraction cases in [TESTING.md](TESTING.md) pass, including grouping by differing age and preserving uncertainty                                     |
| **Expected RAM**   | **TBD** — see [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md)                                                                                            |
| **Fallback**       | None in QVAC mode. Load or inference failure surfaces as an error. `CIB_QVAC_MODEL_PATH` allows a locally provisioned GGUF, which needs no network at all |
| **Lifecycle**      | Explicit initialization, loaded once, reused for every extraction, unloaded on application disposal                                                       |

### Why the 0.6B model

It is the smallest completion model in the registry that the task was built against, and the
task is heavily constrained: output is bounded by a JSON schema, the domain vocabulary is small
(six modalities), and every result is re-validated by Zod. Structural correctness is enforced
outside the model, so model capacity is spent on comprehension, not formatting.

### When to escalate

Escalate to `QWEN3_1_7B_INST_Q4` (1,056,782,912 B ≈ 1008 MiB, about 2.8× the download) **only**
after measuring the 0.6B model against the full extraction corpus and recording which cases it
fails. Record the measurement in PERFORMANCE_BUDGETS.md and the decision in DECISIONS.md.
Symptoms that would justify it: systematic mis-grouping of multi-device utterances, or
collapsing approximate ages into exact ones.

Do not escalate because output "feels" better on one example.

### 2026-09-10 measurement (P4-S3) — quality bar not met, escalation not decided here

`npm run corpus:eval` scored the 0.6B model against `extraction-corpus-v1` (30 cases): **1 of 30
cases passed and 43.8% field accuracy overall**. Full numbers, split by source and language, are
in [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md); every failing field, with its input, expected
and actual value, is in `docs/qvac-eval-runs/2026-09-10T06-01-35-961Z.json`.

**The stated quality bar — the TESTING.md cases pass — is not met.** Two findings from this run,
recorded rather than acted on:

- **`E-11`: certainty was never `Uncertain`.** Across all 30 cases the model never emitted
  `certainty: 'Uncertain'`, even on cases whose input is explicitly hedged ("around eleven years
  old", "maybe eight"). `P3-S1`'s `UNCERTAINTY_LANGUAGE` confidence branch is real and reachable
  from the mock, but this run gives no evidence the real model ever drives it.
- 2 of 30 calls returned truncated, unparseable JSON ("Unterminated string in JSON"), both on
  longer Spanish inputs with several equipment groups — a possible context-size or
  max-output-tokens ceiling, not investigated further here.

**Escalation is not decided by this document.** This measurement is the data the
`qvac-model-selection` skill's escalation gate asks for; whether to escalate to
`QWEN3_1_7B_INST_Q4`, adjust the prompt, or accept the baseline for the demo is a separate
decision for a person, to be recorded in `DECISIONS.md` if taken. No model, quantization or prompt
change was made to produce or in response to this number.

### 2026-09-10 initial escalation attempt — historical blocker, subsequently resolved

`QvacObservationExtractionService` gained an optional `modelDescriptor` config field so a caller
can select `QWEN3_1_7B_INST_Q4` (a real, `@qvac/sdk`-exported registry descriptor, verified against
the installed SDK, `expectedSize: 1,056,782,912`) instead of the default, through the same
`loadModel` "load from descriptor" overload the default already uses. `scripts/qvac-corpus-eval.ts`
exposes this as `CIB_QVAC_CORPUS_MODEL=1.7b`. No new runtime, prompt, or contract was introduced;
inference still goes through `@qvac/sdk` exclusively.

**This initial comparison run did not complete.** `CIB_QVAC_CORPUS_MODEL=1.7b npm run corpus:eval`
triggered the registry download (the model was not yet cached locally), and that download stalled:
`~/.qvac/models/f7cce66406dee646_Qwen3-1.7B-Q4_0.gguf` sat at 0 bytes for 15+ minutes with the QVAC
worker processes at near-zero CPU (0.05–0.85s of CPU time total), unlike the earlier successful
0.6B download. `QWEN3_1_7B_INST_Q4`'s `src` resolves through the SDK's Hyperdrive/Corestore-based
peer-to-peer registry transport (`~/.qvac/registry-corestore/`); the stall is consistent with that
P2P transport failing to find peers for this blob in the current network environment, not with a
code defect — the 0.6B model, fetched over the same registry mechanism on a different occasion,
downloaded to its full 382,156,480 bytes without issue. The stalled processes were terminated
rather than left running indefinitely.

**No 1.7B measurement existed from this attempt.** This is retained as historical provenance for
the acquisition failure. It was later resolved, as recorded in the fast-comparison section below;
the options considered at the time were:

1. Retry `CIB_QVAC_CORPUS_MODEL=1.7b npm run corpus:eval` on a machine/network without the
   restriction that appears to be blocking the P2P registry transport.
2. Obtain the `Qwen3-1.7B-Q4_0.gguf` file through another channel and point
   `CIB_QVAC_MODEL_PATH` (which the runner already honors and takes priority over
   `CIB_QVAC_CORPUS_MODEL`) at the local file.
3. Accept the measured 0.6B baseline for the demo given the timeline, and revisit escalation later.

### 2026-09-10 fast comparison resolved — 4B materially improves quality, no production switch

The previously blocked 1.7B acquisition later completed, and one additional model was evaluated:
the installed SDK 0.19.0 export `QWEN3_4B_INST_Q4_K_M`. Its registry descriptor names
`Qwen3-4B-Q4_K_M.gguf`, Q4_K_M, 2,497,280,256 bytes, and the existing
`llamacpp-completion` engine. No other model was tried.

| Candidate              | Corpus field accuracy | Full-pass |   Registry size | Peak RAM | Language result    |   Latency p50 / p95 / max |
| ---------------------- | --------------------: | --------: | --------------: | -------- | ------------------ | ------------------------: |
| `QWEN3_600M_INST_Q4`   |                 49.8% |      0/30 |   382,156,480 B | TBD      | EN 53.9%; ES 39.0% |  2,312 / 6,249 / 7,185 ms |
| `QWEN3_1_7B_INST_Q4`   |                 49.1% |      0/30 | 1,056,782,912 B | TBD      | EN 53.8%; ES 35.6% |  2,241 / 2,819 / 3,238 ms |
| `QWEN3_4B_INST_Q4_K_M` |             **63.4%** |  **3/30** | 2,497,280,256 B | TBD      | EN 62.4%; ES 66.2% | 3,383 / 6,744 / 17,013 ms |

The acceptance criterion remains the documented extraction cases passing while uncertainty and
unknowns are preserved. None of the candidates meets it. The 4B result is nevertheless materially
better than 1.7B (+14.2 percentage points overall and three full-pass cases), so the conditional
instruction to close exploration does not apply. This comparison alone does **not** justify a
production switch: the 4B model still fails 27/30 cases, fabricates 42 values, never emits
`Uncertain`, and has materially higher load and latency costs. The production default therefore
remains `QWEN3_600M_INST_Q4`; fallback and lifecycle are unchanged. Full metrics and per-case
failures are recorded in [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md) and the three separate
JSON reports under `docs/qvac-eval-runs/`.

### 2026-09-10 — `QWEN3_4B_INST_Q4_K_M` approved for the demo; production default unchanged

A later corpus run, `docs/qvac-eval-runs/4b-2026-09-10T18-16-39-837Z.json`, scored
`QWEN3_4B_INST_Q4_K_M` again on the same `extraction-corpus-v1` and measured **82.6% overall field
accuracy (238/288 fields), 7/30 full-pass cases, EN 84.7% (182/215), ES 76.7% (56/73), adversarial
82.4% (61/74), and 11 fabricated values** — materially higher than both the 63.4% recorded for this
model in the comparison above and the 43.8–49.8% recorded for `QWEN3_600M_INST_Q4` across its own
runs. A human reviewed this result and approved `QWEN3_4B_INST_Q4_K_M` as the recommended,
documented model configuration for the upcoming demo.

**This is a demo-configuration decision, not a change to the production default.** The global
default read when `CIB_QVAC_MODEL` is unset — used by `npm run dev`, `npm test`, and
`npm run corpus:eval`'s own default — remains `QWEN3_600M_INST_Q4`, unchanged. `CIB_QVAC_MODEL=4b`
opts a run into the demo model explicitly; `CIB_QVAC_MODEL=600m` selects the documented fast
fallback the same way. See decision 18 in [DECISIONS.md](DECISIONS.md) and the
[README](../README.md#selecting-the-demo-model) for the mechanism. `QWEN3_4B_INST_Q4_K_M` still
does not meet the stated quality bar — 23 of 30 cases fail and `Uncertain` is still never emitted —
so this remains an approved demo configuration, not a claim that escalation is complete or that the
quality bar in [TESTING.md](TESTING.md) is met. No prompt, schema, or model-tuning change was made
to produce this number or in response to it.

## Capability 2 — Speech to text (implemented, push-to-talk)

Voice is the natural capture mode for someone walking a hospital corridor. `SpeechToTextPort`
(`src/application/ports/platform.ts`) now has a real adapter, `QvacSpeechToTextService`
(`src/infrastructure/qvac/qvac-speech-to-text.ts`), plus a `DevelopmentMockSpeechToTextService`
mirroring the extraction capability's mock/production split. `EvidenceSource` already included
`Voice`; this capability only produces a transcript for the _existing_ text input — it does not
change what gets saved or how (see "What this does not change" below).

|                    |                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**        | Audio to text, placed into the existing text input for the observer to review/edit — never auto-submitted, and feeding the same extraction pipeline unchanged                                                   |
| **Model type**     | Whisper-family ASR                                                                                                                                                                                              |
| **QVAC plugin**    | `@qvac/sdk/whispercpp-transcription/plugin`, enabled in `qvac.config.json`                                                                                                                                      |
| **SDK command**    | `transcribe({ modelId, audioChunk, prompt?, metadata? })`, verified in `node_modules/@qvac/inference/dist/api/transcribe.d.ts`                                                                                  |
| **Selected model** | `WHISPER_TINY_Q8_0` (`ggml-tiny-q8_0.bin`) — see "Why `WHISPER_TINY_Q8_0`" below                                                                                                                                |
| **Size**           | 43,537,433 B ≈ 42 MiB                                                                                                                                                                                           |
| **Languages**      | `language: 'auto'`, `translate: false` — auto-detects between the observer's two working languages (Spanish, English) and never translates, so the transcript stays in the words actually spoken                |
| **Fallback**       | Text capture, which already works and stays the primary path; a transcription failure surfaces an error and leaves the text input exactly as it was                                                             |
| **Lifecycle**      | Loaded lazily on the first `transcribe()` call in a session (no separate "initialize voice" action — push-to-talk is one user action, not two), unloaded on application disposal alongside the completion model |

### Why `WHISPER_TINY_Q8_0`

The smallest **multilingual** candidate in the table below. `WHISPER_SPANISH_TINY_Q8_0` was not
selected: this product's own positioning is bilingual capture ("Spanish and English input
required" — see Capability 1 above), and a Spanish-only model would silently fail or mistranscribe
an English observation. Multilingual auto-detection is the smaller compromise.

| Constant                    | Artifact                      | Size                    | Notes                                          |
| --------------------------- | ----------------------------- | ----------------------- | ---------------------------------------------- |
| `WHISPER_SPANISH_TINY_Q8_0` | `es-tiny-ggml-model-q8_0.bin` | 43,537,433 B ≈ 42 MiB   | Spanish-only; not selected (bilingual product) |
| **`WHISPER_TINY_Q8_0`**     | `ggml-tiny-q8_0.bin`          | 43,537,433 B ≈ 42 MiB   | **Selected** — multilingual tiny               |
| `WHISPER_BASE_Q8_0`         | `ggml-base-q8_0.bin`          | 81,768,585 B ≈ 78 MiB   | Escalation candidate, not measured             |
| `WHISPER_SMALL_Q8_0`        | small q8_0                    | 264,464,607 B ≈ 252 MiB | Only with measured evidence                    |

Both `WHISPER_TINY_Q8_0` and `WHISPER_SPANISH_TINY_Q8_0` are ≈42 MiB, a rounding error next to the
365 MiB completion model — the size difference did not drive this choice; multilingual coverage
did.

### What this does not change

- The extraction model, prompt, and schema (Capability 1) are untouched — a transcript is just
  text, indistinguishable to the extraction pipeline from anything typed.
- Nothing is auto-submitted. The transcript lands in the same `<textarea>` the observer already
  reviews and edits before pressing Send.
- No raw audio is persisted. `src/main/voice-transcription.ts` writes the recorded bytes to a
  single-use OS temp directory only for the duration of the `transcribe()` call and always removes
  it afterward, success or failure. `docs/PRIVACY_OFFLINE.md`'s "Audio artifacts" row stays
  **PLANNED** (not implemented) because of this — there is no `local_artifact_uri` to persist yet.

### Open questions — **TBD**, not resolved by this implementation

- **RAM with two models resident.** `docs/QVAC_ARCHITECTURE.md`'s "one model at a time... a second
  resident model needs a measured RAM figure" is not satisfied here: if voice is used in a session
  where the completion model is already loaded, both are resident until disposal. Lazy-load and
  eventual disposal bound this, but no measurement exists. Do not add a second always-resident
  model without measuring this first.
- **Quality bar.** No word-error-rate measurement exists against hospital vocabulary
  (manufacturer names, modality words), and none is claimed. `npm run qvac:voice-smoke` (see
  README) proves the pipeline runs end to end on real hardware; it does not prove transcription
  accuracy. Build a small held-out audio set before making any WER claim.
- **Disk footprint.** ~42 MiB for the model artifact, cached the same way as the completion model
  (see "Model lifecycle policy" below); temp WAV files are transient (typically well under 1 MiB
  for a short dictated observation) and deleted immediately after each transcription.

## Capabilities deliberately not adopted

Each is available in QVAC and each is currently a **no**. Recorded so the question is not
reopened without new information.

| Capability                       | Plugin               | Why not now                                                                                                                                       | What would change it                                                     |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Embeddings                       | `llamacpp-embedding` | Deduplication is currently deterministic and explainable. Embedding similarity would make it a black box and would still need a human review step | Deterministic matching demonstrably failing on real reviewed data        |
| RAG                              | uses embeddings      | There is no corpus to retrieve from. The whole database is small and structured, and SQL answers the questions                                    | A large unstructured document corpus, for example service manuals        |
| OCR                              | `ggml-ocr`           | `Photo` evidence is typed but not implemented. Reading a device label is plausible but nothing captures photos yet                                | Photo capture shipping, plus a defined use such as reading serial plates |
| Multimodal vision                | vision models        | Same as OCR, and far heavier                                                                                                                      | A demonstrated need OCR cannot meet                                      |
| Translation                      | `nmtcpp-translation` | The extraction model is multilingual. Translating before extraction adds a step and loses the speaker's exact words, which the schema requires    | Languages the completion model handles poorly                            |
| Text to speech                   | `tts-ggml`           | Nothing in the workflow reads text aloud                                                                                                          | An accessibility or hands-free requirement                               |
| Diffusion, audio generation, VLA | various              | No conceivable use here                                                                                                                           | —                                                                        |

Adding any plugin to `qvac.config.json` adds runtime weight to every build. The plugin list is
the bundle budget in [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md).

## Model lifecycle policy

- **Acquisition.** Registry download on first initialization, or a pre-provisioned local file
  via `CIB_QVAC_MODEL_PATH`. Field deployment should prefer provisioning; follow the
  [README provisioning procedure](../README.md#provisioning-the-model-on-another-machine). See
  [PRIVACY_OFFLINE.md](PRIVACY_OFFLINE.md) for the offline posture and its validation status.
- **Load.** Explicit, user-initiated, with visible progress.
- **Reuse.** One load per session. Loading per request is a defect.
- **Residency.** One model at a time today. Two resident models need a measured peak RAM figure
  before being allowed.
- **Unload.** On disposal, wired to the application quit path.
- **Versioning.** The model name and the schema version are both stored context for any saved
  observation, so a future change in extraction behaviour is traceable.

## Before changing any of this

Use the `qvac-model-selection` skill. It requires a stated quality bar, candidates from the
real registry, and measurements before an escalation.
