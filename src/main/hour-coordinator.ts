import type { HourItem, HourState, TimelineItem } from "@shared/contracts";
import { HourStore } from "./hour-store";
import { InferenceService } from "./openai-service";
import { inferenceErrorMetadata, publicInferenceErrorMessage } from "./openai-error";
import { isItemScopedInferenceError } from "./inference/errors";
import { timelineRevision } from "./provenance";
import { TimelineStore } from "./timeline-store";

const MAX_HOURS_PER_REQUEST = 6;

interface TimelineHour {
  id: string;
  startTime: string;
  endTime: string;
  timelineItems: TimelineItem[];
}

export class HourCoordinator {
  private consolidating = false;
  private lastError?: string;

  constructor(
    private readonly timelineStore: TimelineStore,
    private readonly hourStore: HourStore,
    private readonly inference: InferenceService
  ) {}

  getState(now = Date.now()): HourState {
    const hours = new Map(this.timelineHours().map((hour) => [hour.id, hour]));
    return {
      items: this.hourStore.loadAll().filter((item) => {
        const source = hours.get(item.id);
        return Boolean(source && sameRevisions(item.sourceTimelineRevisions, revisionsFor(source.timelineItems)));
      }),
      pendingHourCount: this.pendingHours(now).length,
      consolidating: this.consolidating,
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  async consolidatePending(onStateChange?: (state: HourState) => void): Promise<HourState> {
    if (this.consolidating) return this.getState();
    this.consolidating = true;
    this.lastError = undefined;
    onStateChange?.(this.getState());

    try {
      if (!this.inference.configured) throw new Error(this.inference.unavailableMessage);
      const pending = this.pendingHours()
        .slice(0, MAX_HOURS_PER_REQUEST)
        .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
      let itemError: unknown;
      for (const hour of pending) {
        try {
          this.hourStore.save(
            await this.inference.consolidateHour(
              hour.startTime,
              hour.endTime,
              hour.timelineItems,
              this.previousHour(hour.startTime)
            )
          );
          onStateChange?.(this.getState());
        } catch (error) {
          if (!isItemScopedInferenceError(error)) throw error;
          itemError = error;
          console.error("Hour consolidation skipped one hour", inferenceErrorMetadata(
            error,
            this.inference.provider
          ));
        }
      }
      if (itemError) {
        this.lastError = publicInferenceErrorMessage(
          itemError,
          "Hour consolidation",
          this.inference.provider
        );
      }
    } catch (error) {
      this.lastError = publicInferenceErrorMessage(error, "Hour consolidation", this.inference.provider);
      console.error("Hour consolidation failed", inferenceErrorMetadata(error, this.inference.provider));
    } finally {
      this.consolidating = false;
    }

    const state = this.getState();
    onStateChange?.(state);
    return state;
  }

  private pendingHours(now = Date.now()): TimelineHour[] {
    const stored = new Map(this.hourStore.loadAll().map((item) => [item.id, item]));
    return this.timelineHours()
      .filter((hour) => Date.parse(hour.endTime) <= now)
      .filter((hour) => {
        const existing = stored.get(hour.id);
        return !existing || !sameRevisions(existing.sourceTimelineRevisions, revisionsFor(hour.timelineItems));
      })
      .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));
  }

  private timelineHours(): TimelineHour[] {
    const hours = new Map<string, TimelineHour>();
    for (const item of this.verifiedTimelineItems()) {
      const startTime = hourStartForTimestamp(item.startTime);
      const existing = hours.get(startTime);
      const hour = existing ?? {
        id: startTime,
        startTime,
        endTime: new Date(Date.parse(startTime) + 60 * 60 * 1_000).toISOString(),
        timelineItems: []
      };
      hour.timelineItems.push(item);
      hours.set(startTime, hour);
    }
    return [...hours.values()].map((hour) => ({
      ...hour,
      timelineItems: hour.timelineItems.sort(
        (left, right) => Date.parse(left.startTime) - Date.parse(right.startTime)
      )
    }));
  }

  private verifiedTimelineItems(): TimelineItem[] {
    return this.timelineStore.loadAll().filter((item) => Boolean(timelineRevision(item)));
  }

  private previousHour(startTime: string): HourItem | undefined {
    const target = Date.parse(startTime);
    return this.getState().items.find((item) => Date.parse(item.endTime) === target);
  }
}

export function hourStartForTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const elapsedMs = (
    date.getMinutes() * 60 * 1_000 +
    date.getSeconds() * 1_000 +
    date.getMilliseconds()
  );
  return new Date(date.getTime() - elapsedMs).toISOString();
}

function revisionsFor(items: TimelineItem[]): string[] {
  return items.flatMap((item) => {
    const revision = timelineRevision(item);
    return revision ? [revision] : [];
  }).sort();
}

function sameRevisions(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((revision, index) => revision === right[index]);
}
