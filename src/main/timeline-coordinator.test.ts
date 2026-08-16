import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ActivityEpisode, ActivityEvent, TimelineItem } from "@shared/contracts";
import { InferenceOutputError } from "./inference/errors";
import type { InferenceService } from "./openai-service";
import { TimelineCoordinator } from "./timeline-coordinator";
import { TimelineStore } from "./timeline-store";

test("a malformed episode does not block later timeline summaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-timeline-coordinator-"));
  try {
    const first = event("first", "2026-08-14T09:00:00Z");
    const second = event("second", "2026-08-14T09:06:00Z");
    writeFileSync(
      join(directory, "events-2026-08-14.jsonl"),
      [first, second].map((entry) => JSON.stringify(entry)).join("\n")
    );

    const calls: string[] = [];
    const inference = {
      configured: true,
      provider: "openai" as const,
      unavailableMessage: "Unavailable",
      summarizeEpisode: async (episode: ActivityEpisode): Promise<TimelineItem> => {
        calls.push(episode.id);
        if (episode.events.some(({ id }) => id === "first")) {
          throw new InferenceOutputError("invalid_output");
        }
        return timelineItem(episode);
      }
    } as unknown as InferenceService;
    const coordinator = new TimelineCoordinator(
      directory,
      new TimelineStore(join(directory, "timeline")),
      inference
    );

    const state = await coordinator.summarizePending();
    assert.equal(calls.length, 2);
    assert.equal(state.items.length, 1);
    assert.equal(state.pendingEpisodeCount, 1);
    assert.match(state.lastError ?? "", /couldn't update part of your timeline/i);
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
    application: {
      bundleIdentifier: "com.example.Editor",
      localizedName: "Editor",
      processIdentifier: 42
    },
    element: { role: "AXButton", title: "Save" }
  };
}

function timelineItem(episode: ActivityEpisode): TimelineItem {
  return {
    version: 1,
    id: episode.id,
    startTime: episode.startTime,
    endTime: episode.endTime,
    title: "Clicked Save Button",
    description: "Clicked the Save button.",
    applications: episode.applications.map((application) => ({
      bundleIdentifier: application.bundleIdentifier ?? null,
      name: application.localizedName ?? application.bundleIdentifier ?? "Unknown application"
    })),
    workThreads: [],
    decisions: [],
    outcomes: [],
    blockers: [],
    surfaces: [],
    suggestion: null,
    sourceEventIds: episode.events.map(({ id }) => id)
  };
}
