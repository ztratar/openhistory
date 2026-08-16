import type { ActivityEvent, HourItem, DailyRollupItem, TimelineItem } from "@shared/contracts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { segmentActivityEvents } from "./episode-segmenter";
import { HourStore } from "./hour-store";
import { DailyRollupStore } from "./daily-rollup-store";
import { reconcileProtectedHistory } from "./privacy-reconciler";
import { timelineRevision } from "./provenance";
import { TimelineStore } from "./timeline-store";

test("scrubs protected raw events and removes stale derived summaries", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-privacy-reconcile-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const safeEvent = browserEvent("safe-event", "2026-08-15T09:00:00.000Z", "focused_element_changed", {
    element: { role: "AXWebArea", title: "Safe work" }
  });
  const adultNavigation = browserEvent("adult-url", "2026-08-15T09:01:00.000Z", "url_changed", {
    browser: { url: "https://pornhub.com/private", domain: "pornhub.com" }
  });
  const adultText = browserEvent("adult-text", "2026-08-15T09:01:01.000Z", "text_input", {
    element: { role: "AXTextField", label: "private adult field" },
    textChange: {
      insertedText: "private adult text",
      deletedCharacterCount: 0,
      resultingValue: "private adult text"
    }
  });
  writeFileSync(
    resolve(directory, "events-2026-08-15.jsonl"),
    [safeEvent, adultNavigation, adultText].map((event) => JSON.stringify(event)).join("\n")
  );

  const timelineStore = new TimelineStore(resolve(directory, "timeline"));
  const hourStore = new HourStore(resolve(directory, "hours"));
  const dailyRollupStore = new DailyRollupStore(resolve(directory, "daily-rollups"));
  const safeEpisode = segmentActivityEvents([safeEvent])[0]!;
  const safeTimeline = timelineItem(safeEpisode.id, safeEpisode.events.map(({ id }) => id), "Safe work");
  const privateTimeline = timelineItem("private-episode", ["adult-url", "adult-text"], "Private adult summary");
  timelineStore.save(safeTimeline);
  timelineStore.save(privateTimeline);
  const privateRevision = timelineRevision(privateTimeline)!;
  hourStore.save(hourItem(privateTimeline.id, privateRevision));
  dailyRollupStore.save(dailyRollupItem(privateTimeline.id, privateRevision));

  const result = reconcileProtectedHistory(directory, timelineStore, hourStore, dailyRollupStore);

  assert.equal(result.rawEventsRemoved, 2);
  assert.equal(result.timelineItemsRemoved, 1);
  assert.equal(result.hourItemsRemoved, 1);
  assert.equal(result.dailyRollupsRemoved, 1);
  assert.deepEqual(timelineStore.loadAll().map(({ id }) => id), [safeTimeline.id]);
  assert.deepEqual(hourStore.loadAll(), []);
  assert.deepEqual(dailyRollupStore.loadAll(), []);
  assert.equal(existsSync(resolve(timelineStore.directory, "private-episode.md")), false);
  assert.equal(existsSync(resolve(hourStore.directory, "2026-08-15T09-00-00.000Z.md")), false);
  assert.equal(existsSync(resolve(dailyRollupStore.directory, "2026-08-15.md")), false);
  const raw = readFileSync(resolve(directory, "events-2026-08-15.jsonl"), "utf8");
  assert.doesNotMatch(raw, /pornhub|private adult/);
  assert.match(raw, /safe-event/);
});

function browserEvent(
  id: string,
  timestamp: string,
  kind: ActivityEvent["kind"],
  values: Partial<ActivityEvent>
): ActivityEvent {
  return {
    version: 1,
    id,
    timestamp,
    kind,
    application: {
      bundleIdentifier: "com.google.Chrome",
      localizedName: "Chrome",
      processIdentifier: 42
    },
    ...values
  };
}

function timelineItem(id: string, sourceEventIds: string[], title: string): TimelineItem {
  return {
    version: 1,
    id,
    startTime: "2026-08-15T09:00:00.000Z",
    endTime: "2026-08-15T09:00:01.000Z",
    title,
    description: title,
    applications: [{ bundleIdentifier: "com.google.Chrome", name: "Chrome" }],
    workThreads: [],
    decisions: [],
    outcomes: [],
    blockers: [],
    surfaces: [],
    suggestion: null,
    sourceEventIds
  };
}

function hourItem(sourceTimelineId: string, revision: string): HourItem {
  return {
    version: 1,
    id: "2026-08-15T09:00:00.000Z",
    startTime: "2026-08-15T09:00:00.000Z",
    endTime: "2026-08-15T10:00:00.000Z",
    title: "Private adult hour",
    summary: "Private adult summary",
    applications: [],
    workThreads: [],
    decisions: [],
    outcomes: [],
    blockers: [],
    surfaces: [],
    sourceTimelineIds: [sourceTimelineId],
    sourceTimelineRevisions: [revision],
    updatedAt: "2026-08-15T10:00:00.000Z"
  };
}

function dailyRollupItem(sourceTimelineId: string, revision: string): DailyRollupItem {
  return {
    version: 2,
    id: "2026-08-15",
    date: "2026-08-15",
    title: "Private adult day",
    summary: "Private adult summary",
    themes: [],
    accomplishments: [],
    decisions: [],
    unfinishedWork: [],
    recurringPatterns: [],
    sourceTimelineIds: [sourceTimelineId],
    sourceTimelineRevisions: [revision],
    updatedAt: "2026-08-15T18:00:00.000Z"
  };
}
