import assert from "node:assert/strict";
import test from "node:test";
import { nextLocalInferenceConnection } from "./local-inference-connection";

test("local connection status preserves when an outage began and when the server last connected", () => {
  const connected = nextLocalInferenceConnection(undefined, {
    ok: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    models: ["model-a", "model-b"]
  }, "2026-10-26T12:00:00.000Z");
  assert.deepEqual(connected, {
    reachable: true,
    checkedAt: "2026-10-26T12:00:00.000Z",
    lastConnectedAt: "2026-10-26T12:00:00.000Z",
    modelCount: 2
  });

  const failed = nextLocalInferenceConnection(connected, {
    ok: false,
    models: [],
    error: "OpenHistory could not reach the server."
  }, "2026-10-26T12:01:00.000Z");
  assert.equal(failed.unreachableSince, "2026-10-26T12:01:00.000Z");
  assert.equal(failed.lastConnectedAt, connected.lastConnectedAt);

  const failedAgain = nextLocalInferenceConnection(failed, {
    ok: false,
    models: [],
    error: "Still unavailable"
  }, "2026-10-26T12:02:00.000Z");
  assert.equal(failedAgain.unreachableSince, failed.unreachableSince);
  assert.equal(failedAgain.checkedAt, "2026-10-26T12:02:00.000Z");

  const recovered = nextLocalInferenceConnection(failedAgain, {
    ok: true,
    models: ["model-a"]
  }, "2026-10-26T12:03:00.000Z");
  assert.equal(recovered.reachable, true);
  assert.equal(recovered.unreachableSince, undefined);
  assert.equal(recovered.lastConnectedAt, "2026-10-26T12:03:00.000Z");
});
