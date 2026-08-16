# Experimental Apple Foundation Models adapters

OpenHistory includes developer tooling for testing a task-specific Apple Foundation Models adapter. No adapter is bundled, enabled, or recommended for production use. The standard Apple provider continues to use the system model unless a developer explicitly supplies `OPENHISTORY_FOUNDATION_MODEL_ADAPTER`.

## Separate Apple toolkit

Apple's Foundation Models Adapter Training Toolkit is separately licensed software and is not part of this repository. Contributors must obtain it directly from Apple, review and accept Apple's current terms, and keep the downloaded toolkit outside the OpenHistory source tree. Do not copy toolkit code, model assets, documentation, or license files into this repository.

## Private local workflow

The pilot commands deliberately write datasets, reports, checkpoints, environments, logs, evaluation outputs, and packaged adapters beneath the ignored `reports/private/apple-adapter-pilot/` directory:

```bash
npm run adapter:export-pilot
OPENHISTORY_ADAPTER_EPOCHS=1 OPENHISTORY_ADAPTER_BATCH_SIZE=1 \
  npm run adapter:train-pilot -- /absolute/path/to/adapter_training_toolkit
npm run adapter:benchmark-pilot -- \
  /absolute/path/to/activity-data \
  reports/private/apple-adapter-pilot \
  reports/private/apple-adapter-pilot/training/exports/example.fmadapter
```

The exporter uses Apple's schema-free guided-generation format: one system message, one user message, one assistant response, and JSON-dumps separator spacing. The native worker disables schema injection only when a custom timeline adapter is explicitly loaded.

Never commit or distribute activity-derived JSONL, prompts, labels, generations, checkpoints, training logs, virtual environments, or adapters. A trained adapter must be treated as sensitive because its weights can memorize its source material.

## Current status

A small private plumbing pilot verified dataset export, training, packaging, loading, and on-device evaluation. It did not establish a quality improvement over the unmodified system model, so OpenHistory does not ship or select a custom adapter. A meaningful future study requires human-reviewed targets, substantially more diverse days, whole-day held-out evaluation, and privacy review before publishing aggregate conclusions.
