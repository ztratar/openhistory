import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultOpenHistoryDataDirectory } from "./lib/data-directory";
import {
  APPLE_TIMELINE_ADAPTER_DATASET_PROFILE,
  appleAdapterDatasetDigest,
  appleAdapterJsonLine,
  buildAppleTimelineAdapterDataset,
  type AppleTimelineAdapterExample
} from "../src/main/apple-adapter-dataset";
import { loadActivityEvents } from "../src/main/activity-event-file";
import { segmentActivityEvents } from "../src/main/episode-segmenter";
import { TimelineItemSchema } from "../src/main/timeline-schema";

const dataDirectory = resolve(process.argv[2] ?? defaultOpenHistoryDataDirectory());
const outputDirectory = resolve(process.argv[3] ?? "reports/private/apple-adapter-pilot");
const trainSize = integerArgument(process.argv[4], 100);
const evalSize = integerArgument(process.argv[5], 27);
const timeline = TimelineItemSchema.array().parse(JSON.parse(
  readFileSync(resolve(dataDirectory, "timeline", "index.json"), "utf8")
));
const captureEmailActivity = storedCaptureEmailActivity();
const sourceEvents = loadActivityEvents(dataDirectory, undefined, { captureEmailActivity });
const episodes = segmentActivityEvents(sourceEvents, { captureEmailActivity });
const split = buildAppleTimelineAdapterDataset(timeline, episodes, {
  trainSize,
  evalSize,
  sourceEvents,
  captureEmailActivity
});

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
chmodSync(outputDirectory, 0o700);
writePrivate("train.jsonl", jsonl(split.train));
writePrivate("eval.jsonl", jsonl(split.eval));
writePrivate("manifest.json", `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  profile: APPLE_TIMELINE_ADAPTER_DATASET_PROFILE,
  labels: {
    provenance: "stored OpenHistory timeline summaries",
    humanReviewed: false,
    providerRecordedPerItem: false
  },
  counts: {
    rawEvents: sourceEvents.length,
    storedTimelineItems: timeline.length,
    recoverableEpisodes: episodes.length,
    eligible: split.eligibleCount,
    reconstructedFromSourceEventIds: split.reconstructedEpisodeCount,
    train: split.train.length,
    eval: split.eval.length,
    omittedEligible: split.omittedEligibleCount
  },
  selection: split.selection,
  train: splitMetadata(split.train),
  eval: splitMetadata(split.eval),
  caveats: [
    "Targets are model-generated stored summaries, not human-corrected gold labels.",
    "The current corpus spans too few days for a leakage-resistant day-held-out evaluation.",
    "The dataset uses Apple's schema-free guided-generation format and must be loaded with includeSchemaInPrompt false."
  ]
}, null, 2)}\n`);

process.stdout.write(`${outputDirectory}\n`);

function jsonl(examples: AppleTimelineAdapterExample[]): string {
  return `${examples.map(appleAdapterJsonLine).join("\n")}\n`;
}

function splitMetadata(examples: AppleTimelineAdapterExample[]): object {
  return {
    count: examples.length,
    sha256: appleAdapterDatasetDigest(examples),
    firstStartTime: examples[0]?.startTime,
    lastStartTime: examples.at(-1)?.startTime,
    promptCharacters: examples.reduce((sum, example) => sum + example.messages
      .filter(({ role }) => role !== "assistant")
      .reduce((messageSum, message) => messageSum + message.content.length, 0), 0),
    responseCharacters: examples.reduce((sum, example) => sum + example.messages
      .filter(({ role }) => role === "assistant")
      .reduce((messageSum, message) => messageSum + message.content.length, 0), 0),
    ids: examples.map(({ id }) => id)
  };
}

function writePrivate(name: string, content: string): void {
  const path = resolve(outputDirectory, name);
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function integerArgument(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (value !== undefined && (!Number.isInteger(parsed) || parsed < 1)) {
    throw new Error("Train and eval sizes must be positive integers.");
  }
  return value === undefined ? fallback : parsed;
}

function storedCaptureEmailActivity(): boolean {
  try {
    const settings = JSON.parse(readFileSync(resolve(dataDirectory, "settings.json"), "utf8")) as {
      captureEmailActivity?: unknown;
    };
    return settings.captureEmailActivity === true;
  } catch {
    return false;
  }
}
