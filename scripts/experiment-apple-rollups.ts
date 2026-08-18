import { config as loadDotEnv } from "dotenv";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DailyRollupItem, HourItem, TimelineItem } from "../src/shared/contracts";
import { targetTokenF1 } from "../src/main/apple-adapter-evaluation";
import { DailyRollupDraftSchema, DailyRollupItemSchema, type DailyRollupDraft } from "../src/main/daily-rollup-schema";
import { HourDraftSchema, HourItemSchema, type HourDraft } from "../src/main/hour-schema";
import {
  APPLE_DAY_INSTRUCTIONS,
  APPLE_HOUR_INSTRUCTIONS,
  buildDailyRollupGenerationRequest,
  buildHourGenerationRequest,
  unrolledTimelineItems,
  InferenceService
} from "../src/main/openai-service";
import { createInferenceProvider, type StructuredGenerationRequest } from "../src/main/inference-provider";
import { appleSemanticDailyRollupPrompt, appleSemanticHourPrompt } from "../src/main/inference/inputs";
import { ensureAppleDayCoverage, ensureAppleHourCoverage } from "../src/main/inference/rollup-coverage";
import { TimelineItemSchema } from "../src/main/timeline-schema";
import { defaultOpenHistoryDataDirectory } from "./lib/data-directory";
import { privateExperimentCheckpointPath } from "./lib/private-checkpoint-path";

type Kind = "hour" | "day";
type Draft = HourDraft | DailyRollupDraft;
type Variant = "current" | "coverage" | "budgeted" | "hybrid" | "production";
interface Result {
  id: string;
  kind: Kind;
  variant: Variant;
  target: Draft;
  generated?: Draft;
  evidence: string;
  latencyMilliseconds: number;
  error?: string;
}

const HOUR_COVERAGE_INSTRUCTIONS = `${APPLE_HOUR_INSTRUCTIONS}

Privately group the current-hour entries into distinct substantial workstreams before writing. Use one bullet per retained workstream, up to four. When the evidence contains two or more distinct substantial workstreams, use at least two bullets; use one bullet only when there is genuinely one useful fact. Keep each bullet to roughly 10–28 words. Every claim in the title must also be supported by a summary bullet. Prefer directly supported work, decisions, demonstrated results, and material blockers over incidental navigation or app checks. Return link references only as exact values such as link-1; never put a label or URL in linkReferences.`;

const DAY_COVERAGE_INSTRUCTIONS = `${APPLE_DAY_INSTRUCTIONS}

Privately group the day into its distinct substantial workstreams before writing. Use one bullet per retained workstream, normally two to four and never more than five. Keep each bullet to roughly 12–32 words. Every claim in the title must also be supported by a summary bullet. Preserve the strongest demonstrated result, consequential request or decision, and material unfinished work without upgrading a draft into completion. Return link references only as exact values such as link-1; never put a label or URL in linkReferences.`;

const dataDirectory = resolve(process.argv[2] ?? defaultOpenHistoryDataDirectory());
const reportPath = resolve(process.argv[3] ?? "reports/private/apple-rollup-hill-climb.md");
const hourCount = boundedInteger(process.argv[4], 12, 4, 60);
loadDotEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });

const timeline = TimelineItemSchema.array().parse(readJson("timeline/index.json"));
const timelineById = new Map(timeline.map((item) => [item.id, item]));
const hours = HourItemSchema.array().parse(readJson("hours/index.json"))
  .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
const hourCases = hours.flatMap((target, index) => {
  const entries = target.sourceTimelineIds.flatMap((id) => {
    const item = timelineById.get(id);
    return item ? [item] : [];
  }).sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
  return entries.length ? [{ target, entries, previous: hours[index - 1] }] : [];
});
const selectedHours = evenlySpaced(hourCases, Math.min(hourCount, hourCases.length));
const dailyRollups = DailyRollupItemSchema.array().parse(readJson("daily-rollups/index.json"))
  .sort((left, right) => left.date.localeCompare(right.date));
const dayCases = dailyRollups.flatMap((target) => {
  const entries = target.sourceTimelineIds.flatMap((id) => {
    const item = timelineById.get(id);
    return item ? [item] : [];
  }).sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
  const ids = new Set(entries.map(({ id }) => id));
  const dayHours = hours.filter((hour) => hour.sourceTimelineIds.some((id) => ids.has(id)));
  return entries.length ? [{ target, entries, hours: dayHours }] : [];
});

const provider = createInferenceProvider({ provider: "apple", model: "system-default" });
const productionService = new InferenceService({
  settings: {
    version: 1,
    enabled: true,
    provider: "apple",
    models: { apple: "system-default", openai: "unused", anthropic: "unused", kimi: "unused" }
  }
});
const allVariants: Variant[] = ["current", "coverage", "budgeted", "hybrid", "production"];
const requestedVariants = process.argv[5]?.split(",").map((value) => value.trim()).filter(Boolean) as Variant[] | undefined;
const variants = requestedVariants?.length
  ? allVariants.filter((variant) => requestedVariants.includes(variant))
  : allVariants;
const checkpointPath = privateExperimentCheckpointPath(reportPath);
const signature = `apple-rollup-hill-v1:${selectedHours.map(({ target }) => target.id).join(",")}:${dayCases.map(({ target }) => target.id).join(",")}`;
const results = loadCheckpoint();

for (const variant of variants) {
  for (const [index, sample] of selectedHours.entries()) {
    const key = `${variant}:hour:${sample.target.id}`;
    if (!results.has(key)) {
      if (variant === "production") {
        results.set(key, await evaluateProduction(
          "hour",
          variant,
          sample.target.id,
          hourProjection(sample.target),
          hourEvidence(sample.entries),
          async () => hourProjection(await productionService.consolidateHour(
            sample.target.startTime,
            sample.target.endTime,
            sample.entries,
            sample.previous
          ))
        ));
      } else if (variant === "hybrid") {
        const base = results.get(`budgeted:hour:${sample.target.id}`)!;
        results.set(key, {
          ...base,
          variant,
          generated: base.generated ? ensureAppleHourCoverage(base.generated as HourDraft, sample.entries) : undefined,
          latencyMilliseconds: 0
        });
      } else {
        results.set(key, await evaluate(
          "hour",
          variant,
          sample.target.id,
          hourProjection(sample.target),
          hourEvidence(sample.entries),
          hourRequest(variant, sample.entries, sample.previous)
        ));
      }
      saveCheckpoint();
    }
    process.stderr.write(`${variant} hour ${index + 1}/${selectedHours.length}\n`);
  }
  for (const [index, sample] of dayCases.entries()) {
    const key = `${variant}:day:${sample.target.id}`;
    if (!results.has(key)) {
      const unrolled = unrolledTimelineItems(sample.entries, sample.hours);
      if (variant === "production") {
        results.set(key, await evaluateProduction(
          "day",
          variant,
          sample.target.id,
          dayProjection(sample.target),
          dayEvidence(sample.entries),
          async () => dayProjection(await productionService.consolidateDailyRollup(
            sample.target.date,
            sample.entries,
            sample.target,
            sample.hours
          ))
        ));
      } else if (variant === "hybrid") {
        const base = results.get(`budgeted:day:${sample.target.id}`)!;
        results.set(key, {
          ...base,
          variant,
          generated: base.generated
            ? ensureAppleDayCoverage(base.generated as DailyRollupDraft, sample.hours, unrolled, sample.entries)
            : undefined,
          latencyMilliseconds: 0
        });
      } else {
        results.set(key, await evaluate(
          "day",
          variant,
          sample.target.id,
          dayProjection(sample.target),
          dayEvidence(sample.entries),
          dayRequest(variant, sample.target.date, sample.entries, sample.target, sample.hours, unrolled)
        ));
      }
      saveCheckpoint();
    }
    process.stderr.write(`${variant} day ${index + 1}/${dayCases.length}\n`);
  }
}

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, renderReport([...results.values()]), { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${reportPath}\n${checkpointPath}\n`);

async function evaluate(
  kind: Kind,
  variant: Variant,
  id: string,
  target: Draft,
  evidence: string,
  request: StructuredGenerationRequest<Draft>
): Promise<Result> {
  const started = performance.now();
  try {
    let generated: Draft | undefined;
    let error: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        generated = await provider.generate({
          ...request,
          maxOutputTokens: attempt ? Math.min(request.maxOutputTokens * 2, 2_000) : request.maxOutputTokens
        });
        break;
      } catch (caught) {
        error = caught;
      }
    }
    if (!generated) throw error;
    return { id, kind, variant, target, generated, evidence, latencyMilliseconds: performance.now() - started };
  } catch (error) {
    return {
      id,
      kind,
      variant,
      target,
      evidence,
      latencyMilliseconds: performance.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function evaluateProduction(
  kind: Kind,
  variant: Variant,
  id: string,
  target: Draft,
  evidence: string,
  operation: () => Promise<Draft>
): Promise<Result> {
  const started = performance.now();
  try {
    return {
      id,
      kind,
      variant,
      target,
      generated: await operation(),
      evidence,
      latencyMilliseconds: performance.now() - started
    };
  } catch (error) {
    return {
      id,
      kind,
      variant,
      target,
      evidence,
      latencyMilliseconds: performance.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function hourRequest(variant: Variant, entries: TimelineItem[], previous?: HourItem): StructuredGenerationRequest<HourDraft> {
  if (variant === "current") return buildHourGenerationRequest("apple", entries, previous);
  return {
    instructions: HOUR_COVERAGE_INSTRUCTIONS,
    input: variant === "budgeted" ? budgetedHourPrompt(entries, previous) : appleSemanticHourPrompt(entries, previous),
    schema: HourDraftSchema,
    schemaName: "hour_rollup_compact",
    maxOutputTokens: 650
  };
}

function dayRequest(
  variant: Variant,
  date: string,
  entries: TimelineItem[],
  existing: DailyRollupItem,
  dayHours: HourItem[],
  unrolled: TimelineItem[]
): StructuredGenerationRequest<DailyRollupDraft> {
  if (variant === "current") {
    return buildDailyRollupGenerationRequest("apple", date, entries, existing, dayHours, unrolled);
  }
  return {
    instructions: DAY_COVERAGE_INSTRUCTIONS,
    input: variant === "budgeted"
      ? budgetedDayPrompt(dayHours, unrolled, existing)
      : appleSemanticDailyRollupPrompt(dayHours, unrolled, existing),
    schema: DailyRollupDraftSchema,
    schemaName: "daily_rollup_compact",
    maxOutputTokens: 750
  };
}

function budgetedHourPrompt(entries: TimelineItem[], previous?: HourItem): string {
  const perEntry = Math.max(180, Math.min(520, Math.floor(5_600 / entries.length)));
  const facts = entries.map((item, index) => `${index + 1}. ${item.title}\n${truncate(item.description, perEntry)}`).join("\n\n");
  return `Summarize only the current hour. It contains ${entries.length} factual source entries. Group related entries, but keep each distinct substantial workstream in its own bullet. Do not infer completion beyond the wording supplied.\n\nPrior hour context only (not evidence):\n${previous ? `${previous.title}: ${singleLine(previous.summary)}` : "none"}\n\nCurrent-hour evidence:\n${facts}`;
}

function budgetedDayPrompt(hoursForDay: HourItem[], unrolled: TimelineItem[], existing?: DailyRollupItem): string {
  const hourBudget = Math.max(220, Math.min(520, Math.floor(6_000 / Math.max(1, hoursForDay.length))));
  const hourFacts = hoursForDay.map((hour, index) =>
    `${index + 1}. ${hour.title}\n${truncate(singleLine(hour.summary), hourBudget)}`
  ).join("\n\n");
  const sessionFacts = unrolled.map((item, index) =>
    `${index + 1}. ${item.title}\n${truncate(item.description, 320)}`
  ).join("\n\n");
  return `Summarize the local day by substantial workstream. It contains ${hoursForDay.length} hour rollups and ${unrolled.length} additional sessions. Preserve demonstrated results, consequential requests or decisions, and material unfinished work. Do not infer completion beyond the supplied wording.\n\nPrior draft context only (not evidence):\n${existing ? `${existing.title}: ${truncate(singleLine(existing.summary), 500)}` : "none"}\n\nCurrent hour evidence:\n${hourFacts || "none"}\n\nAdditional current sessions:\n${sessionFacts || "none"}`.slice(0, 8_200);
}

function renderReport(all: Result[]): string {
  const sections = variants.map((variant) => {
    const rows = (["hour", "day"] as const).map((kind) => metricRow(kind, all.filter((result) => result.variant === variant && result.kind === kind)));
    const currentById = new Map(all.filter((result) => result.variant === "current").map((result) => [`${result.kind}:${result.id}`, result]));
    const comparisons = variant === "current" ? undefined : compare(
      all.filter((result) => result.variant === variant),
      currentById
    );
    return `## ${variant}\n\n| Kind | Successful | Structure | Mean words | Target words | Target token F1 | Evidence grounding | Composite |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n${comparisons ? `\nCompared with current across jointly successful cases: ${comparisons.wins} wins, ${comparisons.losses} losses, ${comparisons.ties} ties.` : ""}`;
  }).join("\n\n");
  const failures = all.flatMap((result) => result.error ? [`- ${result.variant} ${result.kind} ${result.id}: ${result.error}`] : []);
  return `# Apple local rollup hill climb\n\nGenerated ${new Date().toISOString()}. All source evidence, stored OpenAI reference summaries, Apple outputs, and scoring remained local. OpenAI references are treated as useful targets, not ground truth.\n\n- ${selectedHours.length} evenly spaced source-backed hours and ${dayCases.length} source-backed days\n- Variants: original production path, stronger coverage contract, bounded evidence, deterministic coverage simulation, and the final integrated production path\n- Composite = 50% token F1 to the stored OpenAI rollup, 25% candidate-token grounding in source timeline text, 15% length similarity, and 10% presentation structure\n\n${sections}\n\n## Failures\n\n${failures.join("\n") || "- None"}\n`;
}

function metricRow(kind: Kind, values: Result[]): string {
  const successful = values.filter((value) => value.generated);
  const scores = successful.map(score);
  return `| ${kind} | ${successful.length}/${values.length} | ${scores.filter(({ structure }) => structure).length}/${values.length} | ${mean(scores.map(({ candidateWords }) => candidateWords)).toFixed(1)} | ${mean(scores.map(({ targetWords }) => targetWords)).toFixed(1)} | ${percent(mean(scores.map(({ f1 }) => f1)))} | ${percent(mean(scores.map(({ grounding }) => grounding)))} | ${percent(mean(scores.map(({ composite }) => composite)))} |`;
}

function compare(candidate: Result[], currentById: Map<string, Result>): { wins: number; losses: number; ties: number } {
  let wins = 0; let losses = 0; let ties = 0;
  for (const value of candidate) {
    const current = currentById.get(`${value.kind}:${value.id}`);
    if (!value.generated || !current?.generated) continue;
    const difference = score(value).composite - score(current).composite;
    if (difference > 0.01) wins += 1;
    else if (difference < -0.01) losses += 1;
    else ties += 1;
  }
  return { wins, losses, ties };
}

function score(result: Result): {
  f1: number; grounding: number; candidateWords: number; targetWords: number; structure: boolean; composite: number;
} {
  const generated = result.generated!;
  const targetText = narrative(result.target);
  const candidateText = narrative(generated);
  const f1 = targetTokenF1(
    { title: result.target.title, description: result.kind === "hour" ? (result.target as HourDraft).summary : (result.target as DailyRollupDraft).summary },
    { title: generated.title, description: result.kind === "hour" ? (generated as HourDraft).summary : (generated as DailyRollupDraft).summary }
  );
  const candidateTokens = contentTokens(candidateText);
  const evidenceTokens = new Set(contentTokens(result.evidence));
  const grounding = candidateTokens.length
    ? candidateTokens.filter((token) => evidenceTokens.has(token)).length / candidateTokens.length
    : 0;
  const candidateWords = words(summary(generated));
  const targetWords = words(summary(result.target));
  const ratio = targetWords ? candidateWords / targetWords : 0;
  const lengthSimilarity = ratio ? Math.min(ratio / 0.7, 0.7 / ratio, 1) : 0;
  const titleWords = words(generated.title);
  const bulletCount = summary(generated).split("\n").filter(Boolean).length;
  const structure = titleWords >= 4 && titleWords <= 10 && bulletCount >= (result.kind === "day" ? 2 : 1) && bulletCount <= (result.kind === "day" ? 5 : 4);
  return { f1, grounding, candidateWords, targetWords, structure, composite: 0.5 * f1 + 0.25 * grounding + 0.15 * lengthSimilarity + 0.1 * Number(structure) };
}

function hourProjection(item: HourItem): HourDraft {
  return { title: item.title, summary: item.summary, workThreads: item.workThreads, decisions: item.decisions, outcomes: item.outcomes, blockers: item.blockers, surfaces: item.surfaces, linkReferences: [] };
}
function dayProjection(item: DailyRollupItem): DailyRollupDraft {
  return { title: item.title, summary: item.summary, themes: item.themes, accomplishments: item.accomplishments, decisions: item.decisions, unfinishedWork: item.unfinishedWork, recurringPatterns: item.recurringPatterns, linkReferences: [] };
}
function hourEvidence(entries: TimelineItem[]): string { return entries.map((item) => `${item.title} ${item.description} ${item.decisions.join(" ")} ${item.outcomes.join(" ")} ${item.blockers.join(" ")}`).join("\n"); }
function dayEvidence(entries: TimelineItem[]): string { return hourEvidence(entries); }
function summary(item: Draft): string { return item.summary; }
function narrative(item: Draft): string { return `${item.title} ${item.summary}`; }
function words(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }
function contentTokens(value: string): string[] { return value.toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? []; }
function singleLine(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function truncate(value: string, maximum: number): string { return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`; }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function percent(value: number): string { return `${(100 * value).toFixed(1)}%`; }
function readJson(path: string): unknown { return JSON.parse(readFileSync(resolve(dataDirectory, path), "utf8")); }
function evenlySpaced<T>(values: T[], count: number): T[] {
  if (count >= values.length) return [...values];
  if (count <= 1) return values.length ? [values[Math.floor(values.length / 2)]!] : [];
  return Array.from({ length: count }, (_value, index) => values[Math.round((index * (values.length - 1)) / (count - 1))]!);
}
function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
function loadCheckpoint(): Map<string, Result> {
  if (!existsSync(checkpointPath)) return new Map();
  try {
    const value = JSON.parse(readFileSync(checkpointPath, "utf8")) as { signature?: string; results?: Result[] };
    return value.signature === signature ? new Map((value.results ?? []).map((result) => [`${result.variant}:${result.kind}:${result.id}`, result])) : new Map();
  } catch { return new Map(); }
}
function saveCheckpoint(): void {
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(checkpointPath, `${JSON.stringify({ signature, results: [...results.values()] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(checkpointPath, 0o600);
}
