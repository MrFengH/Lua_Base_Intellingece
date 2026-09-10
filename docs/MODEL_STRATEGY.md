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

## Capability 2 — Speech to text (PLANNED, not implemented)

Voice is the natural capture mode for someone walking a hospital corridor. `SpeechToTextPort`
exists as a stub in `src/application/ports/platform.ts` and `EvidenceSource` already includes
`Voice`, but no adapter exists.

|                 |                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Audio to text, which then feeds the existing extraction pipeline unchanged                                                                |
| **Model type**  | Whisper-family ASR                                                                                                                        |
| **QVAC plugin** | `@qvac/sdk/whispercpp-transcription/plugin` — **not yet enabled**                                                                         |
| **SDK command** | `transcribe({ modelId, audioChunk, prompt?, metadata? })`, verified in `node_modules/@qvac/inference/dist/api/transcribe.d.ts`            |
| **Languages**   | Spanish first; English second                                                                                                             |
| **Fallback**    | Text capture, which already works and stays the primary path                                                                              |
| **Lifecycle**   | Load on entering voice capture, unload on leaving it. Must not stay resident alongside the completion model without a measured RAM figure |

### Candidate models, smallest first

| Constant                    | Artifact                      | Size                    | Notes                                |
| --------------------------- | ----------------------------- | ----------------------- | ------------------------------------ |
| `WHISPER_SPANISH_TINY_Q8_0` | `es-tiny-ggml-model-q8_0.bin` | 43,537,433 B ≈ 42 MiB   | Spanish-specialised tiny; start here |
| `WHISPER_TINY_Q8_0`         | `tiny_acft_q8_0.bin`          | 43,537,450 B ≈ 42 MiB   | Multilingual tiny                    |
| `WHISPER_BASE_Q8_0`         | `ggml-base-q8_0.bin`          | 81,768,585 B ≈ 78 MiB   | Next step up                         |
| `WHISPER_SMALL_Q8_0`        | small q8_0                    | 264,464,607 B ≈ 252 MiB | Only with measured evidence          |

**Recommended starting point:** `WHISPER_SPANISH_TINY_Q8_0` if the deployment is
Spanish-first, otherwise `WHISPER_TINY_Q8_0`. Both are under 45 MiB, which is a rounding error
next to the 365 MiB completion model.

Open question — **TBD**: whether one multilingual model or a per-language model is right. That
depends on whether field colleagues switch languages mid-sentence, which nobody has confirmed.

**Quality bar to define before implementing — TBD.** Word error rate on hospital vocabulary
(manufacturer names, modality words) matters far more than general WER, because the extraction
step downstream can recover from ordinary transcription noise but not from "NovaMed" becoming
"seamless". Build a small held-out audio set before choosing.

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
