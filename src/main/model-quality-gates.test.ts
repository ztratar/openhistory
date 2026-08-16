import assert from "node:assert/strict";
import test from "node:test";
import {
  assertModelQualityPreserved,
  evaluateModelQuality,
  ModelQualityMetricsSchema,
  type ModelQualityMetrics
} from "./inference/quality-gates";

function metrics(overrides: Partial<ModelQualityMetrics> = {}): ModelQualityMetrics {
  return {
    version: 1,
    generatedAt: "2026-01-12T00:00:00.000Z",
    taskManifest: {},
    environment: { provider: "apple", model: "system-default", platform: "synthetic" },
    cases: { history: 40, hour: 8, day: 2 },
    structuredGeneration: { passed: 50, total: 50 },
    presentationContract: { passed: 50, total: 50 },
    latencyMilliseconds: { p50: 4_000, p95: 8_000 },
    pairwise: { reviewed: 20, appleWins: 8, baselineWins: 4, ties: 8 },
    issueCounts: {},
    ...overrides
  };
}

test("accepts a quality- and latency-preserving candidate", () => {
  const baseline = metrics();
  const candidate = metrics({ latencyMilliseconds: { p50: 4_100, p95: 8_900 } });
  assert.equal(evaluateModelQuality(candidate, baseline).preserved, true);
  assert.doesNotThrow(() => assertModelQualityPreserved(candidate, baseline));
});

test("rejects material success, quality, issue, and latency regressions", () => {
  const baseline = metrics();
  const candidate = metrics({
    structuredGeneration: { passed: 42, total: 50 },
    presentationContract: { passed: 40, total: 50 },
    latencyMilliseconds: { p50: 5_000, p95: 10_000 },
    pairwise: { reviewed: 20, appleWins: 2, baselineWins: 16, ties: 2 },
    issueCounts: { unsupported_claim: 3 }
  });
  const result = evaluateModelQuality(candidate, baseline);
  assert.equal(result.preserved, false);
  assert.match(result.failures.join("\n"), /structured generation/);
  assert.match(result.failures.join("\n"), /presentation contract/);
  assert.match(result.failures.join("\n"), /pairwise/);
  assert.match(result.failures.join("\n"), /p95 latency/);
  assert.match(result.failures.join("\n"), /unsupported_claim/);
});

test("requires reliability, presentation, quality, and calibration for opt-in readiness", () => {
  assert.equal(evaluateModelQuality(metrics()).readyForOptIn, true);
  assert.equal(evaluateModelQuality(metrics({ issueCounts: { overstated_status: 1 } })).readyForOptIn, false);
});

test("rejects undersized candidates against a representative baseline", () => {
  const result = evaluateModelQuality(metrics({
    cases: { history: 1, hour: 0, day: 0 },
    structuredGeneration: { passed: 1, total: 1 },
    presentationContract: { passed: 1, total: 1 },
    pairwise: { reviewed: 1, appleWins: 0, baselineWins: 0, ties: 1 }
  }), metrics());
  assert.equal(result.preserved, false);
  assert.equal(result.readyForOptIn, false);
  assert.match(result.failures.join("\n"), /history coverage/);
  assert.match(result.failures.join("\n"), /pairwise review coverage/);
});

test("validates metric totals against task and review counts", () => {
  assert.throws(() => ModelQualityMetricsSchema.parse(metrics({
    structuredGeneration: { passed: 49, total: 49 },
    pairwise: { reviewed: 20, appleWins: 1, baselineWins: 1, ties: 1 }
  })), /sum of task cases|Apple wins/);
});
