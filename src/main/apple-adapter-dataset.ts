import { createHash } from "node:crypto";
import type { ActivityEpisode, ActivityEvent, ApplicationDescriptor, TimelineItem } from "@shared/contracts";
import { buildTimelineGenerationRequest } from "./inference/service";
import { TIMELINE_TASK } from "./inference/tasks";

export interface AppleAdapterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AppleTimelineAdapterExample {
  id: string;
  startTime: string;
  sourceEventIds: string[];
  messages: AppleAdapterMessage[];
}

export interface AppleTimelineAdapterSplit {
  train: AppleTimelineAdapterExample[];
  eval: AppleTimelineAdapterExample[];
  eligibleCount: number;
  omittedEligibleCount: number;
  reconstructedEpisodeCount: number;
  selection: string;
}

export interface AppleTimelineAdapterDatasetOptions {
  trainSize?: number;
  evalSize?: number;
  seed?: string;
  sourceEvents?: ActivityEvent[];
  captureEmailActivity?: boolean;
}

const DEFAULT_TRAIN_SIZE = 100;
const DEFAULT_EVAL_SIZE = 27;
const DEFAULT_SEED = "openhistory-apple-timeline-adapter-v1";

export function buildAppleTimelineAdapterDataset(
  timeline: TimelineItem[],
  episodes: ActivityEpisode[],
  options: AppleTimelineAdapterDatasetOptions = {}
): AppleTimelineAdapterSplit {
  const trainSize = positiveInteger(options.trainSize ?? DEFAULT_TRAIN_SIZE, "trainSize");
  const evalSize = positiveInteger(options.evalSize ?? DEFAULT_EVAL_SIZE, "evalSize");
  const seed = options.seed?.trim() || DEFAULT_SEED;
  const episodesById = new Map(episodes.map((episode) => [episode.id, episode]));
  const sourceEventsById = new Map((options.sourceEvents ?? []).map((event) => [event.id, event]));
  let reconstructedEpisodeCount = 0;
  const eligible = timeline.flatMap((item): AppleTimelineAdapterExample[] => {
    const currentEpisode = episodesById.get(item.id);
    const episode = currentEpisode ?? reconstructEpisode(item, sourceEventsById);
    if (!episode || !item.sourceEventIds?.length) return [];
    if (!currentEpisode) reconstructedEpisodeCount += 1;
    return [timelineExample(item, episode, options.captureEmailActivity ?? false)];
  });
  const requested = trainSize + evalSize;
  if (eligible.length < requested) {
    throw new Error(
      `Apple timeline adapter export needs ${requested} source-backed examples; only ${eligible.length} are eligible.`
    );
  }

  const selected = [...eligible]
    .sort((left, right) => selectionDigest(seed, left.id).localeCompare(selectionDigest(seed, right.id)))
    .slice(0, requested);
  const evaluationIds = new Set(
    [...selected]
      .sort((left, right) => selectionDigest(`${seed}:eval`, left.id).localeCompare(
        selectionDigest(`${seed}:eval`, right.id)
      ))
      .slice(0, evalSize)
      .map(({ id }) => id)
  );
  const chronological = (items: AppleTimelineAdapterExample[]) => [...items].sort(
    (left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || left.id.localeCompare(right.id)
  );

  return {
    train: chronological(selected.filter(({ id }) => !evaluationIds.has(id))),
    eval: chronological(selected.filter(({ id }) => evaluationIds.has(id))),
    eligibleCount: eligible.length,
    omittedEligibleCount: eligible.length - selected.length,
    reconstructedEpisodeCount,
    selection: `sha256-ranked:${seed}; eval=sha256-ranked:${seed}:eval`
  };
}

export function appleAdapterJsonLine(example: AppleTimelineAdapterExample): string {
  return JSON.stringify(example.messages);
}

export function appleAdapterDatasetDigest(examples: AppleTimelineAdapterExample[]): string {
  return createHash("sha256")
    .update(examples.map(appleAdapterJsonLine).join("\n"))
    .digest("hex");
}

function timelineExample(
  item: TimelineItem,
  episode: ActivityEpisode,
  captureEmailActivity: boolean
): AppleTimelineAdapterExample {
  const request = buildTimelineGenerationRequest("apple", episode, { captureEmailActivity });
  const response = `{"title": ${JSON.stringify(item.title)}, "description": ${JSON.stringify(item.description)}}`;
  return {
    id: item.id,
    startTime: item.startTime,
    sourceEventIds: [...item.sourceEventIds!],
    messages: [
      {
        role: "system",
        content: `A conversation between a user and a helpful assistant. ${request.instructions}`
      },
      { role: "user", content: request.input },
      { role: "assistant", content: response }
    ]
  };
}

function reconstructEpisode(
  item: TimelineItem,
  sourceEventsById: Map<string, ActivityEvent>
): ActivityEpisode | undefined {
  if (!item.sourceEventIds?.length) return undefined;
  const events = item.sourceEventIds.map((id) => sourceEventsById.get(id));
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

function selectionDigest(seed: string, id: string): string {
  return createHash("sha256").update(`${seed}\n${id}`).digest("hex");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export const APPLE_TIMELINE_ADAPTER_DATASET_PROFILE = Object.freeze({
  task: "timeline" as const,
  inputVersion: TIMELINE_TASK.apple.inputVersion,
  promptVersion: TIMELINE_TASK.apple.promptVersion,
  schemaName: TIMELINE_TASK.apple.schemaName,
  schemaVersion: TIMELINE_TASK.apple.schemaVersion,
  targetFields: ["title", "description"] as const,
  format: "Apple schema-free guided-generation JSONL; system/user/assistant messages and json-dumps response spacing"
});
