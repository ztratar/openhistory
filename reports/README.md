# Evaluation reports

Only aggregate, privacy-reviewed reports belong in this directory. Detailed case reports, checkpoints, raw evidence, and generated outputs derived from personal activity must remain local and untracked.

Use `npm run benchmark:apple-model` for a non-destructive, local-only shadow evaluation. Its default `*-latest.md` and `*-metrics.json` outputs are ignored. Cloud judging occurs only when `--cloud-judge` is supplied and sends selected evidence and summaries to OpenAI. Manually extract aggregate results only after verifying that titles, descriptions, rationales, paths, URLs, identifiers, and prompt excerpts contain no personal data.

Apple adapter pilot datasets, training artifacts, case-level results, and generated reports default to `reports/private/apple-adapter-pilot/`. Do not move those outputs into this directory. Public documentation of the experimental workflow belongs under `docs/` and must not contain live activity-derived examples, dataset hashes, adapter hashes, local paths, or generated outputs.
