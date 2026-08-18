import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineItem } from "@shared/contracts";
import type { StructuredGenerationRequest } from "./inference/contracts";
import { InferenceOutputError } from "./inference/errors";
import { InferenceService } from "./openai-service";
import {
  ensureAppleDayCoverage,
  ensureAppleHourCoverage,
  fallbackAppleHourDraft
} from "./inference/rollup-coverage";

test("supplements a short Apple hour with distinct grounded source work", () => {
  const items = [
    timelineItem("one", "Drafted timeline requirements", "Drafted expandable hour and day hierarchy requirements for the local history view."),
    timelineItem("two", "Verified release packaging", "Ran the release packaging checks and observed a successful signed application build."),
    timelineItem("three", "Reviewed database navigation", "Reviewed database navigation and specified a simpler Library layout for typed and untyped sources.")
  ];
  const result = ensureAppleHourCoverage({
    title: "- Drafted timeline requirements",
    summary: "- Drafted expandable timeline requirements.",
    workThreads: [], decisions: [], outcomes: [], blockers: [], surfaces: [], linkReferences: []
  }, items);

  assert.equal(result.title, "Drafted local timeline requirements");
  assert(result.summary.split("\n").length >= 2);
  assert.match(result.summary, /successful signed application build/i);
  assert(result.summary.split(/\s+/).length >= 32);
});

test("supplements a one-bullet Apple day from distinct hour evidence", () => {
  const first = timelineItem("one", "Drafted timeline requirements", "Drafted expandable timeline requirements for local work history.");
  const second = timelineItem("two", "Verified release packaging", "Verified a signed application build with local release checks.");
  const result = ensureAppleDayCoverage({
    title: "Summarized OpenHistory work",
    summary: "- Drafted timeline requirements.",
    themes: [], accomplishments: [], decisions: [], unfinishedWork: [], recurringPatterns: [], linkReferences: []
  }, [
    hour(first, "- Drafted expandable timeline requirements and refined the local work-history hierarchy."),
    hour(second, "- Verified a signed application build and passed the local release packaging checks."),
    { ...hour(second, "- Reviewed privacy controls and clarified local-only Apple Intelligence behavior."), id: "hour-three", sourceTimelineIds: ["three"] },
    { ...hour(second, "- Investigated an unresolved hourly-summary generation failure."), id: "hour-four", sourceTimelineIds: ["four"] }
  ], []);

  assert(result.summary.split("\n").length >= 2);
  assert(result.summary.split(/\s+/).length >= 30);
});

test("replaces telemetry-like day narration with grounded workstream coverage", () => {
  const source = timelineItem("one", "Verified release packaging", "Verified a signed application build with local release checks.");
  const result = ensureAppleDayCoverage({
    title: "Reviewed release work",
    summary: "- Used the release page (ToDesktop / - Part of group / - Google Chrome) to click release controls.",
    themes: [], accomplishments: [], decisions: [], unfinishedWork: [], recurringPatterns: [], linkReferences: []
  }, [
    hour(source, "- Verified a signed application build and passed the local release packaging checks."),
    { ...hour(source, "- Drafted release notes and clarified the remaining notarization work."), id: "hour-two" }
  ], []);

  assert.doesNotMatch(result.summary, /Part of group|Google Chrome|click release controls/i);
  assert.match(result.summary, /signed application build|release notes/i);
});

test("replaces a generic bare UI label without encoding a private name", () => {
  const source = timelineItem("one", "Verified release packaging", "Verified a signed application build with local release checks.");
  const result = ensureAppleDayCoverage({
    title: "Reviewed release work",
    summary: "- Example Contact)",
    themes: [], accomplishments: [], decisions: [], unfinishedWork: [], recurringPatterns: [], linkReferences: []
  }, [
    hour(source, "- Verified a signed application build and passed the local release packaging checks.")
  ], []);

  assert.doesNotMatch(result.summary, /Example Contact/i);
  assert.match(result.summary, /signed application build/i);
});

test("returns a deterministic grounded hour when Apple generation fails twice", async () => {
  let attempts = 0;
  const service = new InferenceService({
    settings: appleSettings(),
    adapter: {
      provider: "apple",
      model: "system-default",
      async generate<T>(_request: StructuredGenerationRequest<T>): Promise<T> {
        attempts += 1;
        throw new InferenceOutputError("invalid_output");
      }
    }
  });
  const items = [
    timelineItem("one", "Drafted timeline requirements", "Drafted expandable timeline requirements for local work history."),
    timelineItem("two", "Verified release packaging", "Verified a signed application build with local release checks."),
    timelineItem("three", "Reviewed privacy controls", "Reviewed privacy controls for local Apple Intelligence summaries.")
  ];

  const result = await service.consolidateHour(
    "2026-08-14T12:00:00.000Z",
    "2026-08-14T13:00:00.000Z",
    items
  );

  assert.equal(attempts, 2);
  assert(result.summary.split("\n").length >= 2);
  assert.match(result.summary, /timeline|release|privacy/i);
});

test("fallback hour preserves supported structured source facts", () => {
  const item = {
    ...timelineItem("one", "Verified release packaging", "Verified a signed application build."),
    workThreads: ["Release packaging"],
    decisions: ["Use local signing"],
    outcomes: ["Signed build succeeded"],
    blockers: ["Notarization remains pending"],
    surfaces: ["Release configuration"]
  };
  const result = fallbackAppleHourDraft([item]);

  assert.deepEqual(result.workThreads, item.workThreads);
  assert.deepEqual(result.decisions, item.decisions);
  assert.deepEqual(result.outcomes, item.outcomes);
  assert.deepEqual(result.blockers, item.blockers);
  assert.deepEqual(result.surfaces, item.surfaces);
});

function timelineItem(id: string, title: string, description: string): TimelineItem {
  return {
    version: 1,
    id,
    startTime: `2026-08-14T12:0${id === "one" ? 0 : id === "two" ? 2 : 4}:00.000Z`,
    endTime: `2026-08-14T12:1${id === "one" ? 0 : id === "two" ? 2 : 4}:00.000Z`,
    title,
    description,
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: [], decisions: [], outcomes: [], blockers: [], surfaces: [], suggestion: null,
    sourceEventIds: [`event-${id}`]
  };
}

function hour(source: TimelineItem, summary: string) {
  return {
    version: 1 as const,
    id: `hour-${source.id}`,
    startTime: source.startTime,
    endTime: source.endTime,
    title: source.title,
    summary,
    applications: source.applications,
    workThreads: [], decisions: [], outcomes: [], blockers: [], surfaces: [], links: [],
    sourceTimelineIds: [source.id],
    sourceTimelineRevisions: [`revision-${source.id}`],
    updatedAt: "2026-08-14T13:00:00.000Z"
  };
}

function appleSettings() {
  return {
    version: 1 as const,
    enabled: true,
    provider: "apple" as const,
    models: { apple: "system-default", openai: "unused", anthropic: "unused", kimi: "unused" }
  };
}
