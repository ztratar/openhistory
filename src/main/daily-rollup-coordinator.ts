import type { HourItem, DailyRollupItem, DailyRollupState, TimelineItem } from "@shared/contracts";
import { HourStore } from "./hour-store";
import { DailyRollupStore } from "./daily-rollup-store";
import { InferenceService } from "./openai-service";
import { inferenceErrorMetadata, publicInferenceErrorMessage } from "./openai-error";
import { isItemScopedInferenceError } from "./inference/errors";
import { TimelineStore } from "./timeline-store";
import { timelineRevision } from "./provenance";

const MAX_DAYS_PER_REQUEST = 3;

interface PendingDay {
  date: string;
  timelineItems: TimelineItem[];
  existing?: DailyRollupItem;
}

export class DailyRollupCoordinator {
  private consolidating = false;
  private lastError?: string;

  constructor(
    private readonly timelineStore: TimelineStore,
    private readonly dailyRollupStore: DailyRollupStore,
    private readonly inference: InferenceService,
    private readonly hourStore?: HourStore
  ) {}

  getState(): DailyRollupState {
    const revisions = new Set(this.verifiedTimelineItems().flatMap((item) => {
      const revision = timelineRevision(item);
      return revision ? [revision] : [];
    }));
    return {
      items: this.dailyRollupStore.loadAll().filter((item) =>
        Boolean(item.sourceTimelineRevisions?.length) &&
        item.sourceTimelineRevisions!.every((revision) => revisions.has(revision))
      ),
      pendingDayCount: this.pendingDays().length,
      consolidating: this.consolidating,
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  async consolidatePending(onStateChange?: (state: DailyRollupState) => void): Promise<DailyRollupState> {
    if (this.consolidating) return this.getState();
    this.consolidating = true;
    this.lastError = undefined;
    onStateChange?.(this.getState());

    try {
      if (!this.inference.configured) throw new Error(this.inference.unavailableMessage);
      let itemError: unknown;
      for (const day of this.pendingDays().slice(0, MAX_DAYS_PER_REQUEST)) {
        try {
          this.dailyRollupStore.save(
            await this.inference.consolidateDailyRollup(
              day.date,
              day.timelineItems,
              day.existing,
              this.hoursForDay(day.date, day.timelineItems)
            )
          );
          onStateChange?.(this.getState());
        } catch (error) {
          if (!isItemScopedInferenceError(error)) throw error;
          itemError = error;
          console.error("Daily rollup consolidation skipped one day", inferenceErrorMetadata(
            error,
            this.inference.provider
          ));
        }
      }
      if (itemError) {
        this.lastError = publicInferenceErrorMessage(
          itemError,
          "Daily rollup consolidation",
          this.inference.provider
        );
      }
    } catch (error) {
      this.lastError = publicInferenceErrorMessage(error, "Daily rollup consolidation", this.inference.provider);
      console.error("Daily rollup consolidation failed", inferenceErrorMetadata(error, this.inference.provider));
    } finally {
      this.consolidating = false;
    }

    const state = this.getState();
    onStateChange?.(state);
    return state;
  }

  private pendingDays(): PendingDay[] {
    const dailyRollups = new Map(this.dailyRollupStore.loadAll().map((item) => [item.date, item]));
    const days = new Map<string, TimelineItem[]>();
    for (const item of this.verifiedTimelineItems()) {
      const date = localDate(item.startTime);
      days.set(date, [...(days.get(date) ?? []), item]);
    }

    return [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([date, timelineItems]) => {
        const existing = dailyRollups.get(date);
        const sourceRevisions = timelineItems.flatMap((item) => {
          const revision = timelineRevision(item);
          return revision ? [revision] : [];
        }).sort();
        const previousRevisions = [...(existing?.sourceTimelineRevisions ?? [])].sort();
        if (sourceRevisions.join("\n") === previousRevisions.join("\n")) return [];
        const safeExisting = existing?.sourceTimelineRevisions?.length ? existing : undefined;
        return [{ date, timelineItems, ...(safeExisting ? { existing: safeExisting } : {}) }];
      });
  }

  private verifiedTimelineItems(): TimelineItem[] {
    return this.timelineStore.loadAll().filter((item) => Boolean(timelineRevision(item)));
  }

  private hoursForDay(date: string, timelineItems: TimelineItem[]): HourItem[] {
    if (!this.hourStore) return [];
    const validIds = new Set(timelineItems.map((item) => item.id));
    const revisionsById = new Map(timelineItems.flatMap((item) => {
      const revision = timelineRevision(item);
      return revision ? [[item.id, revision] as const] : [];
    }));
    return this.hourStore.loadAll()
      .filter((hour) => localDate(hour.startTime) === date)
      .filter((hour) => hour.sourceTimelineIds.every((id) => validIds.has(id)))
      .filter((hour) => {
        const current = hour.sourceTimelineIds
          .flatMap((id) => revisionsById.get(id) ?? [])
          .sort();
        const stored = [...hour.sourceTimelineRevisions].sort();
        return current.length === stored.length && current.every((revision, index) => revision === stored[index]);
      })
      .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
  }
}

function localDate(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
