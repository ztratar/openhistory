import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import type { ActivityEpisode, ActivityEvent, ApplicationDescriptor, TimelineItem } from "../src/shared/contracts";
import { defaultOpenHistoryDataDirectory } from "./lib/data-directory";
import {
  appleAdapterEvaluationMetrics,
  compareAppleAdapterResults,
  type AppleAdapterEvaluationResult
} from "../src/main/apple-adapter-evaluation";
import { loadActivityEvents } from "../src/main/activity-event-file";
import { segmentActivityEvents } from "../src/main/episode-segmenter";
import { InferenceService } from "../src/main/inference/service";
import { findFoundationModelExecutable } from "../src/main/inference/provider";
import {
  AppleFoundationModelProvider,
  runAppleWorker
} from "../src/main/inference/providers/apple";
import { TimelineItemSchema } from "../src/main/timeline-schema";

interface PilotManifest {
  generatedAt: string;
  train: { count: number; sha256: string };
  eval: { count: number; sha256: string; ids: string[] };
  counts: Record<string, number>;
  labels: { humanReviewed: boolean; providerRecordedPerItem: boolean };
}

interface TrainingSummary {
  durationSeconds: number;
  hyperparameters: { epochs: number; learningRate: string; batchSize: number };
  checkpoint: { name: string; bytes: number };
  adapter: { name: string; bytes: number; sha256: string };
}

const dataDirectory = resolve(process.argv[2] ?? defaultOpenHistoryDataDirectory());
const pilotDirectory = resolve(process.argv[3] ?? "reports/private/apple-adapter-pilot");
const adapterArgument = process.argv[4]?.trim();
const adapterPath = adapterArgument && adapterArgument !== "-" ? resolve(adapterArgument) : undefined;
const reportPath = resolve(process.argv[5] ?? resolve(pilotDirectory, "report.md"));
const manifest = JSON.parse(readFileSync(resolve(pilotDirectory, "manifest.json"), "utf8")) as PilotManifest;
const timeline = TimelineItemSchema.array().parse(JSON.parse(
  readFileSync(resolve(dataDirectory, "timeline", "index.json"), "utf8")
));
const timelineById = new Map(timeline.map((item) => [item.id, item]));
const captureEmailActivity = storedCaptureEmailActivity();
const sourceEvents = loadActivityEvents(dataDirectory, undefined, { captureEmailActivity });
const sourceEventsById = new Map(sourceEvents.map((event) => [event.id, event]));
const episodesById = new Map(segmentActivityEvents(sourceEvents, { captureEmailActivity })
  .map((episode) => [episode.id, episode]));
const cases = manifest.eval.ids.map((id) => {
  const item = timelineById.get(id);
  if (!item) throw new Error(`Eval item ${id} is no longer present in the timeline.`);
  const episode = episodesById.get(id) ?? reconstructEpisode(item, sourceEventsById);
  if (!episode) throw new Error(`Eval item ${id} no longer has complete source evidence.`);
  return { item, episode };
});
const executable = findFoundationModelExecutable();
if (!executable) throw new Error("Build the Foundation Models worker before running the adapter pilot.");

const baseResultsPath = resolve(pilotDirectory, "base-results.json");
const adapterResultsPath = resolve(
  pilotDirectory,
  adapterPath ? `adapter-results-${artifactSha256(adapterPath).slice(0, 16)}.json` : "adapter-results.json"
);
const baseResults = await evaluate("base", undefined, baseResultsPath);
const adapterResults = adapterPath
  ? await evaluate("adapter", adapterPath, adapterResultsPath)
  : undefined;
const baseMetrics = appleAdapterEvaluationMetrics(baseResults);
const adapterMetrics = adapterResults ? appleAdapterEvaluationMetrics(adapterResults) : undefined;
const comparison = adapterResults ? compareAppleAdapterResults(baseResults, adapterResults) : undefined;

writeFileSync(reportPath, renderReport(), { encoding: "utf8" });
process.stdout.write(`${reportPath}\n`);

async function evaluate(
  label: string,
  configuredAdapterPath: string | undefined,
  checkpointPath: string
): Promise<AppleAdapterEvaluationResult[]> {
  const prior = loadResults(checkpointPath);
  const results = new Map(prior.map((result) => [result.id, result]));
  const settings = {
    version: 1 as const,
    enabled: true,
    provider: "apple" as const,
    models: { apple: "system-default", openai: "unused", anthropic: "unused", kimi: "unused" }
  };
  const provider = new AppleFoundationModelProvider(
    "system-default",
    executable,
    runAppleWorker,
    configuredAdapterPath
  );
  const service = new InferenceService({ settings, adapter: provider });
  for (const [index, entry] of cases.entries()) {
    if (results.get(entry.item.id)?.generated) continue;
    const started = performance.now();
    let result: AppleAdapterEvaluationResult;
    try {
      const generated = await service.summarizeEpisode(entry.episode, { captureEmailActivity });
      result = {
        id: entry.item.id,
        target: target(entry.item),
        generated: target(generated),
        latencyMilliseconds: performance.now() - started
      };
    } catch (error) {
      result = {
        id: entry.item.id,
        target: target(entry.item),
        latencyMilliseconds: performance.now() - started,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    results.set(result.id, result);
    writePrivateResults(checkpointPath, manifest.eval.ids.flatMap((id) => {
      const stored = results.get(id);
      return stored ? [stored] : [];
    }));
    process.stderr.write(`${label} ${index + 1}/${cases.length}\n`);
  }
  return manifest.eval.ids.map((id) => results.get(id)!).filter(Boolean);
}

function renderReport(): string {
  const row = (label: string, metrics: ReturnType<typeof appleAdapterEvaluationMetrics> | undefined) => metrics
    ? `| ${label} | ${metrics.succeeded}/${metrics.total} | ${metrics.structurePassed}/${metrics.total} | ${percent(metrics.meanTargetTokenF1)} | ${metrics.exactTitles}/${metrics.total} | ${Math.round(metrics.latencyP50)} ms | ${Math.round(metrics.latencyP95)} ms |`
    : `| ${label} | Not run | Not run | Not run | Not run | Not run | Not run |`;
  const trainingSummary = loadTrainingSummary();
  const adapterFailures = adapterResults ? failureSummary(adapterResults) : undefined;
  const adapterStatus = adapterPath && trainingSummary
    ? `Training completed in ${trainingSummary.durationSeconds} seconds using ${trainingSummary.hyperparameters.epochs} ${trainingSummary.hyperparameters.epochs === 1 ? "epoch" : "epochs"}, learning rate ${trainingSummary.hyperparameters.learningRate}, and batch size ${trainingSummary.hyperparameters.batchSize}. Packaged \`${trainingSummary.adapter.name}\` is ${Math.round(trainingSummary.adapter.bytes / 1_048_576)} MiB with SHA-256 \`${trainingSummary.adapter.sha256}\`.`
    : adapterPath
      ? `Loaded pilot adapter from a private local artifact (${Math.round(artifactBytes(adapterPath) / 1_048_576)} MiB).`
    : "Adapter training and adapted-model evaluation have not run yet. Apple currently gates the member-only toolkit download behind account-holder acceptance of its Foundation Models Adapter Training Toolkit license agreement.";
  return `# Apple Foundation Models adapter pilot\n\nGenerated ${new Date().toISOString()}. This report contains aggregate measurements only; private prompts, labels, and generations remain under the ignored \`reports/private/\` directory.\n\n## Objective\n\nValidate the complete 100-train/27-eval workflow for OpenHistory's compact Apple timeline summarization task: deterministic export, LoRA training, \`.fmadapter\` packaging, worker loading, and base-versus-adapter evaluation. This is a plumbing pilot, not a production-quality claim.\n\n## Dataset\n\n- Training examples: ${manifest.train.count}\n- Evaluation examples: ${manifest.eval.count}\n- Eligible stored timeline examples: ${manifest.counts.eligible}\n- Train SHA-256: \`${manifest.train.sha256}\`\n- Eval SHA-256: \`${manifest.eval.sha256}\`\n- Targets are stored model-generated timeline summaries. Human reviewed: ${manifest.labels.humanReviewed ? "yes" : "no"}; per-item provider recorded: ${manifest.labels.providerRecordedPerItem ? "yes" : "no"}.\n- The source corpus spans only two local days, so train/eval workflow similarity remains a material leakage risk.\n\n## Training and packaging\n\n${adapterStatus}\n\n## Evaluation\n\nTarget token F1 is a deterministic lexical comparison with the stored target, not a semantic or human quality score. Exact-title and structure checks are diagnostic only.\n\n| Model | Successful | Structure pass | Mean target token F1 | Exact titles | P50 latency | P95 latency |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${row("Base Apple model", baseMetrics)}\n${row("LoRA adapter", adapterMetrics)}\n\n${comparison ? `Pairwise target-similarity result across ${comparison.compared} jointly successful cases: adapter ${comparison.adapterWins} wins, base ${comparison.baseWins} wins, ${comparison.ties} ties (tie margin 0.01).` : "Base-versus-adapter comparison is pending a packaged adapter."}${adapterFailures ? `\n\n${adapterFailures}` : ""}\n\n## Interpretation\n\n- Packaging and worker loading ${adapterPath ? "completed" : "remain pending"}; adapted inference reliability was ${adapterMetrics ? `${adapterMetrics.succeeded}/${adapterMetrics.total}` : "not measured"}.\n- A useful follow-up dataset needs human-corrected targets and whole-day held-out evaluation across substantially more days.\n- Apple adapters are tied to a specific system-model version and must be retrained for new compatible model releases.\n`;
}

function loadTrainingSummary(): TrainingSummary | undefined {
  const path = resolve(pilotDirectory, "training", "training-summary.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as TrainingSummary;
}

function target(item: TimelineItem): Pick<TimelineItem, "title" | "description"> {
  return { title: item.title, description: item.description };
}

function loadResults(path: string): AppleAdapterEvaluationResult[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as AppleAdapterEvaluationResult[];
}

function writePrivateResults(path: string, results: AppleAdapterEvaluationResult[]): void {
  writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function reconstructEpisode(
  item: TimelineItem,
  eventsById: Map<string, ActivityEvent>
): ActivityEpisode | undefined {
  if (!item.sourceEventIds?.length) return undefined;
  const events = item.sourceEventIds.map((id) => eventsById.get(id));
  if (events.some((event) => !event)) return undefined;
  const recovered = events as ActivityEvent[];
  const applications = new Map<string, ApplicationDescriptor>();
  for (const event of recovered) {
    if (!event.application) continue;
    const key = event.application.bundleIdentifier ?? `pid:${event.application.processIdentifier}`;
    applications.set(key, event.application);
  }
  return {
    id: item.id,
    startTime: item.startTime,
    endTime: item.endTime,
    events: recovered,
    applications: [...applications.values()]
  };
}

function storedCaptureEmailActivity(): boolean {
  try {
    return (JSON.parse(readFileSync(resolve(dataDirectory, "settings.json"), "utf8")) as {
      captureEmailActivity?: unknown;
    }).captureEmailActivity === true;
  } catch {
    return false;
  }
}

function percent(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

function artifactBytes(path: string): number {
  if (statSync(path).isFile()) return statSync(path).size;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory() || entry.isFile()) return total + artifactBytes(child);
    throw new Error(`Unsupported artifact entry: ${child}`);
  }, 0);
}

function artifactSha256(path: string): string {
  const hash = createHash("sha256");
  for (const file of artifactFiles(path)) {
    hash.update(relative(path, file) || basename(file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function artifactFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) return artifactFiles(child);
      if (entry.isFile()) return [child];
      throw new Error(`Unsupported artifact entry: ${child}`);
    });
}

function failureSummary(results: AppleAdapterEvaluationResult[]): string | undefined {
  const failures = results.filter(({ generated }) => !generated);
  if (!failures.length) return undefined;
  const decoding = failures.filter(({ error }) => /decodingFailure|Failed to extract content/i.test(error ?? "")).length;
  const remaining = failures.length - decoding;
  const parts = [
    ...(decoding ? [`${decoding} structured-output decoding ${decoding === 1 ? "failure" : "failures"}`] : []),
    ...(remaining ? [`${remaining} other inference ${remaining === 1 ? "failure" : "failures"}`] : [])
  ];
  return `Adapted-model failures: ${parts.join("; ")}.`;
}
