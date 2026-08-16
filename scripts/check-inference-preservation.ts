import type { ActivityEpisode, HourItem, DailyRollupItem, TimelineItem } from "../src/shared/contracts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDailyRollupGenerationRequest,
  buildHourGenerationRequest,
  buildTimelineGenerationRequest,
  unrolledTimelineItems
} from "../src/main/openai-service";
import { inferenceTaskManifest } from "../src/main/inference/tasks";

interface PreservationFixture {
  version: 1;
  episode: ActivityEpisode;
  timelineItems: TimelineItem[];
  lastHour: HourItem;
  currentHour: HourItem;
  existingDailyRollup: DailyRollupItem;
}

interface ArtifactBaseline {
  sha256: string;
  inputCharacters: number;
  instructionCharacters: number;
  maximumInputCharacters: number;
}

interface PreservationBaseline {
  version: 1;
  fixtureVersion: 1;
  taskManifest: ReturnType<typeof inferenceTaskManifest>;
  artifacts: Record<string, ArtifactBaseline>;
}

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(readFileSync(
  resolve(root, "fixtures/inference/preservation-v1.json"),
  "utf8"
)) as PreservationFixture;

const unrolled = unrolledTimelineItems(fixture.timelineItems, [fixture.currentHour]);
const requests = {
  "timeline.apple": buildTimelineGenerationRequest("apple", fixture.episode),
  "timeline.cloud": buildTimelineGenerationRequest("openai", fixture.episode),
  "hour.apple": buildHourGenerationRequest("apple", fixture.timelineItems, fixture.lastHour),
  "hour.cloud": buildHourGenerationRequest("openai", fixture.timelineItems, fixture.lastHour),
  "day.apple": buildDailyRollupGenerationRequest(
    "apple",
    fixture.existingDailyRollup.date,
    fixture.timelineItems,
    fixture.existingDailyRollup,
    [fixture.currentHour],
    unrolled
  ),
  "day.cloud": buildDailyRollupGenerationRequest(
    "openai",
    fixture.existingDailyRollup.date,
    fixture.timelineItems,
    fixture.existingDailyRollup,
    [fixture.currentHour],
    unrolled
  )
};

const observed: PreservationBaseline = {
  version: 1,
  fixtureVersion: fixture.version,
  taskManifest: inferenceTaskManifest(),
  artifacts: Object.fromEntries(Object.entries(requests).map(([name, request]) => {
    const serialized = JSON.stringify({
      instructions: request.instructions,
      input: request.input,
      schemaName: request.schemaName,
      maxOutputTokens: request.maxOutputTokens
    });
    return [name, {
      sha256: createHash("sha256").update(serialized).digest("hex"),
      inputCharacters: request.input.length,
      instructionCharacters: request.instructions.length,
      maximumInputCharacters: Math.ceil(request.input.length * 1.05)
    }];
  }))
};

if (process.argv.includes("--print-baseline")) {
  process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(
  resolve(root, "fixtures/inference/preservation-baseline-v1.json"),
  "utf8"
)) as PreservationBaseline;

assert.deepEqual(observed.taskManifest, baseline.taskManifest, "inference task versions or limits changed");
for (const [name, expected] of Object.entries(baseline.artifacts)) {
  const actual = observed.artifacts[name];
  assert(actual, `missing preservation artifact ${name}`);
  assert.equal(actual.sha256, expected.sha256, `${name} request content changed`);
  assert.equal(actual.instructionCharacters, expected.instructionCharacters, `${name} instructions changed`);
  assert(actual.inputCharacters <= expected.maximumInputCharacters,
    `${name} input grew from ${expected.inputCharacters} to ${actual.inputCharacters} characters`);
}
assert.deepEqual(Object.keys(observed.artifacts).sort(), Object.keys(baseline.artifacts).sort());
process.stdout.write(`Inference preservation checks passed for ${Object.keys(observed.artifacts).length} model paths.\n`);
