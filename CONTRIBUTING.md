# Contributing to OpenHistory

OpenHistory handles unusually sensitive local data. Changes should make its behavior easier to understand without weakening its privacy boundaries.

## Before you start

1. Use macOS 14 or later, Node.js 22, and Swift 6.1 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` only if you need live model calls. Never commit local data or credentials.

## Quality gate

Run the complete check before opening a pull request:

```bash
npm run check
```

Tests should cover observable behavior and security boundaries, not private implementation details. Keep fixtures synthetic and never add captured user activity.

`npm run check` also verifies that the repository does not contain local activity files, machine-specific home paths, credential-shaped production values, or oversized artifacts.

## Inference changes

Model inputs and prompts are product behavior. Before changing inference code:

1. Read [the inference architecture](docs/architecture/inference.md) and [quality methodology](MODEL_QUALITY.md).
2. Run `npm run test:inference-preservation` and keep its baseline output.
3. Keep mechanical moves separate from prompt, input, schema, token-limit, fallback, or normalization changes.
4. Preserve all six request hashes for structural refactors.
5. For intentional behavior changes, bump the affected task version and include a blinded comparison against the previous version.

Live Apple and cloud evaluations use private local corpora and trusted credentials. They are not required for ordinary pull requests and must never run with secrets on code from an untrusted fork.

## Design principles

- Keep raw activity local unless the user explicitly requests an update.
- Treat collected and generated text as untrusted data.
- Prefer deterministic local processing before model calls.
- Keep the renderer sandboxed and the preload bridge narrow.
- Validate every disk or process boundary.
- Favor a small, obvious abstraction over a reusable framework without a current use.
- Add UI only when it removes ambiguity or enables a necessary action.

## Pull requests

Keep pull requests focused. Explain user-visible behavior, privacy implications, and how the change was verified. Security-sensitive changes should identify the protected boundary and include a regression test.
