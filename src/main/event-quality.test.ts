import type { ActivityEvent } from "@shared/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeEventQuality } from "./event-quality";

test("reports density, duplicates, coverage, and model compression without inspecting content", () => {
  const events: ActivityEvent[] = [
    event("start-one", "collector_started", -2),
    event("start-two", "collector_started", -1),
    event("activation", "application_activated", 0),
    event("focus", "focused_element_changed", 1),
    event("duplicate-focus", "focused_element_changed", 2),
    event("click", "pointer_click", 3)
  ];
  events[3]!.element = { role: "AXButton", title: "Run" };
  events[4]!.element = { role: "AXButton", title: "Run" };
  events[5]!.element = { role: "AXButton", title: "Run" };

  const metrics = analyzeEventQuality(events);
  assert.equal(metrics.totalEvents, 6);
  assert.equal(metrics.meaningfulEvents, 4);
  assert.equal(metrics.semanticEvents, 3);
  assert.equal(metrics.directActionEvents, 1);
  assert.equal(metrics.navigationEvents, 0);
  assert.equal(metrics.adjacentExactDuplicates, 1);
  assert.equal(metrics.episodeAdjacentExactDuplicates, 0);
  assert.equal(metrics.coveredSemanticKinds, 2);
  assert(metrics.rawToEpisodeCompressionPercent > 0);
  assert.equal(metrics.modelCompressionPercent, 0);
  assert(metrics.modelPayloadCharacters > 0);
  assert(metrics.approximateModelInputTokens > 0);
});

function event(id: string, kind: ActivityEvent["kind"], seconds: number): ActivityEvent {
  return {
    version: 1,
    id,
    kind,
    timestamp: new Date(Date.UTC(2026, 7, 14, 9, 0, seconds)).toISOString(),
    application: {
      bundleIdentifier: "com.example.App",
      localizedName: "App",
      processIdentifier: 42
    }
  };
}
