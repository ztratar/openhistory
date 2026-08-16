import assert from "node:assert/strict";
import test from "node:test";
import {
  appleAdapterEvaluationMetrics,
  compareAppleAdapterResults,
  targetTokenF1,
  type AppleAdapterEvaluationResult
} from "./apple-adapter-evaluation";

test("computes target token similarity without rewarding repeated tokens", () => {
  const target = { title: "Drafted adapter export", description: "Prepared private training data." };
  assert.equal(targetTokenF1(target, target), 1);
  assert(targetTokenF1(target, {
    title: "Drafted drafted drafted drafted",
    description: "Unrelated text."
  }) < 0.4);
});

test("aggregates reliability, structure, similarity, and latency", () => {
  const results: AppleAdapterEvaluationResult[] = [
    result("one", "Drafted a private adapter export", "Prepared private training data.", 100),
    result("two", "Short", "Prepared private training data.", 300),
    { id: "three", target: target(), latencyMilliseconds: 500, error: "synthetic" }
  ];
  const metrics = appleAdapterEvaluationMetrics(results);
  assert.deepEqual(metrics, {
    total: 3,
    succeeded: 2,
    structurePassed: 1,
    exactTitles: 0,
    meanTargetTokenF1: metrics.meanTargetTokenF1,
    latencyP50: 300,
    latencyP95: 300
  });
  assert(metrics.meanTargetTokenF1 > 0.3);
});

test("compares base and adapter only when both generations succeeded", () => {
  const base = [result("one", "Drafted generic local output", "Made a generic summary.", 100)];
  const adapter = [result("one", target().title, target().description, 110)];
  assert.deepEqual(compareAppleAdapterResults(base, adapter), {
    adapterWins: 1,
    baseWins: 0,
    ties: 0,
    compared: 1
  });
});

function target(): { title: string; description: string } {
  return { title: "Prepared private adapter dataset", description: "Exported training and evaluation pairs." };
}

function result(
  id: string,
  title: string,
  description: string,
  latencyMilliseconds: number
): AppleAdapterEvaluationResult {
  return { id, target: target(), generated: { title, description }, latencyMilliseconds };
}
