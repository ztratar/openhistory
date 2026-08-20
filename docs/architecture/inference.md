# Inference architecture

OpenHistory treats model behavior as a versioned product surface. Provider code may change internally only while the deterministic evidence, instructions, schema, limits, normalization, and persistence contracts remain covered by tests.

## Generation pipeline

```text
raw local events
  -> deterministic episode segmentation
  -> evidence shaping and status calibration
  -> versioned timeline/hour/day task
  -> explicit user-selected provider
  -> provider-specific structured generation
  -> normalization and Zod validation
  -> provenance-backed local persistence
```

`src/main/openai-service.ts` is the compatibility facade used by coordinators and existing integrations. Implementation lives under `src/main/inference/`:

- `tasks.ts` versions input, prompt, schema, and token-limit profiles;
- `prompts.ts` owns the untrusted-evidence and evidence-status instructions;
- `input/` contains deterministic history and rollup projections;
- `providers/` owns one adapter per model API;
- `service.ts` binds tasks to providers and constructs persisted records.

OpenAI has two explicit credential paths. API-key mode uses the Responses API adapter. ChatGPT mode uses `@openai/codex-sdk` for the same structured task requests and a narrow app-server client for managed account login, logout, and account state. Both Codex processes share `<activity-data>/codex` as an isolated `CODEX_HOME`; they do not read or replace the user's normal Codex CLI account.

The ChatGPT adapter starts a fresh SDK thread for each generation with a read-only empty working directory, approvals set to `never`, shell tools and subagents disabled, web search disabled, and CLI input history disabled. The current SDK may retain its normal session bookkeeping, so every Codex-owned file is confined to the isolated `<activity-data>/codex` directory and removed by the existing local-data deletion flow. The renderer receives only account status, plan label, and optional email display data—never tokens. App-server subprocesses are terminated during shutdown and before local-data deletion, and unexpected exits are retried with bounded exponential backoff.

The Apple executable uses a separate `FoundationModelProtocol` Swift library. Its wire format is tested without requiring the Foundation Models framework. Live guided generation remains in the thin `FoundationModelWorker` executable.

## Preserved task versions

| Task | Apple input | Apple schema | Cloud input | Cloud schema |
| --- | --- | --- | --- | --- |
| Timeline | `e8-final-state` | `timeline_entry_compact` | `hybrid-evidence-v3` | `timeline_entry` |
| Hour | `h1-semantic-last-hour` | `hour_rollup_compact` | `hybrid-last-hour-v2` | `hour_rollup` |
| Day | `d2-semantic-hours` | `daily_rollup_compact` | `semantic-hours-v2` | `daily_rollup` |

The authoritative manifest is `src/main/inference/tasks.ts`. It versions inputs, prompts, schemas, normalization, and output-token limits. Do not update a version label without intentionally updating the corresponding behavior and recording an evaluation.

## Change protocol

1. Run `npm run test:inference-preservation` before changing inference code.
2. Keep mechanical moves separate from behavior changes.
3. For a structural change, all six request hashes must remain exact.
4. For an intentional prompt or input change, create a new version and compare it with the previous version on the private held-out corpus.
5. Keep public fixtures synthetic. Never commit captured events, model inputs derived from a person, credentials, or private model outputs.
6. Local inference failure must never silently send evidence to a cloud provider.
7. ChatGPT sign-in must remain isolated under OpenHistory's owned data root and must not inherit ambient OpenAI API credentials.

## Evaluation tiers

- Pull requests run deterministic request, schema, fallback, provider-contract, Swift-protocol, and prompt-size checks without network access.
- Trusted Apple Silicon machines run the live Apple shadow benchmark and record schema success, presentation success, p50/p95 latency, pairwise quality, and issue counts.
- Cloud judging is manual or trusted-schedule only. Repository secrets are never exposed to forked pull requests.

The public synthetic corpus is under `fixtures/inference/`. A private corpus may be supplied locally through the benchmark scripts and must remain ignored.
