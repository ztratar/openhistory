import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { privateExperimentCheckpointPath } from "../../scripts/lib/private-checkpoint-path";

test("keeps raw experiment checkpoints private when the aggregate report is public", () => {
  const workspace = resolve("synthetic-workspace");
  const reportPath = resolve(workspace, "reports", "apple-rollup-summary.md");

  assert.equal(
    privateExperimentCheckpointPath(reportPath, workspace),
    resolve(workspace, "reports/private/apple-rollup-summary-results.json")
  );
});
