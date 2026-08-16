import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RecentActivityReader } from "./unsummarized-activity";

test("returns activity from the requested recent time window, not a fixed event count", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-unsummarized-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "events-2026-08-15.jsonl"), [
    event("summarized", "2026-08-15T10:00:00.000Z", "window_changed", "Covered work"),
    event("outside-window", "2026-08-15T10:00:30.000Z", "window_changed", "Older pending work"),
    ...Array.from({ length: 75 }, (_, index) => ({
      ...event(
        `pending-${index}`,
        new Date(Date.parse("2026-08-15T10:01:00.000Z") + index * 5_000).toISOString(),
        index === 74 ? "pointer_click" : "window_changed",
        index === 74 ? "person@example.com" : `Pending work ${index}`
      ),
      ...(index === 74 ? { element: { role: "AXButton", label: "Send and archive" } } : {})
    })),
    event("future", "2026-08-15T10:12:00.000Z", "window_changed", "Future clock-skewed work")
  ].map((value) => JSON.stringify(value)).join("\n"));

  const reader = new RecentActivityReader(
    directory,
    () => false,
    () => new Date("2026-08-15T10:11:00.000Z")
  );
  const result = reader.getRecent(10);

  assert.equal(result.totalAvailable, 78);
  assert.equal(result.totalInWindow, 75);
  assert.equal(result.events.length, 75);
  assert.equal(result.windowMinutes, 10);
  assert.equal(result.windowStartedAt, "2026-08-15T10:01:00.000Z");
  assert.equal(result.truncated, false);
  assert.equal(result.oldestReturnedAt, "2026-08-15T10:01:00.000Z");
  assert.equal(result.newestReturnedAt, "2026-08-15T10:07:10.000Z");
  assert.deepEqual(result.submissionActions.map((action) => action.verb), ["Sent"]);
  assert.deepEqual(result.submissionActions.map((action) => action.control), ["Send and archive"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /Covered work|Older pending work|Future clock-skewed work|person@example\.com/
  );
  assert.match(JSON.stringify(result), /\[redacted email\]/);
});

test("returns recent events regardless of whether the timeline has already summarized them", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-recent-summarized-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "events-2026-08-15.jsonl"), [
    event("summarized", "2026-08-15T10:00:15.000Z", "window_changed", "Summarized work"),
    event("pending", "2026-08-15T10:01:00.000Z", "pointer_click", "Pending work")
  ].map((value) => JSON.stringify(value)).join("\n"));

  const result = new RecentActivityReader(
    directory,
    () => false,
    () => new Date("2026-08-15T10:02:00.000Z")
  ).getRecent();

  assert.equal(result.totalAvailable, 2);
  assert.equal(result.totalInWindow, 2);
  assert.deepEqual(result.submissionActions, []);
  assert.deepEqual(
    result.events.map((candidate) => candidate.windowTitle),
    ["Summarized work", "Pending work"]
  );
  assert.equal(typeof result.events[0]!.localTime, "string");
  assert.equal(typeof result.timeZone, "string");
});

function event(id: string, timestamp: string, kind: string, windowTitle: string): object {
  return {
    version: 1,
    id,
    timestamp,
    kind,
    application: {
      bundleIdentifier: "com.example.Editor",
      localizedName: "Editor",
      processIdentifier: 42
    },
    windowTitle
  };
}
