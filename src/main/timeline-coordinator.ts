import type { ActivityEpisode, TimelineState } from "@shared/contracts";
import { loadActivityEvents } from "./activity-event-file";
import { segmentActivityEvents } from "./episode-segmenter";
import { InferenceService } from "./openai-service";
import { inferenceErrorMetadata, publicInferenceErrorMessage } from "./openai-error";
import { isItemScopedInferenceError } from "./inference/errors";
import { TimelineStore } from "./timeline-store";

const ACTIVE_EPISODE_GRACE_MS = 5 * 60 * 1_000;
const MAX_EPISODES_PER_REQUEST = 8;

export class TimelineCoordinator {
  private summarizing = false;
  private lastError?: string;

  constructor(
    private readonly dataDirectory: string,
    private readonly store: TimelineStore,
    private readonly inference: InferenceService,
    private readonly captureEmailActivity: () => boolean = () => false
  ) {}

  getState(now = Date.now()): TimelineState {
    const episodes = this.loadEpisodes();
    const episodeById = new Map(episodes.map((episode) => [episode.id, episode]));
    return {
      items: this.store.loadAll().filter((item) => {
        const episode = episodeById.get(item.id);
        return Boolean(episode && sameIds(item.sourceEventIds, episode.events.map((event) => event.id)));
      }),
      pendingEpisodeCount: this.pendingEpisodes(now).length,
      summarizing: this.summarizing,
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  async summarizePending(onStateChange?: (state: TimelineState) => void): Promise<TimelineState> {
    if (this.summarizing) return this.getState();

    this.summarizing = true;
    this.lastError = undefined;
    onStateChange?.(this.getState());

    try {
      if (!this.inference.configured) throw new Error(this.inference.unavailableMessage);
      const pending = this.pendingEpisodes().slice(0, MAX_EPISODES_PER_REQUEST);
      let itemError: unknown;
      for (const episode of pending) {
        try {
          this.store.save(await this.inference.summarizeEpisode(episode, {
            captureEmailActivity: this.captureEmailActivity()
          }));
          onStateChange?.(this.getState());
        } catch (error) {
          if (!isItemScopedInferenceError(error)) throw error;
          itemError = error;
          console.error("Timeline summarization skipped one episode", inferenceErrorMetadata(
            error,
            this.inference.provider
          ));
        }
      }
      if (itemError) {
        this.lastError = publicInferenceErrorMessage(
          itemError,
          "Timeline summarization",
          this.inference.provider
        );
      }
    } catch (error) {
      this.lastError = publicInferenceErrorMessage(error, "Timeline summarization", this.inference.provider);
      console.error("Timeline summarization failed", inferenceErrorMetadata(error, this.inference.provider));
    } finally {
      this.summarizing = false;
    }

    const state = this.getState();
    onStateChange?.(state);
    return state;
  }

  private pendingEpisodes(now = Date.now()): ActivityEpisode[] {
    const items = new Map(this.store.loadAll().map((item) => [item.id, item]));
    const episodes = this.loadEpisodes();
    return episodes.filter((episode, index) => {
      const stored = items.get(episode.id);
      if (stored && sameIds(stored.sourceEventIds, episode.events.map((event) => event.id))) return false;
      const isNotNewest = index < episodes.length - 1;
      const hasGoneQuiet = now - Date.parse(episode.endTime) >= ACTIVE_EPISODE_GRACE_MS;
      const endedAtSleep = ["screen_slept", "session_locked"].includes(
        episode.events.at(-1)?.kind ?? ""
      );
      return isNotNewest || hasGoneQuiet || endedAtSleep;
    });
  }

  private loadEpisodes(): ActivityEpisode[] {
    const captureEmailActivity = this.captureEmailActivity();
    return segmentActivityEvents(
      loadActivityEvents(this.dataDirectory, undefined, { captureEmailActivity }),
      { captureEmailActivity }
    );
  }
}

function sameIds(left: string[] | undefined, right: string[]): boolean {
  return Boolean(left && left.length === right.length && left.every((id, index) => id === right[index]));
}
