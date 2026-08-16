import type { TimelineItem } from "../shared/contracts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { TimelineStore } from "./timeline-store";

test("persists a structured index and a readable Markdown entry", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-timeline-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new TimelineStore(directory);
  const item = sampleItem();

  store.save(item);

  assert.deepEqual(store.loadAll(), [item]);
  const markdownPath = resolve(directory, `${item.id}.md`);
  assert.equal(existsSync(markdownPath), true);
  const markdown = readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# Built the local timeline/);
  assert.match(markdown, /## Outcomes/);
  assert.match(markdown, /- Timeline storage passed its tests/);
  assert.match(markdown, /## Surfaces/);
  assert.doesNotMatch(markdown, /Artifacts/);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(markdownPath).mode & 0o777, 0o600);
  assert.equal(statSync(resolve(directory, "index.json")).mode & 0o777, 0o600);
});

test("loads legacy artifact fields as surfaces", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-timeline-legacy-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const legacy = { ...sampleItem(), surfaces: undefined, artifacts: ["legacy-note.md"] };
  writeFileSync(resolve(directory, "index.json"), JSON.stringify([legacy]));

  const [loaded] = new TimelineStore(directory).loadAll();

  assert(loaded);
  assert.deepEqual(loaded.surfaces, ["legacy-note.md"]);
  assert.deepEqual(loaded.links, []);
  assert.equal("artifacts" in (loaded as unknown as Record<string, unknown>), false);
});

function sampleItem(): TimelineItem {
  return {
    version: 1,
    id: "2026-08-14T09-00-00Z-test",
    startTime: "2026-08-14T09:00:00.000Z",
    endTime: "2026-08-14T09:08:00.000Z",
    title: "Built the local timeline",
    description: "Connected deterministic episodes to local structured storage.",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Timeline persistence"],
    decisions: ["Keep Markdown local"],
    outcomes: ["Timeline storage passed its tests"],
    blockers: [],
    surfaces: ["timeline/index.json"],
    links: [],
    suggestion: null,
    sourceEventIds: ["event-one", "event-two"]
  };
}
