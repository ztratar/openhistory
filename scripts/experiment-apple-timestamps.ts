import { defaultOpenHistoryDataDirectory } from "./lib/data-directory";
import type { ActivityEpisode } from "../src/shared/contracts";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadActivityEvents } from "../src/main/activity-event-file";
import { segmentActivityEvents } from "../src/main/episode-segmenter";
import { createInferenceProvider, probeAppleFoundationModel } from "../src/main/inference-provider";
import { buildEpisodeEvidencePacket, renderEpisodeEvidenceBrief } from "../src/main/episode-evidence";
import { APPLE_TIMELINE_INSTRUCTIONS, appleEpisodePrompt } from "../src/main/openai-service";
import { TimelineDraftSchema, TimelineItemSchema, type TimelineDraft } from "../src/main/timeline-schema";

const dataDirectory = process.argv[2] ?? defaultOpenHistoryDataDirectory();
const sampleSize = 12;
const reportPath = process.argv[3] ?? resolve(process.cwd(), "reports/experiments/e1-apple-remove-timestamps-local.md");
const experiment = process.argv[4] === "evidence-packet-v4"
  ? "evidence-packet-v4"
  : process.argv[4] === "evidence-packet-v3"
    ? "evidence-packet-v3"
  : process.argv[4] === "evidence-packet"
    ? "evidence-packet"
    : "timestamps";
const availability = probeAppleFoundationModel();
if (!availability.available) throw new Error(availability.reason ?? "Apple's model is unavailable");
const apple = createInferenceProvider({ provider: "apple", model: "system-default" });
const timeline = TimelineItemSchema.array().parse(JSON.parse(readFileSync(resolve(dataDirectory, "timeline", "index.json"), "utf8")));
const episodes = new Map(segmentActivityEvents(loadActivityEvents(dataDirectory)).map((episode) => [episode.id, episode]));
const eligible = timeline.flatMap((item) => {
  const episode = episodes.get(item.id);
  return episode ? [{ item, episode }] : [];
}).sort((left, right) => Date.parse(left.item.startTime) - Date.parse(right.item.startTime));
const selected = evenlySpaced(eligible, Math.min(sampleSize, eligible.length));
const checkpointPath = "/private/tmp/openhistory-apple-timestamp-experiment.json";
const signature = `apple-${experiment}-v4:${selected.map(({ item }) => item.id).join(",")}`;
const outputs = loadCheckpoint(signature);

for (const [index, { item, episode }] of selected.entries()) {
  if (!outputs[item.id]) {
    outputs[item.id] = {
      baseline: await generate(episode, false),
      candidate: await generate(episode, true)
    };
    saveCheckpoint(signature, outputs);
  }
  console.error(`Generated ${index + 1}/${selected.length}`);
}

const pairs = selected.map(({ item }) => ({ id: item.id, ...outputs[item.id]! }));
const baseline = summarize(pairs.map(({ baseline }) => baseline));
const candidate = summarize(pairs.map(({ candidate }) => candidate));
const examples = pairs.map(({ baseline, candidate }, index) =>
  `| ${index + 1} | ${escapeCell(baseline.title)} | ${escapeCell(candidate.title)} |`
).join("\n");
mkdirSync(dirname(reportPath), { recursive: true });
const candidateName = experiment === "timestamps"
  ? "Timestamp-free"
  : experiment === "evidence-packet-v3" || experiment === "evidence-packet-v4"
    ? "Claim-ceiling EvidencePacket"
    : "EvidencePacket";
const changeDescription = experiment === "timestamps"
  ? "The only input change was removing the line containing the episode's absolute start/end timestamps. Duration, evidence ordering, applications, calibration counts, and observation text were unchanged."
  : experiment === "evidence-packet-v4"
    ? "The candidate ranks explicit success states and substantive edited-content units ahead of incidental clicks or navigation, while retaining the claim ceilings from E3."
    : experiment === "evidence-packet-v3"
    ? "The candidate coalesced fragmented typing into final edited-text snapshots, removed low-value static-text clicks, and supplied an explicit claim ceiling plus safe lead verbs for every work unit."
    : "The candidate replaced event-oriented prose with a deterministic EvidencePacket grouped by work surface, with material actions separated from ambient context and explicit evidence-state boundaries.";
const reportTitle = experiment === "timestamps"
  ? "E1 local Apple timestamp removal"
  : experiment === "evidence-packet-v4"
    ? "E4 local Apple salience-ranked evidence"
    : experiment === "evidence-packet-v3"
    ? "E3 local Apple claim-ceiling evidence"
    : "E2 local Apple action-centered evidence";
writeFileSync(reportPath, `# ${reportTitle}\n\nGenerated ${new Date().toISOString()}. This experiment remained entirely on-device.\n\n${changeDescription}\n\n## Mechanical results\n\n| Measure | Current input | ${candidateName} input |\n| --- | ---: | ---: |\n| Timestamp-like titles | ${baseline.timestampTitles}/${pairs.length} | ${candidate.timestampTitles}/${pairs.length} |\n| Titles satisfying 4–10 words | ${baseline.titleContract}/${pairs.length} | ${candidate.titleContract}/${pairs.length} |\n| Nonempty descriptions | ${baseline.nonemptyDescriptions}/${pairs.length} | ${candidate.nonemptyDescriptions}/${pairs.length} |\n\n## Title pairs\n\n| # | Current Apple input | ${candidateName} Apple input |\n| ---: | --- | --- |\n${examples}\n\nThis report measures the timestamp/title symptom and presentation contract only. It does not claim factual quality without an independent cloud judge.\n`, { encoding: "utf8", mode: 0o600 });
console.log(reportPath);

function generate(episode: ActivityEpisode, removeTimestamp: boolean): Promise<TimelineDraft> {
  const prompt = appleEpisodePrompt(episode);
  return apple.generate({
    instructions: APPLE_TIMELINE_INSTRUCTIONS,
    input: removeTimestamp
      ? experiment === "evidence-packet" || experiment === "evidence-packet-v3" || experiment === "evidence-packet-v4"
        ? renderEpisodeEvidenceBrief(buildEpisodeEvidencePacket(episode))
        : prompt.split("\n").filter((line) => !line.startsWith("Episode: ")).join("\n")
      : prompt,
    schema: TimelineDraftSchema,
    schemaName: "timeline_entry",
    maxOutputTokens: 550
  });
}

function summarize(values: TimelineDraft[]): { timestampTitles: number; titleContract: number; nonemptyDescriptions: number } {
  return {
    timestampTitles: values.filter(({ title }) => /\b\d{4}-\d{2}-\d{2}|\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(title)).length,
    titleContract: values.filter(({ title }) => {
      const words = title.trim().split(/\s+/).length;
      return words >= 4 && words <= 10;
    }).length,
    nonemptyDescriptions: values.filter(({ description }) => description.trim().length > 0).length
  };
}

function evenlySpaced<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return [...items];
  if (count === 1) return [items[Math.floor(items.length / 2)]!];
  return Array.from({ length: count }, (_entry, index) => items[Math.round((index * (items.length - 1)) / (count - 1))]!);
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

interface Pair { baseline: TimelineDraft; candidate: TimelineDraft }

function loadCheckpoint(signature: string): Record<string, Pair> {
  if (!existsSync(checkpointPath)) return {};
  try {
    const value = JSON.parse(readFileSync(checkpointPath, "utf8")) as { signature?: string; outputs?: Record<string, Pair> };
    return value.signature === signature ? value.outputs ?? {} : {};
  } catch {
    return {};
  }
}

function saveCheckpoint(signature: string, value: Record<string, Pair>): void {
  writeFileSync(checkpointPath, `${JSON.stringify({ signature, outputs: value })}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(checkpointPath, 0o600);
}
