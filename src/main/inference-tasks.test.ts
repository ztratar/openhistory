import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_TASK,
  HOUR_TASK,
  inferenceTaskManifest,
  TIMELINE_TASK
} from "./inference/tasks";

test("versions every production inference input, prompt, schema, and token limit", () => {
  const manifest = inferenceTaskManifest();
  assert.deepEqual(Object.keys(manifest), ["timeline", "hour", "day"]);
  for (const task of Object.values(manifest)) {
    for (const profile of [task.apple, task.cloud]) {
      assert(profile.inputVersion.length > 0);
      assert(profile.promptVersion.length > 0);
      assert(profile.schemaName.length > 0);
      assert(profile.schemaVersion.length > 0);
      assert(profile.normalizationVersion.length > 0);
      assert(profile.maxOutputTokens > 0);
    }
  }
  assert.equal(manifest.timeline.apple.inputVersion, "e9-submission-actions");
  assert.equal(manifest.hour.apple.inputVersion, "h2-semantic-link-candidates");
  assert.equal(manifest.day.apple.inputVersion, "d3-semantic-link-candidates");
});

test("keeps production task definitions immutable", () => {
  assert(Object.isFrozen(TIMELINE_TASK));
  assert(Object.isFrozen(TIMELINE_TASK.apple));
  assert(Object.isFrozen(HOUR_TASK.cloud));
  assert(Object.isFrozen(DAY_TASK.apple));
});
