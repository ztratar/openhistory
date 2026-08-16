import { loadActivityEvents, scrubProtectedActivityEvents } from "./activity-event-file";
import { segmentActivityEvents } from "./episode-segmenter";
import { HourStore } from "./hour-store";
import { DailyRollupStore } from "./daily-rollup-store";
import type { ActivityPrivacyOptions } from "./privacy-policy";
import { timelineRevision } from "./provenance";
import { TimelineStore } from "./timeline-store";

export interface PrivacyReconciliationResult {
  rawEventsRemoved: number;
  timelineItemsRemoved: number;
  hourItemsRemoved: number;
  dailyRollupsRemoved: number;
}

export function reconcileProtectedHistory(
  dataDirectory: string,
  timelineStore: TimelineStore,
  hourStore: HourStore,
  dailyRollupStore: DailyRollupStore,
  options: ActivityPrivacyOptions = {}
): PrivacyReconciliationResult {
  const rawEventsRemoved = scrubProtectedActivityEvents(dataDirectory, options);
  const episodes = new Map(segmentActivityEvents(
    loadActivityEvents(dataDirectory, undefined, options),
    options
  ).map((episode) => [
    episode.id,
    episode.events.map((event) => event.id)
  ]));

  const allTimeline = timelineStore.loadAll();
  const timeline = allTimeline.filter((item) => {
    const sourceEventIds = episodes.get(item.id);
    return Boolean(sourceEventIds && sameValues(item.sourceEventIds ?? [], sourceEventIds));
  });
  if (timeline.length !== allTimeline.length) timelineStore.replaceAll(timeline);

  const timelineById = new Map(timeline.map((item) => [item.id, item]));
  const allHours = hourStore.loadAll();
  const hours = allHours.filter((item) => {
    const sourceItems = item.sourceTimelineIds.flatMap((id) => timelineById.get(id) ?? []);
    if (sourceItems.length !== item.sourceTimelineIds.length) return false;
    const revisions = sourceItems.flatMap((source) => timelineRevision(source) ?? []).sort();
    return sameValues(item.sourceTimelineRevisions, revisions);
  });
  if (hours.length !== allHours.length) hourStore.replaceAll(hours);

  const revisions = new Set(timeline.flatMap((item) => timelineRevision(item) ?? []));
  const allDailyRollups = dailyRollupStore.loadAll();
  const dailyRollups = allDailyRollups.filter((item) =>
    Boolean(item.sourceTimelineRevisions?.length) &&
    item.sourceTimelineRevisions!.every((revision) => revisions.has(revision))
  );
  if (dailyRollups.length !== allDailyRollups.length) dailyRollupStore.replaceAll(dailyRollups);

  return {
    rawEventsRemoved,
    timelineItemsRemoved: allTimeline.length - timeline.length,
    hourItemsRemoved: allHours.length - hours.length,
    dailyRollupsRemoved: allDailyRollups.length - dailyRollups.length
  };
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
