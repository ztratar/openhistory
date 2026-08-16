import type { ActivityEvent } from "@shared/contracts";
import { segmentActivityEvents } from "./episode-segmenter";
import { episodeForModel, eventsForModel } from "./openai-service";

const SEMANTIC_KINDS = new Set<ActivityEvent["kind"]>([
  "focused_element_changed", "selection_changed", "text_input", "document_changed",
  "pointer_click", "url_changed", "document_context_changed", "ui_snapshot"
]);
const DIRECT_ACTION_KINDS = new Set<ActivityEvent["kind"]>([
  "selection_changed", "text_input", "document_changed", "pointer_click"
]);
const NAVIGATION_KINDS = new Set<ActivityEvent["kind"]>([
  "url_changed", "document_context_changed"
]);
const SYSTEM_KINDS = new Set<ActivityEvent["kind"]>([
  "collector_started", "screen_slept", "screen_woke", "session_locked", "session_unlocked"
]);

export interface EventQualityMetrics {
  totalEvents: number;
  meaningfulEvents: number;
  semanticEvents: number;
  directActionEvents: number;
  navigationEvents: number;
  adjacentExactDuplicates: number;
  episodeAdjacentExactDuplicates: number;
  episodeCount: number;
  episodeEvents: number;
  modelObservations: number;
  modelPayloadCharacters: number;
  approximateModelInputTokens: number;
  semanticDensityPercent: number;
  directActionDensityPercent: number;
  navigationDensityPercent: number;
  rawToEpisodeCompressionPercent: number;
  modelCompressionPercent: number;
  coveredSemanticKinds: number;
}

export function analyzeEventQuality(events: ActivityEvent[]): EventQualityMetrics {
  const meaningful = events.filter((event) => !SYSTEM_KINDS.has(event.kind));
  const semanticEvents = meaningful.filter((event) => SEMANTIC_KINDS.has(event.kind));
  const directActionEvents = meaningful.filter((event) => DIRECT_ACTION_KINDS.has(event.kind));
  const navigationEvents = meaningful.filter((event) => NAVIGATION_KINDS.has(event.kind));
  const episodes = segmentActivityEvents(events);
  const episodeEvents = episodes.reduce((sum, episode) => sum + episode.events.length, 0);
  const modelObservations = episodes.reduce(
    (sum, episode) => sum + eventsForModel(episode).length,
    0
  );
  const modelPayloadCharacters = episodes.reduce(
    (sum, episode) => sum + JSON.stringify(episodeForModel(episode)).length,
    0
  );
  const adjacentExactDuplicates = countAdjacentDuplicates(meaningful);
  const episodeAdjacentExactDuplicates = episodes.reduce(
    (sum, episode) => sum + countAdjacentDuplicates(episode.events),
    0
  );

  return {
    totalEvents: events.length,
    meaningfulEvents: meaningful.length,
    semanticEvents: semanticEvents.length,
    directActionEvents: directActionEvents.length,
    navigationEvents: navigationEvents.length,
    adjacentExactDuplicates,
    episodeAdjacentExactDuplicates,
    episodeCount: episodes.length,
    episodeEvents,
    modelObservations,
    modelPayloadCharacters,
    approximateModelInputTokens: Math.ceil(modelPayloadCharacters / 4),
    semanticDensityPercent: percent(semanticEvents.length, meaningful.length),
    directActionDensityPercent: percent(directActionEvents.length, meaningful.length),
    navigationDensityPercent: percent(navigationEvents.length, meaningful.length),
    rawToEpisodeCompressionPercent: percent(
      Math.max(0, meaningful.length - episodeEvents),
      meaningful.length
    ),
    modelCompressionPercent: percent(Math.max(0, episodeEvents - modelObservations), episodeEvents),
    coveredSemanticKinds: new Set(semanticEvents.map(({ kind }) => kind)).size
  };
}

function countAdjacentDuplicates(events: ActivityEvent[]): number {
  let duplicates = 0;
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (
      Date.parse(current.timestamp) - Date.parse(previous.timestamp) <= 60_000 &&
      qualityFingerprint(previous) === qualityFingerprint(current)
    ) duplicates += 1;
  }
  return duplicates;
}

function percent(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1_000) / 10 : 0;
}

function qualityFingerprint(event: ActivityEvent): string {
  return JSON.stringify([
    event.kind,
    event.application?.bundleIdentifier,
    event.windowTitle,
    event.element,
    event.selectedElements,
    event.textChange,
    event.browser,
    event.document,
    event.visibleText
  ]);
}
