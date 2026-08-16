# Model quality and performance

OpenHistory evaluates timeline, fixed-hour, and daily generation independently. The goal is not to make every provider sound identical; it is to preserve factual calibration, useful coverage, valid structure, privacy boundaries, and acceptable latency.

## Required deterministic gate

```bash
npm run test:inference-preservation
```

This builds all six Apple/cloud task requests from a synthetic fixture and verifies:

- input, prompt, schema, and token-limit version manifests;
- exact request hashes;
- instruction character counts;
- a five-percent prompt-size ceiling;
- hour continuity through `lastHour` and day composition through hours plus unrolled sessions.

The gate intentionally does not call a model.

## Live Apple shadow benchmark

```bash
npm run benchmark:apple-model -- "/path/to/private/activity-data" \
  reports/apple-foundation-model-quality-latest.md 40 8 20
```

It does not rewrite the timeline. By default it makes no network requests, even when `.env.local` contains a provider key: source evidence and generated case data remain on the Mac.

Blinded cloud judging is an explicit, separate operation:

```bash
npm run benchmark:apple-model -- "/path/to/private/activity-data" \
  reports/apple-foundation-model-quality-latest.md 40 8 20 --cloud-judge
```

This requires `OPENAI_API_KEY` and sends the selected source-evidence projection, current summary, and Apple candidate to OpenAI. Use it only with informed approval for that dataset. Generated reports contain private titles and evaluator rationales; keep them untracked and commit only manually reviewed aggregate results.

The opt-in readiness thresholds are:

- at least 95% structured generation success;
- at least 95% presentation-contract success;
- Apple wins or ties at least 75% of reviewed cases;
- no recurring evidence-calibration failure;
- no material p95 latency regression relative to the same machine and system-model version.

## Current interpretation

The promoted E8 Apple timeline input beat the earlier Apple path in 17 of 20 validation cases, but lost to the cloud baseline in 18 of 20. Apple inference therefore remains an explicit experimental, on-device privacy option rather than the default quality path.

A post-refactor private shadow run on August 15, 2026 covered 40 history entries, eight hours, and two days. Structured generation succeeded in 50 of 50 cases, with 1,183 ms median and 2,387 ms p95 end-to-end latency on the test Mac. Only 27 of 50 outputs passed the strict title/bullet presentation contract. A separate 20-case blinded review produced two Apple wins and 18 cloud-baseline wins. These aggregate results confirm that execution reliability and latency were preserved while quality remains below the opt-in readiness threshold.

Apple latency comparisons are meaningful only on the same hardware, macOS release, language-model availability state, and approximate thermal conditions. Cloud comparisons must record model identifiers and dates because hosted models may change behind stable names.

## Reporting a regression

Use the model-quality issue template and attach only synthetic or fully sanitized evidence. Include task/provider/version, schema success, latency measurements, expected evidence status, and the smallest reproducible fixture. Never attach raw activity logs or private prompt contents.
