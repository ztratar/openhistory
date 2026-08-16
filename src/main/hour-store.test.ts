import type { HourItem } from "../shared/contracts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { HourStore } from "./hour-store";

test("writes hour rollups as private Markdown with timeline provenance", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-hours-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new HourStore(directory);
  const hour = sampleHour();

  store.save(hour);

  assert.deepEqual(store.loadAll(), [hour]);
  const markdownPath = resolve(directory, "2026-08-14T09-00-00.000Z.md");
  assert.equal(existsSync(markdownPath), true);
  const markdown = readFileSync(markdownPath, "utf8");
  assert.match(markdown, /sourceTimelineRevisions: \["episode-one:revision"\]/);
  assert.match(markdown, /\[Pull Request #4\]\(<https:\/\/github\.com\/example\/openhistory\/pull\/4>\)/);
  assert.match(markdown, /## Outcomes/);
  assert.match(markdown, /## Surfaces/);
  assert.doesNotMatch(markdown, /Artifacts/);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(markdownPath).mode & 0o777, 0o600);
});

test("migrates stored hour rollups without links to an empty link list", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-hours-legacy-links-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const legacy = { ...sampleHour(), links: undefined };
  writeFileSync(resolve(directory, "index.json"), JSON.stringify([legacy]));

  assert.deepEqual(new HourStore(directory).loadAll()[0]?.links, []);
});

function sampleHour(): HourItem {
  return {
    version: 1,
    id: "2026-08-14T09:00:00.000Z",
    startTime: "2026-08-14T09:00:00.000Z",
    endTime: "2026-08-14T10:00:00.000Z",
    title: "Built the hour rollup",
    summary: "Grouped detailed sessions into a stable clock hour and updated Pull Request #4.",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Timeline hierarchy"],
    decisions: [],
    outcomes: ["Persisted a summary"],
    blockers: [],
    surfaces: ["hour-store.ts"],
    links: [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }],
    sourceTimelineIds: ["episode-one"],
    sourceTimelineRevisions: ["episode-one:revision"],
    updatedAt: "2026-08-14T10:05:00.000Z"
  };
}
