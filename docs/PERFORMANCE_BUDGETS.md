# Performance budgets

## Status: no target hardware has been specified

Every numeric target in this document is **TBD**. The deployment hardware for field
colleagues is unknown, so inventing thresholds would turn a guess into a requirement that later
work would be measured against. What is defined here instead is: what to measure, how to
measure it, and the shape of the profiles to fill in once hardware is known.

The one figure that is real is model download size, because it comes from the QVAC registry.

## Metrics to measure

| Metric                              | Unit                   | Why it matters                                              | Target        |
| ----------------------------------- | ---------------------- | ----------------------------------------------------------- | ------------- |
| Model download time, cold           | s                      | First-run experience, and whether provisioning is mandatory | TBD           |
| Model load time                     | ms                     | How long the user waits after asking to initialize          | TBD           |
| First-token latency                 | ms                     | Perceived responsiveness                                    | TBD           |
| Total extraction latency            | ms                     | The number the user actually feels, per capture turn        | TBD           |
| Transcription latency (**PLANNED**) | ms per second of audio | Whether voice capture feels live                            | TBD           |
| Tokens per second                   | tok/s                  | Comparing models and quantizations                          | TBD           |
| Peak RSS during inference           | MB                     | Whether the app survives on a low-end machine               | TBD           |
| Idle RSS, model loaded              | MB                     | Cost of keeping a model resident                            | TBD           |
| Idle RSS, model unloaded            | MB                     | Proves unload actually frees memory                         | TBD           |
| CPU utilisation during inference    | %                      | Thermal and battery behaviour                               | TBD           |
| GPU utilisation during inference    | %                      | Whether Vulkan acceleration is engaged at all               | TBD           |
| Application bundle size             | MB                     | Distribution cost, driven by the QVAC plugin list           | TBD           |
| Model storage on disk               | MB                     | Device provisioning                                         | 365 MiB today |
| Battery drain per capture           | %/hour or mWh          | Whether a full day of visits is feasible                    | TBD           |
| Structured-output success rate      | %                      | Share of extractions passing Zod on the first attempt       | TBD           |
| Extraction accuracy                 | % of corpus cases      | Correctness, not speed. See [TESTING.md](TESTING.md)        | TBD           |

Structured-output success rate deserves emphasis: a fast extraction that fails validation is
worth nothing, and a model swap that improves latency while lowering this number is a
regression.

## Known fixed costs

| Item                         | Value                   | Source                                               |
| ---------------------------- | ----------------------- | ---------------------------------------------------- |
| Default completion model     | 382,156,480 B ≈ 365 MiB | `QWEN3_600M_INST_Q4` registry entry                  |
| Context size                 | 4096 tokens             | set in the QVAC adapter                              |
| Enabled QVAC plugins         | 1 of 12 available       | `qvac.config.json`                                   |
| Whisper tiny, if voice ships | ≈ 42 MiB                | registry, see [MODEL_STRATEGY.md](MODEL_STRATEGY.md) |

The plugin count is the bundle lever. Every plugin added to `qvac.config.json` adds runtime
weight to every build, so plugins are enabled only when a shipped feature uses them.

## Methodology

Follow this exactly, or the numbers are not comparable.

### 1. Record the environment

OS and build, CPU model, physical RAM, GPU and driver version, whether Vulkan 1.4 is available,
Node version, mains or battery power. A measurement without this header is unusable.

### 2. Fix the scenario

Same input text, same model, same quantization, same context size, same config. Write the input
into the report. The demo sentence in the README is a reasonable default; a multi-device Spanish
utterance is a better stress case.

### 3. Separate load from inference

Model load time and inference latency are different budgets with different fixes. Never report
one number that includes both.

### 4. Warm up, then repeat

Discard the first inference. Run at least five more. Report median, min, and max. A single
sample is not a measurement.

### 5. Measure memory at three points

Idle before load, idle after load, peak during inference. The delta between the first and third
is the real cost of the feature; the delta between the first and the post-unload figure proves
the unload works.

### 6. Compare

Against the previous recorded baseline, and against the target in this file. When the target is
TBD, say TBD. Do not invent a threshold in order to declare a pass.

### 7. Record

Add baselines worth keeping to the results section below, with the environment header.

## Profiles to define once hardware is known

Placeholders. Fill these in when the deployment fleet is specified.

### Low-end

The minimum machine the application must still be usable on. Likely integrated graphics, modest
RAM. Determines whether the 0.6B model is the ceiling and whether a model can stay resident.

| Metric                         | Target |
| ------------------------------ | ------ |
| Model load time                | TBD    |
| Total extraction latency       | TBD    |
| Peak RSS                       | TBD    |
| Structured-output success rate | TBD    |

### Recommended

The machine the experience is designed for.

| Metric                         | Target |
| ------------------------------ | ------ |
| Model load time                | TBD    |
| Total extraction latency       | TBD    |
| Peak RSS                       | TBD    |
| Structured-output success rate | TBD    |

### High-end

Where a larger model could be offered as an option. Note that a per-profile model choice means
two extraction behaviours in the field, which has consequences for comparing saved records.
That trade-off is unresolved — **TBD**.

| Metric                                 | Target |
| -------------------------------------- | ------ |
| Total extraction latency               | TBD    |
| Peak RSS                               | TBD    |
| Escalation to a larger model justified | TBD    |

## Useful SDK support

`@qvac/sdk` 0.19.0 exports `getSystemResources()` and `assessModelFit()`, plus a `profiler`.
None are used yet. They are the obvious foundation for a device-capability check that picks a
profile at runtime — **PROPOSED**, not implemented, and not to be built before there are real
targets to check against.

## Recorded results

### 2026-09-10 — fast model comparison, fixed `extraction-corpus-v1`

The same 30 cases, prompt, schema, evaluator, sampling configuration, context size, and production
extraction path were used for all three reports. No result was followed by prompt or inference
optimization. Detailed failures remain in the separate JSON reports:

- `docs/qvac-eval-runs/600m-2026-09-10T12-59-49-257Z.json`
- `docs/qvac-eval-runs/1.7b-2026-09-10T17-14-15-271Z.json`
- `docs/qvac-eval-runs/4b-2026-09-10T17-28-37-527Z.json`

The 4B descriptor was verified against the installed `@qvac/sdk` 0.19.0 export and registry as
`QWEN3_4B_INST_Q4_K_M` (`Qwen3-4B-Q4_K_M.gguf`, 2,497,280,256 bytes, Q4_K_M,
`llamacpp-completion`). The 4B run used the same machine as the earlier runs, but the command
resolved system Node 24.19.0 rather than the vendored Node 24.20.0 recorded for the earlier runs;
this runtime difference is a limitation on the latency comparison. Power state, CPU, RAM, GPU,
driver, and peak worker RSS were not measurable from the sandbox and remain unconfirmed/TBD.

| Metric                     |            0.6B |              1.7B |                  4B |
| -------------------------- | --------------: | ----------------: | ------------------: |
| Field accuracy             | 49.8% (150/301) |   49.1% (140/285) | **63.4% (185/292)** |
| Full-pass cases            |            0/30 |              0/30 |            **3/30** |
| Fabricated                 |              46 |                59 |              **42** |
| Missing                    |              40 |                14 |               **8** |
| Wrong                      |              45 |                33 |              **29** |
| Normalization              |               7 |                10 |               **7** |
| Follow-up                  |          **13** |                29 |                  21 |
| Extraction errors          |               0 |                 0 |                   0 |
| EN field accuracy          | 53.9% (118/219) |   53.8% (114/212) | **62.4% (136/218)** |
| ES field accuracy          |   39.0% (32/82) |     35.6% (26/73) |   **66.2% (49/74)** |
| Adversarial field accuracy |   52.0% (39/75) | **67.6% (50/74)** |       65.3% (49/75) |
| `Uncertain` emitted        |              No |                No |                  No |
| Model load                 |        6,815 ms |         56,157 ms |          162,579 ms |
| Latency p50                |        2,312 ms |      **2,241 ms** |            3,383 ms |
| Latency p95                |        6,249 ms |      **2,819 ms** |            6,744 ms |
| Latency max                |        7,185 ms |      **3,238 ms** |           17,013 ms |

Against 1.7B, 4B improves overall field accuracy by **14.2 percentage points** (rounding the
displayed percentages gives 14.3 points), produces the only three full-pass cases, and reduces
fabricated, missing, wrong, normalization, and follow-up failures. This is a material quality
improvement, especially in Spanish (+30.6 percentage points), although adversarial accuracy falls
2.2 points and `Uncertain` is still never emitted. It does not meet the stated quality bar: 27 of
30 cases still fail and 42 fabricated values remain.

The quality gain carries a large cost versus 1.7B: the registry artifact is 2.36 times larger,
model load is 2.90 times longer, p50 latency is 51% higher, p95 is 139% higher, and max latency is
425% higher. Numeric performance targets are still TBD, so budget status remains **TBD**. Because
the 4B quality improvement over 1.7B is material, the conditional instruction to close model
exploration does not apply; this comparison does not change the production default from 0.6B.

### 2026-09-10 — P4-S4/P4-S5, initial 1.7B attempt (historical; superseded above)

Environment: same machine as the P4-S3 baseline below; Node 24.20.0 via the vendored
`.tools/node-v24.20.0-win-x64`; mains power assumed (not confirmed).

`npm run corpus:eval` was re-run against `QWEN3_600M_INST_Q4` with the runner instrumented for
latency. Result: **0 / 30 cases passed, 49.8% field accuracy (150 / 301 fields)** — different from
the 43.8% P4-S3 baseline below, which is expected run-to-run variance from QVAC's non-deterministic
sampling on the same model, input and prompt (see `docs/TESTING.md`: "A green `npm test` is not
evidence that QVAC works" applies equally to any single non-deterministic run). Full detail in
`docs/qvac-eval-runs/600m-2026-09-10T12-59-49-257Z.json`.

| Metric                           | Value                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model load time                  | 6,815 ms                                                                                                                                                                                                                                                                                                                                                                                                    |
| Per-case latency, p50            | 2,312 ms                                                                                                                                                                                                                                                                                                                                                                                                    |
| Per-case latency, p95            | 6,249 ms                                                                                                                                                                                                                                                                                                                                                                                                    |
| Per-case latency, max            | 7,185 ms                                                                                                                                                                                                                                                                                                                                                                                                    |
| Total evaluation time (30 cases) | 82,449 ms                                                                                                                                                                                                                                                                                                                                                                                                   |
| Model file size                  | 382,156,480 B ≈ 365 MiB                                                                                                                                                                                                                                                                                                                                                                                     |
| Peak RSS during inference        | **Not measured** — `@qvac/sdk` runs inference in a separate IPC-connected worker process (`dist/src/worker/lifecycle.js`), so this script's own process memory does not reflect it. Measuring it reliably needs the SDK's `getSystemResources()`/`profiler` surface, already flagged in this document as proposed but not integrated — not built here per the instruction not to invent memory measurements |

At the time of this initial attempt, the **1.7B (`QWEN3_1_7B_INST_Q4`) comparison was blocked and
not completed.** The model was not yet cached
locally; the registry download stalled at 0 bytes for 15+ minutes with near-zero worker CPU usage,
consistent with the SDK's peer-to-peer registry transport failing to find peers for this blob in
this network environment (detail and options in
[MODEL_STRATEGY.md](MODEL_STRATEGY.md#2026-09-10-escalation-attempt-p4-s4p4-s5--17b-comparison-blocked-on-provisioning)).
No 1.7B numbers existed at that point. This historical blocker was subsequently resolved; the
completed 1.7B and 4B results are in the comparison section above.

### 2026-09-10 — P4-S3 extraction accuracy baseline, `extraction-corpus-v1`

`npm run corpus:eval` against `QWEN3_600M_INST_Q4` (the default completion model), 30 corpus
cases. Full detail, including every failing field per case, is in
`docs/qvac-eval-runs/2026-09-10T06-01-35-961Z.json`.

| Metric                           | Value                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| Cases passed                     | 1 / 30                                                                |
| Field accuracy (overall)         | 43.8% (127 / 290 fields)                                              |
| official-workbook                | 1 / 13 cases, 50.4% field accuracy                                    |
| challenge-brief                  | 0 / 4 cases, 35.2% field accuracy                                     |
| project-authored                 | 0 / 13 cases, 40.5% field accuracy                                    |
| English                          | 1 / 18 cases, 45.9% field accuracy                                    |
| Spanish                          | 0 / 12 cases, 37.1% field accuracy                                    |
| Adversarial (P4-S2, 8 cases)     | 0 / 8 cases, 52.0% field accuracy                                     |
| Fabricated values                | 53                                                                    |
| Missing expected values          | 30                                                                    |
| Wrong values                     | 53                                                                    |
| Normalization failures           | 6                                                                     |
| Follow-up failures               | 19                                                                    |
| Extraction/JSON errors           | 2 of 30 calls ("Unterminated string in JSON", truncated model output) |
| Certainty `Uncertain` ever seen? | **No** — see the `E-11` finding below                                 |

This is the structured-output success rate row above, filled in for the first time: **43.8%
field accuracy**, well short of a usable quality bar. Per `docs/ROADMAP.md`, P4-S3, this is
recorded as a baseline, not fixed here — no prompt, model or quantization change was made to
produce it. See [MODEL_STRATEGY.md](MODEL_STRATEGY.md) for the escalation question this raises.
