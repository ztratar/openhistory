import type { DailyRollupItem } from "../shared/contracts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DailyRollupStore } from "./daily-rollup-store";

test("writes daily rollups as Markdown with source provenance", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-daily-rollup-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new DailyRollupStore(directory);
  const dailyRollup = sampleDailyRollup();

  store.save(dailyRollup);

  assert.deepEqual(store.loadAll(), [dailyRollup]);
  const markdownPath = resolve(directory, "2026-08-14.md");
  assert.equal(existsSync(markdownPath), true);
  const markdown = readFileSync(markdownPath, "utf8");
  assert.match(markdown, /sourceTimelineIds: \["episode-one","episode-two"\]/);
  assert.match(markdown, /version: 2/);
  assert.match(markdown, /\[Pull Request #4\]\(<https:\/\/github\.com\/example\/openhistory\/pull\/4>\)/);
  assert.match(markdown, /## Unfinished work/);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(markdownPath).mode & 0o777, 0o600);
  assert.equal(statSync(resolve(directory, "index.json")).mode & 0o777, 0o600);
});

test("imports version-1 data into the daily-rollup store", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-daily-rollup-migration-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const legacyDirectory = resolve(root, "memory");
  const directory = resolve(root, "daily-rollups");
  await mkdir(legacyDirectory);
  writeFileSync(resolve(legacyDirectory, "index.json"), JSON.stringify([{
    ...sampleDailyRollup(),
    version: 1,
    openLoops: ["Add richer browser context"],
    unfinishedWork: undefined,
    links: undefined
  }]));

  const store = new DailyRollupStore(directory, legacyDirectory);

  const imported = store.loadAll()[0];
  assert.deepEqual(imported, { ...sampleDailyRollup(), links: [] });
  assert.deepEqual(imported?.links, []);
  assert.match(readFileSync(resolve(directory, "2026-08-14.md"), "utf8"), /## Unfinished work/);
  assert.doesNotMatch(readFileSync(resolve(directory, "index.json"), "utf8"), /openLoops/);
  assert.equal(existsSync(resolve(legacyDirectory, "index.json")), true);
});

function sampleDailyRollup(): DailyRollupItem {
  return {
    version: 2,
    id: "2026-08-14",
    date: "2026-08-14",
    title: "OpenHistory foundation",
    summary: "Built a local-first activity and daily-rollup pipeline in Pull Request #4.",
    themes: ["Privacy", "Native collection"],
    accomplishments: ["Persisted daily rollups"],
    decisions: ["Keep source provenance"],
    unfinishedWork: ["Add richer browser context"],
    recurringPatterns: ["Test each boundary locally"],
    links: [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }],
    sourceTimelineIds: ["episode-one", "episode-two"],
    updatedAt: "2026-08-14T18:00:00.000Z"
  };
}
