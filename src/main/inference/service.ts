import type { ActivityEpisode, HourItem, DailyRollupItem, TimelineItem } from "@shared/contracts";
import {
  selectedOpenAIAuthMode,
  type InferenceProvider,
  type InferenceSettings
} from "@shared/inference";
import type { CodexRuntime } from "../codex-runtime";
import { isRetryableInferenceError } from "./errors";
import { timelineRevision } from "../provenance";
import {
  episodeHistoryLinks,
  historyLinkCandidatesForModel,
  rollupLinkCandidates,
  selectedRollupLinks
} from "../history-links";
import {
  filterProtectedActivityEvents,
  type ActivityPrivacyOptions
} from "../privacy-policy";
import {
  createInferenceProvider,
  probeAppleFoundationModel,
  type InferenceProviderAdapter,
  type StructuredGenerationRequest
} from "./provider";
import {
  buildEpisodeEvidencePacket,
  renderCompactEpisodeEvidenceBrief
} from "../episode-evidence";
import { DAY_TASK, HOUR_TASK, TIMELINE_TASK } from "./tasks";
import {
  appleSemanticDailyRollupPrompt,
  appleSemanticHourPrompt,
  dailyEvidenceSummary,
  episodeForHybridModel,
  hourForHybridModel,
  hourForModel,
  dailyRollupForModel,
  modelInput,
  timelineItemForModel,
  uniqueTimelineApplications
} from "./inputs";

import {
  APPLE_DAY_INSTRUCTIONS,
  APPLE_HOUR_INSTRUCTIONS,
  APPLE_TIMELINE_INSTRUCTIONS,
  HOUR_INSTRUCTIONS,
  DAILY_ROLLUP_INSTRUCTIONS,
  SUMMARY_INSTRUCTIONS
} from "./prompts";
import {
  ensureAppleDayCoverage,
  ensureAppleHourCoverage,
  fallbackAppleDayDraft,
  fallbackAppleHourDraft
} from "./rollup-coverage";

export * from "./prompts";
const MAX_GENERATION_ATTEMPTS = 2;
const MAX_RETRY_OUTPUT_TOKENS = 4_000;

export class InferenceService {
  private adapter?: InferenceProviderAdapter;
  private settings: InferenceSettings;

  constructor(options: {
    apiKey?: string;
    chatGPTSignedIn?: boolean;
    codexRuntime?: CodexRuntime;
    settings: InferenceSettings;
    adapter?: InferenceProviderAdapter;
  }) {
    this.settings = options.settings;
    this.configure(options.settings, options.apiKey, {
      codexRuntime: options.codexRuntime,
      signedIn: options.chatGPTSignedIn === true
    });
    if (options.settings.enabled && options.adapter) this.adapter = options.adapter;
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get provider(): InferenceProvider {
    return this.settings.provider;
  }

  get model(): string {
    return this.settings.models[this.settings.provider];
  }

  get configured(): boolean {
    return this.settings.enabled && this.adapter !== undefined;
  }

  get unavailableMessage(): string {
    if (this.settings.enabled && this.settings.provider === "apple") {
      return probeAppleFoundationModel().reason ?? "Apple's on-device model is unavailable.";
    }
    if (this.settings.enabled && this.settings.provider === "openai" &&
        selectedOpenAIAuthMode(this.settings) === "chatgpt") {
      return "ChatGPT is not connected. Sign in from Settings.";
    }
    return this.settings.enabled
      ? "No inference API key is configured. Add one in Settings."
      : "Automatic summaries are turned off in Settings.";
  }

  configure(
    settings: InferenceSettings,
    apiKey?: string,
    chatGPT?: { codexRuntime?: CodexRuntime; signedIn: boolean }
  ): void {
    this.settings = structuredClone(settings);
    if (!settings.enabled) {
      this.adapter = undefined;
      return;
    }
    if (settings.provider === "apple") {
      const availability = probeAppleFoundationModel();
      this.adapter = availability.available
        ? createInferenceProvider({ provider: "apple", model: settings.models.apple })
        : undefined;
      return;
    }
    if (settings.provider === "openai" && selectedOpenAIAuthMode(settings) === "chatgpt") {
      this.adapter = chatGPT?.signedIn && chatGPT.codexRuntime
        ? createInferenceProvider({
          provider: "openai",
          model: settings.models.openai,
          settings,
          codexRuntime: chatGPT.codexRuntime
        })
        : undefined;
      return;
    }
    this.adapter = apiKey
      ? createInferenceProvider({
        apiKey,
        provider: settings.provider,
        model: settings.models[settings.provider],
        settings
      })
      : undefined;
  }

  async summarizeEpisode(
    episode: ActivityEpisode,
    privacyOptions: ActivityPrivacyOptions = {}
  ): Promise<TimelineItem> {
    const safeEpisode = prepareEpisodeForInference(episode, privacyOptions);
    const draft = await this.generate(buildTimelineGenerationRequest(
      this.provider,
      safeEpisode,
      privacyOptions
    ));

    return {
      version: 1,
      id: safeEpisode.id,
      startTime: safeEpisode.startTime,
      endTime: safeEpisode.endTime,
      applications: safeEpisode.applications.map((application) => {
        const bundleIdentifier = application.bundleIdentifier?.trim() || null;
        const localizedName = application.localizedName?.trim();
        return {
          bundleIdentifier,
          name: localizedName || bundleIdentifier || "Unknown application"
        };
      }),
      links: episodeHistoryLinks(safeEpisode),
      sourceEventIds: safeEpisode.events.map((event) => event.id),
      ...draft
    };
  }

  async consolidateHour(
    startTime: string,
    endTime: string,
    timelineItems: TimelineItem[],
    lastHour?: HourItem
  ): Promise<HourItem> {
    let generated;
    try {
      generated = await this.generate(buildHourGenerationRequest(this.provider, timelineItems, lastHour));
    } catch (error) {
      if (this.provider !== "apple") throw error;
      console.warn("Apple hour generation used deterministic local fallback", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      generated = fallbackAppleHourDraft(timelineItems);
    }
    const draft = this.provider === "apple" ? ensureAppleHourCoverage(generated, timelineItems) : generated;
    const candidates = rollupLinkCandidates(timelineItems);
    const { linkReferences, ...content } = draft;
    return {
      version: 1,
      id: startTime,
      startTime,
      endTime,
      applications: uniqueTimelineApplications(timelineItems),
      links: selectedRollupLinks(draft.summary, candidates, linkReferences, this.provider === "apple"),
      sourceTimelineIds: timelineItems.map((item) => item.id).sort(),
      sourceTimelineRevisions: timelineItems.flatMap((item) => {
        const revision = timelineRevision(item);
        return revision ? [revision] : [];
      }).sort(),
      updatedAt: new Date().toISOString(),
      ...content
    };
  }

  async consolidateDailyRollup(
    date: string,
    timelineItems: TimelineItem[],
    existing?: DailyRollupItem,
    hourItems: HourItem[] = []
  ): Promise<DailyRollupItem> {
    const unrolledTimeline = unrolledTimelineItems(timelineItems, hourItems);
    let generated;
    try {
      generated = await this.generate(buildDailyRollupGenerationRequest(
        this.provider,
        date,
        timelineItems,
        existing,
        hourItems,
        unrolledTimeline
      ));
    } catch (error) {
      if (this.provider !== "apple") throw error;
      console.warn("Apple daily generation used deterministic local fallback", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      generated = fallbackAppleDayDraft(hourItems, unrolledTimeline, timelineItems);
    }
    const draft = this.provider === "apple"
      ? ensureAppleDayCoverage(generated, hourItems, unrolledTimeline, timelineItems)
      : generated;
    const candidates = rollupLinkCandidates([...hourItems, ...unrolledTimeline]);
    const { linkReferences, ...content } = draft;
    return {
      version: 2,
      id: date,
      date,
      links: selectedRollupLinks(draft.summary, candidates, linkReferences, this.provider === "apple"),
      sourceTimelineIds: timelineItems.map((item) => item.id).sort(),
      sourceTimelineRevisions: timelineItems.flatMap((item) => {
        const revision = timelineRevision(item);
        return revision ? [revision] : [];
      }).sort(),
      updatedAt: new Date().toISOString(),
      ...content
    };
  }

  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    return this.generate(request);
  }

  private async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    if (!this.adapter) throw new Error(this.unavailableMessage);
    let currentRequest = request;
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      try {
        return await this.adapter.generate(currentRequest);
      } catch (error) {
        if (attempt === MAX_GENERATION_ATTEMPTS || !isRetryableInferenceError(error)) throw error;
        currentRequest = {
          ...request,
          maxOutputTokens: Math.min(request.maxOutputTokens * 2, MAX_RETRY_OUTPUT_TOKENS)
        };
      }
    }
    throw new Error("Inference retry loop exited unexpectedly");
  }
}

export function buildTimelineGenerationRequest(
  provider: InferenceProvider,
  episode: ActivityEpisode,
  privacyOptions: ActivityPrivacyOptions = {}
): StructuredGenerationRequest<ReturnType<typeof TIMELINE_TASK.schema.parse>> {
  const safeEpisode = prepareEpisodeForInference(episode, privacyOptions);
  const profile = provider === "apple" ? TIMELINE_TASK.apple : TIMELINE_TASK.cloud;
  return {
    instructions: provider === "apple" ? APPLE_TIMELINE_INSTRUCTIONS : SUMMARY_INSTRUCTIONS,
    input: provider === "apple"
      ? renderCompactEpisodeEvidenceBrief(buildEpisodeEvidencePacket(safeEpisode))
      : modelInput(episodeForHybridModel(safeEpisode)),
    schema: TIMELINE_TASK.schema,
    schemaName: profile.schemaName,
    maxOutputTokens: profile.maxOutputTokens
  };
}

export function prepareEpisodeForInference(
  episode: ActivityEpisode,
  privacyOptions: ActivityPrivacyOptions = {}
): ActivityEpisode {
  const filtered = filterProtectedActivityEvents(episode.events, privacyOptions);
  const unchanged = filtered.length === episode.events.length &&
    filtered.every((event, index) => event === episode.events[index]);
  if (!unchanged || filtered.some((event) => event.kind === "privacy_boundary")) {
    throw new Error("Refusing to summarize an episode containing protected activity");
  }
  return episode;
}

export function buildHourGenerationRequest(
  provider: InferenceProvider,
  timelineItems: TimelineItem[],
  lastHour?: HourItem
): StructuredGenerationRequest<ReturnType<typeof HOUR_TASK.schema.parse>> {
  const profile = provider === "apple" ? HOUR_TASK.apple : HOUR_TASK.cloud;
  return {
    instructions: provider === "apple" ? APPLE_HOUR_INSTRUCTIONS : HOUR_INSTRUCTIONS,
    input: provider === "apple"
      ? appleSemanticHourPrompt(timelineItems, lastHour)
      : modelInput(hourForHybridModel(timelineItems, lastHour)),
    schema: HOUR_TASK.schema,
    schemaName: profile.schemaName,
    maxOutputTokens: profile.maxOutputTokens
  };
}

export function buildDailyRollupGenerationRequest(
  provider: InferenceProvider,
  date: string,
  timelineItems: TimelineItem[],
  existing: DailyRollupItem | undefined,
  hourItems: HourItem[],
  unrolledTimeline?: TimelineItem[]
): StructuredGenerationRequest<ReturnType<typeof DAY_TASK.schema.parse>> {
  const profile = provider === "apple" ? DAY_TASK.apple : DAY_TASK.cloud;
  const currentUnrolledTimeline = unrolledTimeline ?? unrolledTimelineItems(timelineItems, hourItems);
  const importantLinkCandidates = rollupLinkCandidates([...hourItems, ...currentUnrolledTimeline]);
  return {
    instructions: provider === "apple" ? APPLE_DAY_INSTRUCTIONS : DAILY_ROLLUP_INSTRUCTIONS,
    input: provider === "apple" ? appleSemanticDailyRollupPrompt(hourItems, currentUnrolledTimeline, existing) : modelInput({
      date,
      previousDailyRollup: existing ? dailyRollupForModel(existing) : null,
      dayEvidenceSummary: dailyEvidenceSummary(timelineItems),
      importantLinkCandidates: historyLinkCandidatesForModel(importantLinkCandidates),
      hours: hourItems.map(hourForModel),
      unrolledTimeline: currentUnrolledTimeline.map(timelineItemForModel)
    }),
    schema: DAY_TASK.schema,
    schemaName: profile.schemaName,
    maxOutputTokens: profile.maxOutputTokens
  };
}

export function unrolledTimelineItems(timelineItems: TimelineItem[], hourItems: HourItem[]): TimelineItem[] {
  const representedTimelineIds = new Set(hourItems.flatMap((hour) => hour.sourceTimelineIds));
  return timelineItems.filter((item) => !representedTimelineIds.has(item.id));
}


export * from "./inputs";
