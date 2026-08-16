import type { TimelineItem } from "@shared/contracts";

export interface AppleAdapterEvaluationResult {
  id: string;
  target: Pick<TimelineItem, "title" | "description">;
  generated?: Pick<TimelineItem, "title" | "description">;
  latencyMilliseconds: number;
  error?: string;
}

export interface AppleAdapterEvaluationMetrics {
  total: number;
  succeeded: number;
  structurePassed: number;
  exactTitles: number;
  meanTargetTokenF1: number;
  latencyP50: number;
  latencyP95: number;
}

export function appleAdapterEvaluationMetrics(
  results: AppleAdapterEvaluationResult[]
): AppleAdapterEvaluationMetrics {
  const succeeded = results.filter((result) => result.generated);
  const latencies = succeeded.map(({ latencyMilliseconds }) => latencyMilliseconds).sort((a, b) => a - b);
  const similarities = succeeded.map(({ target, generated }) => targetTokenF1(target, generated!));
  return {
    total: results.length,
    succeeded: succeeded.length,
    structurePassed: succeeded.filter(({ generated }) => timelineNarrativeStructurePass(generated!)).length,
    exactTitles: succeeded.filter(({ target, generated }) => normalize(target.title) === normalize(generated!.title)).length,
    meanTargetTokenF1: mean(similarities),
    latencyP50: percentile(latencies, 0.5),
    latencyP95: percentile(latencies, 0.95)
  };
}

export function compareAppleAdapterResults(
  base: AppleAdapterEvaluationResult[],
  adapter: AppleAdapterEvaluationResult[],
  tieMargin = 0.01
): { adapterWins: number; baseWins: number; ties: number; compared: number } {
  const adapterById = new Map(adapter.map((result) => [result.id, result]));
  let adapterWins = 0;
  let baseWins = 0;
  let ties = 0;
  let compared = 0;
  for (const baseResult of base) {
    const adapterResult = adapterById.get(baseResult.id);
    if (!baseResult.generated || !adapterResult?.generated) continue;
    compared += 1;
    const baseScore = targetTokenF1(baseResult.target, baseResult.generated);
    const adapterScore = targetTokenF1(adapterResult.target, adapterResult.generated);
    if (adapterScore - baseScore > tieMargin) adapterWins += 1;
    else if (baseScore - adapterScore > tieMargin) baseWins += 1;
    else ties += 1;
  }
  return { adapterWins, baseWins, ties, compared };
}

export function targetTokenF1(
  target: Pick<TimelineItem, "title" | "description">,
  candidate: Pick<TimelineItem, "title" | "description">
): number {
  const targetTokens = tokens(`${target.title} ${target.description}`);
  const candidateTokens = tokens(`${candidate.title} ${candidate.description}`);
  if (!targetTokens.length || !candidateTokens.length) return 0;
  const targetCounts = counts(targetTokens);
  const candidateCounts = counts(candidateTokens);
  let overlap = 0;
  for (const [token, count] of targetCounts) overlap += Math.min(count, candidateCounts.get(token) ?? 0);
  const precision = overlap / candidateTokens.length;
  const recall = overlap / targetTokens.length;
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

function timelineNarrativeStructurePass(item: Pick<TimelineItem, "title" | "description">): boolean {
  const titleWords = item.title.trim().split(/\s+/).filter(Boolean).length;
  const sentences = item.description.split(/[.!?]+(?:\s|$)/).filter((value) => value.trim()).length;
  return titleWords >= 4 && titleWords <= 10 && item.title.length <= 120 &&
    item.description.length >= 1 && item.description.length <= 800 && sentences <= 2;
}

function tokens(value: string): string[] {
  return normalize(value).match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
}

function counts(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  return values[Math.round((values.length - 1) * quantile)]!;
}
