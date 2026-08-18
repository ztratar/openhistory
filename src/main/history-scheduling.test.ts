import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATIC_HISTORY_INTERVAL_MS,
  HISTORY_CATCH_UP_DELAY_MS,
  shouldScheduleHistoryCatchUp
} from "./history-scheduling";

test("checks every minute for an episode whose holding window has elapsed", () => {
  assert.equal(AUTOMATIC_HISTORY_INTERVAL_MS, 60 * 1_000);
});

test("quickly follows a productive partial history batch", () => {
  assert.equal(HISTORY_CATCH_UP_DELAY_MS, 15 * 1_000);
  assert.equal(shouldScheduleHistoryCatchUp(
    { timeline: 20, hour: 2, day: 1 },
    { timeline: 12, hour: 0, day: 1 }
  ), true);
});

test("does not loop when pending history made no progress", () => {
  assert.equal(shouldScheduleHistoryCatchUp(
    { timeline: 1, hour: 0, day: 0 },
    { timeline: 1, hour: 0, day: 0 }
  ), false);
});

test("does not schedule catch-up after the queue is drained", () => {
  assert.equal(shouldScheduleHistoryCatchUp(
    { timeline: 8, hour: 1, day: 1 },
    { timeline: 0, hour: 0, day: 0 }
  ), false);
});
