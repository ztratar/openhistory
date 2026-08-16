import type { HourItem, DailyRollupItem, TimelineItem } from "../shared/contracts";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { HourStore } from "./hour-store";
import { DailyRollupCoordinator } from "./daily-rollup-coordinator";
import { DailyRollupStore } from "./daily-rollup-store";
import { InferenceService } from "./openai-service";
import { TimelineStore } from "./timeline-store";
import { timelineRevision } from "./provenance";

test("marks a day pending only when its timeline provenance changes", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-coordinator-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const dailyRollupStore = new DailyRollupStore(resolve(root, "daily-rollups"));
  const timelineItem = sampleTimelineItem();
  timelineStore.save(timelineItem);
  const coordinator = new DailyRollupCoordinator(
    timelineStore,
    dailyRollupStore,
    new InferenceService({ settings: testInferenceSettings() })
  );

  assert.equal(coordinator.getState().pendingDayCount, 1);
  dailyRollupStore.save(sampleDailyRollup(timelineItem));
  assert.equal(coordinator.getState().pendingDayCount, 0);
});

function sampleTimelineItem(): TimelineItem {
  return {
    version: 1,
    id: "episode-one",
    startTime: "2026-08-14T12:00:00.000Z",
    endTime: "2026-08-14T12:08:00.000Z",
    title: "Built provenance",
    description: "Linked timeline evidence to a daily rollup.",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Daily rollups"],
    decisions: [], outcomes: [], blockers: [], surfaces: [], suggestion: null,
    sourceEventIds: ["event-one"]
  };
}

test("does not consolidate legacy timeline text without current event provenance", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-legacy-coordinator-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const legacy = sampleTimelineItem();
  delete legacy.sourceEventIds;
  timelineStore.save(legacy);
  const coordinator = new DailyRollupCoordinator(
    timelineStore,
    new DailyRollupStore(resolve(root, "daily-rollups")),
    new InferenceService({ settings: testInferenceSettings() })
  );
  assert.equal(coordinator.getState().pendingDayCount, 0);
});

test("supplies only provenance-current hour rollups to daily consolidation", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-daily-rollup-hours-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const dailyRollupStore = new DailyRollupStore(resolve(root, "daily-rollups"));
  const hourStore = new HourStore(resolve(root, "hours"));
  const timelineItem = sampleTimelineItem();
  timelineStore.save(timelineItem);
  hourStore.save(sampleHour(timelineItem));
  const inference = new InferenceService({
    apiKey: "test-key",
    settings: testInferenceSettings()
  });
  let suppliedHours: HourItem[] = [];
  inference.consolidateDailyRollup = async (_date, _items, _existing, hours = []) => {
    suppliedHours = hours;
    return sampleDailyRollup(timelineItem);
  };

  const coordinator = new DailyRollupCoordinator(timelineStore, dailyRollupStore, inference, hourStore);
  await coordinator.consolidatePending();
  assert.deepEqual(suppliedHours.map((hour) => hour.id), ["2026-08-14T12:00:00.000Z"]);

  const revised = {
    ...timelineItem,
    description: "Changed after the hour was generated.",
    sourceEventIds: ["event-one", "event-two"]
  };
  timelineStore.save(revised);
  inference.consolidateDailyRollup = async (_date, _items, _existing, hours = []) => {
    suppliedHours = hours;
    return sampleDailyRollup(revised);
  };
  await coordinator.consolidatePending();
  assert.deepEqual(suppliedHours, []);
});

function sampleDailyRollup(source: TimelineItem): DailyRollupItem {
  return {
    version: 2,
    id: "2026-08-14",
    date: "2026-08-14",
    title: "Built provenance",
    summary: "Linked the daily rollup to its source.",
    themes: [], accomplishments: [], decisions: [], unfinishedWork: [], recurringPatterns: [],
    sourceTimelineIds: [source.id],
    sourceTimelineRevisions: [timelineRevision(source)!],
    updatedAt: "2026-08-14T18:00:00.000Z"
  };
}

function sampleHour(source: TimelineItem): HourItem {
  return {
    version: 1,
    id: "2026-08-14T12:00:00.000Z",
    startTime: "2026-08-14T12:00:00.000Z",
    endTime: "2026-08-14T13:00:00.000Z",
    title: "Built provenance-aware rollup",
    summary: "- Linked the hour to its source.",
    applications: source.applications,
    workThreads: [], decisions: [], outcomes: [], blockers: [], surfaces: [],
    sourceTimelineIds: [source.id],
    sourceTimelineRevisions: [timelineRevision(source)!],
    updatedAt: "2026-08-14T13:01:00.000Z"
  };
}

function testInferenceSettings() {
  return {
    version: 1 as const,
    enabled: true,
    provider: "openai" as const,
    models: { apple: "system-default", openai: "test-model", anthropic: "test-model", kimi: "test-model" }
  };
}
