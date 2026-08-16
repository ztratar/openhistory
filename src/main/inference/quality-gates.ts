import assert from "node:assert/strict";
import { z } from "zod";

const CountSchema = z.object({ passed: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
  .refine(({ passed, total }) => passed <= total, "passed cannot exceed total");
export const ModelQualityMetricsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  taskManifest: z.record(z.string(), z.unknown()),
  environment: z.object({ provider: z.string(), model: z.string(), platform: z.string() }),
  cases: z.object({ history: z.number().int().nonnegative(), hour: z.number().int().nonnegative(), day: z.number().int().nonnegative() }),
  structuredGeneration: CountSchema,
  presentationContract: CountSchema,
  latencyMilliseconds: z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() }),
  pairwise: z.object({
    reviewed: z.number().int().nonnegative(),
    appleWins: z.number().int().nonnegative(),
    baselineWins: z.number().int().nonnegative(),
    ties: z.number().int().nonnegative()
  }),
  issueCounts: z.record(z.string(), z.number().int().nonnegative())
}).strict().superRefine((metrics, context) => {
  const generationCases = metrics.cases.history + metrics.cases.hour + metrics.cases.day;
  if (metrics.structuredGeneration.total !== generationCases) {
    context.addIssue({ code: "custom", path: ["structuredGeneration", "total"], message: "must equal the sum of task cases" });
  }
  if (metrics.presentationContract.total !== generationCases) {
    context.addIssue({ code: "custom", path: ["presentationContract", "total"], message: "must equal the sum of task cases" });
  }
  const reviewedOutcomes = metrics.pairwise.appleWins + metrics.pairwise.baselineWins + metrics.pairwise.ties;
  if (metrics.pairwise.reviewed !== reviewedOutcomes) {
    context.addIssue({ code: "custom", path: ["pairwise", "reviewed"], message: "must equal Apple wins, baseline wins, and ties" });
  }
});
export type ModelQualityMetrics = z.infer<typeof ModelQualityMetricsSchema>;

export const MIN_OPT_IN_GENERATION_CASES = 50;
export const MIN_OPT_IN_REVIEWED_CASES = 20;

export interface ModelQualityGateResult {
  preserved: boolean;
  readyForOptIn: boolean;
  failures: string[];
}

export function evaluateModelQuality(
  candidate: ModelQualityMetrics,
  baseline?: ModelQualityMetrics
): ModelQualityGateResult {
  candidate = ModelQualityMetricsSchema.parse(candidate);
  baseline = baseline ? ModelQualityMetricsSchema.parse(baseline) : undefined;
  const failures: string[] = [];
  const structuredRate = rate(candidate.structuredGeneration);
  const presentationRate = rate(candidate.presentationContract);
  const reviewedRate = pairwiseWinOrTieRate(candidate);
  const readyForOptIn = structuredRate >= 0.95
    && presentationRate >= 0.95
    && candidate.structuredGeneration.total >= MIN_OPT_IN_GENERATION_CASES
    && candidate.presentationContract.total >= MIN_OPT_IN_GENERATION_CASES
    && candidate.pairwise.reviewed >= MIN_OPT_IN_REVIEWED_CASES
    && reviewedRate >= 0.75
    && (candidate.issueCounts.unsupported_claim ?? 0) === 0
    && (candidate.issueCounts.overstated_status ?? 0) === 0;

  if (baseline) {
    compareEnvironment(candidate, baseline, failures);
    compareCoverage(candidate, baseline, failures);
    compareFloor("structured generation", structuredRate, rate(baseline.structuredGeneration), 0.01, failures);
    compareFloor("presentation contract", presentationRate, rate(baseline.presentationContract), 0.01, failures);
    if (baseline.pairwise.reviewed > 0) {
      compareFloor("pairwise Apple win-or-tie", reviewedRate, pairwiseWinOrTieRate(baseline), 0.05, failures);
    }
    const latencyCeiling = baseline.latencyMilliseconds.p95 * 1.15 + 50;
    if (candidate.latencyMilliseconds.p95 > latencyCeiling) {
      failures.push(`p95 latency increased from ${Math.round(baseline.latencyMilliseconds.p95)} ms to ${Math.round(candidate.latencyMilliseconds.p95)} ms`);
    }
    for (const issue of ["unsupported_claim", "overstated_status", "missed_material_work"]) {
      const baselineRate = issueRate(baseline, issue);
      const candidateRate = issueRate(candidate, issue);
      const allowance = Math.max(0.05, baselineRate * 0.1);
      if (candidateRate > baselineRate + allowance) {
        failures.push(`${issue} increased from ${percentage(baselineRate)} to ${percentage(candidateRate)} of reviews`);
      }
    }
  }

  return { preserved: failures.length === 0, readyForOptIn, failures };
}

export function assertModelQualityPreserved(
  candidate: ModelQualityMetrics,
  baseline: ModelQualityMetrics
): void {
  const result = evaluateModelQuality(candidate, baseline);
  assert(result.preserved, `Model quality regression:\n${result.failures.map((value) => `- ${value}`).join("\n")}`);
}

function rate(value: { passed: number; total: number }): number {
  return value.total ? value.passed / value.total : 0;
}

function pairwiseWinOrTieRate(metrics: ModelQualityMetrics): number {
  return metrics.pairwise.reviewed
    ? (metrics.pairwise.appleWins + metrics.pairwise.ties) / metrics.pairwise.reviewed
    : 0;
}

function issueRate(metrics: ModelQualityMetrics, issue: string): number {
  return metrics.pairwise.reviewed ? (metrics.issueCounts[issue] ?? 0) / metrics.pairwise.reviewed : 0;
}

function compareEnvironment(candidate: ModelQualityMetrics, baseline: ModelQualityMetrics, failures: string[]): void {
  for (const field of ["provider", "model", "platform"] as const) {
    if (candidate.environment[field] !== baseline.environment[field]) {
      failures.push(`${field} changed from ${baseline.environment[field]} to ${candidate.environment[field]}`);
    }
  }
}

function compareCoverage(candidate: ModelQualityMetrics, baseline: ModelQualityMetrics, failures: string[]): void {
  for (const task of ["history", "hour", "day"] as const) {
    if (candidate.cases[task] < baseline.cases[task]) {
      failures.push(`${task} coverage fell from ${baseline.cases[task]} to ${candidate.cases[task]} cases`);
    }
  }
  if (candidate.pairwise.reviewed < baseline.pairwise.reviewed) {
    failures.push(`pairwise review coverage fell from ${baseline.pairwise.reviewed} to ${candidate.pairwise.reviewed} cases`);
  }
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function compareFloor(
  label: string,
  candidate: number,
  baseline: number,
  tolerance: number,
  failures: string[]
): void {
  if (candidate + tolerance < baseline) {
    failures.push(`${label} fell from ${Math.round(baseline * 100)}% to ${Math.round(candidate * 100)}%`);
  }
}
