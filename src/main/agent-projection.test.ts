import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DailyRollupItem, TimelineItem } from "@shared/contracts";
import { AgentProjectionStore } from "./agent-projection";

test("writes a permission-restricted sanitized projection without raw event identifiers", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-agent-projection-"));
  context.after(() => import("node:fs").then(({ rmSync }) => rmSync(directory, { recursive: true, force: true })));
  const projection = new AgentProjectionStore(
    join(directory, "projection"),
    { loadAll: () => [timelineFixture()] },
    { loadAll: () => [dailyRollupFixture()] }
  ).refresh();

  assert.equal(projection.timeline.length, 1);
  assert.equal(projection.timeline[0]?.evidenceEventCount, 2);
  assert.deepEqual(projection.timeline[0]?.surfaces, ["prototype.md"]);
  assert.equal(projection.timeline[0]?.description.includes("sk-sensitive"), false);
  assert.equal(projection.timeline[0]?.description.includes("person@example.com"), false);
  assert.equal(projection.dailyRollups[0]?.summary.includes("password=hunter2"), false);

  const indexPath = join(directory, "projection", "index.json");
  const stored = readFileSync(indexPath, "utf8");
  assert.equal(stored.includes("sourceEventIds"), false);
  assert.equal(stored.includes('"artifacts"'), false);
  assert.equal(stored.includes("event-sensitive-one"), false);
  assert.equal(stored.includes("sk-sensitive"), false);
  assert.equal(statSync(indexPath).mode & 0o777, 0o600);
});

test("searches only the projected timeline and daily-rollup data", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-agent-search-"));
  context.after(() => import("node:fs").then(({ rmSync }) => rmSync(directory, { recursive: true, force: true })));
  const store = new AgentProjectionStore(
    join(directory, "projection"),
    { loadAll: () => [timelineFixture()] },
    { loadAll: () => [dailyRollupFixture()] }
  );

  const results = store.search({ query: "prototype", from: "2026-08-14", to: "2026-08-14" });
  assert.equal(results.length, 2);
  assert.equal(results.every((result) => result.resourceUri.startsWith("openhistory://")), true);
  assert.deepEqual(store.getDay("2026-08-14").timeline.map((item) => item.id), ["timeline-one"]);
  assert.deepEqual(store.findSurfaces({ query: "prototype" }).map((item) => item.surface), ["prototype.md"]);
  assert.deepEqual(store.getUnfinishedWork({}).map((item) => item.unfinishedWork), ["Test the prototype"]);
});

function timelineFixture(): TimelineItem {
  return {
    version: 1,
    id: "timeline-one",
    startTime: "2026-08-14T17:00:00.000Z",
    endTime: "2026-08-14T17:10:00.000Z",
    title: "Built prototype",
    description: "Used sk-sensitive-credential-value for person@example.com while testing",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Prototype work"],
    decisions: [],
    outcomes: ["Prototype completed"],
    blockers: [],
    surfaces: ["prototype.md"],
    suggestion: null,
    sourceEventIds: ["event-sensitive-one", "event-sensitive-two"]
  };
}

function dailyRollupFixture(): DailyRollupItem {
  return {
    version: 2,
    id: "2026-08-14",
    date: "2026-08-14",
    title: "Prototype day",
    summary: "Finished the prototype with password=hunter2",
    themes: ["Prototype"],
    accomplishments: ["Built the prototype"],
    decisions: [],
    unfinishedWork: ["Test the prototype"],
    recurringPatterns: [],
    sourceTimelineIds: ["timeline-one"],
    sourceTimelineRevisions: ["timeline-one:revision"],
    updatedAt: "2026-08-14T18:00:00.000Z"
  };
}
