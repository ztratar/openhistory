# Open-source release checklist

OpenHistory's public repository begins with a reviewed, history-free snapshot. Earlier private development history intentionally remains outside the public repository because it contains evaluation reports derived from local activity. Do not graft, mirror, or otherwise publish refs from that earlier history.

## Recommended release path

1. Finish and commit the source-tree cleanup on the private repository.
2. Run `npm run check`, plus the website test and lint commands.
3. Export a history-free snapshot:

   ```bash
   npm run export:public-snapshot -- /path/to/empty/openhistory-public
   ```

4. The exporter refuses a dirty source tree and writes only files committed in `HEAD`. Inside the history-free snapshot, run `npm ci && npm run check`; the public-repository scan works before a new Git repository is initialized. Run the website checks from its `website/` directory.
5. Manually inspect the exported tree for personal names, paths, URLs, model outputs, generated reports, credentials, and activity data.
6. Initialize a new public repository from the inspected snapshot, or coordinate an intentional history rewrite with every collaborator before force-updating the existing remote.
7. Enable private vulnerability reporting, secret scanning, dependency alerts, and branch protection requiring both CI jobs.

The clean-snapshot approach is recommended because it is non-destructive to the private development repository and makes the public provenance boundary explicit.

## Never publish

- `.env.local` or provider credentials;
- `activity-data`, JSONL event files, timeline/hour/daily-rollup indexes, or MCP credentials;
- private benchmark checkpoints or case-level evaluation reports;
- prompts or outputs containing captured personal activity;
- Apple Foundation Models Adapter Training Toolkit files, which are separately licensed by Apple;
- `.fmadapter` packages, model checkpoints, adapter weights, training environments, or training logs;
- notarization, signing, or deployment secrets.

## Release evidence

Record the source commit, snapshot commit, successful quality-gate output, dependency-lock hashes, Xcode/macOS versions, and whether a live model evaluation was run. Live model evaluation data stays private; publish only privacy-reviewed aggregates.
