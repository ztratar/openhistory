import type { HourItem, TimelineItem } from "../shared/contracts";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { HourCoordinator, hourStartForTimestamp } from "./hour-coordinator";
import { HourStore } from "./hour-store";
import { InferenceService } from "./openai-service";
import { InferenceOutputError } from "./inference/errors";
import { timelineRevision } from "./provenance";
import { TimelineStore } from "./timeline-store";

test("marks only closed clock hours pending and validates their provenance", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-hour-coordinator-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const hourStore = new HourStore(resolve(root, "hours"));
  const timelineItem = sampleTimelineItem();
  timelineStore.save(timelineItem);
  const coordinator = new HourCoordinator(
    timelineStore,
    hourStore,
    new InferenceService({ settings: testInferenceSettings() })
  );
  const startTime = hourStartForTimestamp(timelineItem.startTime);
  const endTime = new Date(Date.parse(startTime) + 60 * 60 * 1_000).toISOString();

  assert.equal(coordinator.getState(Date.parse(endTime) - 1).pendingHourCount, 0);
  assert.equal(coordinator.getState(Date.parse(endTime)).pendingHourCount, 1);
  hourStore.save(sampleHour(timelineItem, startTime, endTime));
  const state = coordinator.getState(Date.parse(endTime));
  assert.equal(state.pendingHourCount, 0);
  assert.deepEqual(state.items.map(({ id }) => id), [startTime]);
});

test("keeps legacy timeline entries without event provenance out of hour rollups", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-legacy-hour-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const legacy = sampleTimelineItem();
  delete legacy.sourceEventIds;
  timelineStore.save(legacy);
  const coordinator = new HourCoordinator(
    timelineStore,
    new HourStore(resolve(root, "hours")),
    new InferenceService({ settings: testInferenceSettings() })
  );
  assert.equal(coordinator.getState(Date.parse("2030-01-01T00:00:00Z")).pendingHourCount, 0);
});

test("generates a pending batch chronologically and supplies the adjacent last hour", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-hour-context-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const first = sampleTimelineItem();
  const second: TimelineItem = {
    ...sampleTimelineItem(),
    id: "episode-two",
    startTime: "2020-08-14T13:08:00.000Z",
    endTime: "2020-08-14T13:16:00.000Z",
    sourceEventIds: ["event-two"]
  };
  timelineStore.save(first);
  timelineStore.save(second);
  const service = new RecordingInferenceService();
  const coordinator = new HourCoordinator(
    timelineStore,
    new HourStore(resolve(root, "hours")),
    service
  );

  await coordinator.consolidatePending();

  const firstHour = hourStartForTimestamp(first.startTime);
  const secondHour = hourStartForTimestamp(second.startTime);
  assert.deepEqual(service.calls, [
    { startTime: firstHour, lastHourId: undefined },
    { startTime: secondHour, lastHourId: firstHour }
  ]);
});

test("floors timestamps to the start of their local clock hour", () => {
  const start = new Date(hourStartForTimestamp("2026-08-14T12:34:56.789Z"));
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(start.getMilliseconds(), 0);
});

test("continues consolidating later hours after one item-scoped failure", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-hour-isolation-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const timelineStore = new TimelineStore(resolve(root, "timeline"));
  const first = sampleTimelineItem();
  const second: TimelineItem = {
    ...sampleTimelineItem(),
    id: "episode-two",
    startTime: "2020-08-14T13:08:00.000Z",
    endTime: "2020-08-14T13:16:00.000Z",
    sourceEventIds: ["event-two"]
  };
  timelineStore.save(first);
  timelineStore.save(second);
  const service = new RecordingInferenceService(hourStartForTimestamp(first.startTime));
  const coordinator = new HourCoordinator(
    timelineStore,
    new HourStore(resolve(root, "hours")),
    service
  );

  const state = await coordinator.consolidatePending();

  assert.deepEqual(service.calls.map(({ startTime }) => startTime), [
    hourStartForTimestamp(first.startTime),
    hourStartForTimestamp(second.startTime)
  ]);
  assert.deepEqual(state.items.map(({ id }) => id), [hourStartForTimestamp(second.startTime)]);
  assert.equal(state.pendingHourCount, 1);
  assert.match(state.lastError ?? "", /couldn't update part of your timeline/i);
});

function sampleTimelineItem(): TimelineItem {
  return {
    version: 1,
    id: "episode-one",
    startTime: "2020-08-14T12:08:00.000Z",
    endTime: "2020-08-14T12:16:00.000Z",
    title: "Built provenance",
    description: "Linked timeline evidence to an hour rollup.",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Timeline hierarchy"],
    decisions: [], outcomes: [], blockers: [], surfaces: [], suggestion: null,
    sourceEventIds: ["event-one"]
  };
}

function sampleHour(source: TimelineItem, startTime: string, endTime: string): HourItem {
  return {
    version: 1,
    id: startTime,
    startTime,
    endTime,
    title: "Built provenance",
    summary: "Linked the hourly summary to its source.",
    applications: source.applications,
    workThreads: [], decisions: [], outcomes: [], blockers: [], surfaces: [],
    sourceTimelineIds: [source.id],
    sourceTimelineRevisions: [timelineRevision(source)!],
    updatedAt: "2020-08-14T13:05:00.000Z"
  };
}

class RecordingInferenceService extends InferenceService {
  readonly calls: Array<{ startTime: string; lastHourId?: string }> = [];

  constructor(private readonly failedStartTime?: string) {
    super({ settings: testInferenceSettings() });
  }

  override get configured(): boolean {
    return true;
  }

  override async consolidateHour(
    startTime: string,
    endTime: string,
    timelineItems: TimelineItem[],
    lastHour?: HourItem
  ): Promise<HourItem> {
    this.calls.push({ startTime, lastHourId: lastHour?.id });
    if (startTime === this.failedStartTime) throw new InferenceOutputError("invalid_output");
    return {
      version: 1,
      id: startTime,
      startTime,
      endTime,
      title: "Consolidated timeline evidence",
      summary: "- Consolidated the current hour from its own timeline evidence.",
      applications: timelineItems.flatMap((item) => item.applications),
      workThreads: [],
      decisions: [],
      outcomes: [],
      blockers: [],
      surfaces: [],
      sourceTimelineIds: timelineItems.map((item) => item.id),
      sourceTimelineRevisions: timelineItems.map((item) => timelineRevision(item)!),
      updatedAt: new Date().toISOString()
    };
  }
}

function testInferenceSettings() {
  return {
    version: 1 as const,
    enabled: true,
    provider: "openai" as const,
    models: { apple: "system-default", openai: "test-model", anthropic: "test-model", kimi: "test-model" }
  };
}
