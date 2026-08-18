import { basename, resolve } from "node:path";

export function privateExperimentCheckpointPath(reportPath: string, workspace = process.cwd()): string {
  const requestedName = basename(reportPath).replace(/\.md$/i, "").trim();
  const safeName = requestedName && requestedName !== "." ? requestedName : "apple-rollup-hill-climb";
  return resolve(workspace, "reports/private", `${safeName}-results.json`);
}
