export const AUTOMATIC_HISTORY_INTERVAL_MS = 60 * 1_000;
export const HISTORY_CATCH_UP_DELAY_MS = 15 * 1_000;

export interface PendingHistoryCounts {
  timeline: number;
  hour: number;
  day: number;
}

export function shouldScheduleHistoryCatchUp(
  before: PendingHistoryCounts,
  after: PendingHistoryCounts
): boolean {
  const hasPendingWork = after.timeline > 0 || after.hour > 0 || after.day > 0;
  const madeProgress = after.timeline < before.timeline ||
    after.hour < before.hour ||
    after.day < before.day;
  return hasPendingWork && madeProgress;
}
