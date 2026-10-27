import assert from "node:assert/strict";
import test from "node:test";
import { newestFirstWithOldestProgress } from "./catch-up-priority";

test("prioritizes newest items while reserving one batch slot for old backlog", () => {
  assert.deepEqual(newestFirstWithOldestProgress([1, 2, 3], 8), [3, 2, 1]);
  assert.deepEqual(newestFirstWithOldestProgress([1, 2, 3, 4, 5, 6], 3), [6, 5, 1]);
  assert.deepEqual(newestFirstWithOldestProgress([1, 2], 1), [2]);
  assert.deepEqual(newestFirstWithOldestProgress([], 3), []);
});
