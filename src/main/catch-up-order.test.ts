import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ActivityEpisode, ActivityEvent, TimelineItem } from "@shared/contracts";
import type { InferenceService } from "./openai-service";
import { TimelineCoordinator } from "./timeline-coordinator";
import { TimelineStore } from "./timeline-store";

test("timeline catch-up summarizes the newest episodes before older backlog", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-catch-up-order-"));
  try {
    // Two days of closed ten-minute episodes, written as separate daily files.
    const days = ["2026-08-13", "2026-08-14"];
    for (const day of days) {
      const events = [9, 10, 11].flatMap((hour) => [0, 4, 9].map((minute) =>
        event(`${day}-${hour}-${minute}`, `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`)
      ));
      writeFileSync(join(directory, `events-${day}.jsonl`), events.map((entry) => JSON.stringify(entry)).join("\n"));
    }

    const order: string[] = [];
    const inference = {
      configured: true,
      provider: "local" as const,
      unavailableMessage: "Unavailable",
      summarizeEpisode: async (episode: ActivityEpisode): Promise<TimelineItem> => {
        order.push(episode.startTime);
        return timelineItem(episode);
      }
    } as unknown as InferenceService;
    const coordinator = new TimelineCoordinator(directory, new TimelineStore(join(directory, "timeline")), inference);

    await coordinator.summarizePending();

    assert.ok(order.length >= 2);
    const sorted = [...order].sort().reverse();
    assert.deepEqual(order, sorted, "episodes are processed newest first");
    assert.ok(order[0]!.startsWith("2026-08-14"), "the newest day is summarized first");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function event(id: string, timestamp: string): ActivityEvent {
  return {
    version: 1,
    id,
    timestamp,
    kind: "pointer_click",
    application: { bundleIdentifier: "com.example.Editor", localizedName: "Editor", processIdentifier: 42 },
    element: { role: "AXButton", title: "Save" }
  };
}

function timelineItem(episode: ActivityEpisode): TimelineItem {
  return {
    version: 1,
    id: episode.id,
    startTime: episode.startTime,
    endTime: episode.endTime,
    title: "Clicked Save",
    description: "Clicked Save.",
    applications: [],
    workThreads: [],
    decisions: [],
    outcomes: [],
    blockers: [],
    surfaces: [],
    suggestion: null,
    sourceEventIds: episode.events.map(({ id }) => id)
  };
}
