import type { ActivityEvent } from "@shared/contracts";
import { loadActivityEvents } from "./activity-event-file";
import { sanitizeProjectionText } from "./agent-projection";

const DEFAULT_WINDOW_MINUTES = 10;
const MAX_WINDOW_MINUTES = 60;
const MAX_PROJECTED_PAYLOAD_CHARACTERS = 200_000;
const MAX_VISIBLE_TEXT_ITEMS = 20;

export interface RecentActivity {
  events: Array<Record<string, unknown>>;
  submissionActions: Array<Record<string, unknown>>;
  totalAvailable: number;
  totalInWindow: number;
  windowMinutes: number;
  windowStartedAt: string;
  timeZone: string;
  truncated: boolean;
  oldestReturnedAt?: string;
  newestReturnedAt?: string;
}

export interface RecentActivitySource {
  getRecent(windowMinutes?: number): RecentActivity;
}

export class RecentActivityReader implements RecentActivitySource {
  constructor(
    private readonly dataDirectory: string,
    private readonly captureEmailActivity: () => boolean = () => false,
    private readonly now: () => Date = () => new Date()
  ) {}

  getRecent(windowMinutes = DEFAULT_WINDOW_MINUTES): RecentActivity {
    const boundedWindowMinutes = Math.max(
      1,
      Math.min(Math.round(windowMinutes), MAX_WINDOW_MINUTES)
    );
    const now = this.now();
    const windowStartedAt = new Date(
      now.getTime() - boundedWindowMinutes * 60_000
    );
    const activity = loadActivityEvents(this.dataDirectory, undefined, {
      captureEmailActivity: this.captureEmailActivity()
    });
    const inWindow = activity.filter(
      (event) => Date.parse(event.timestamp) >= windowStartedAt.getTime() &&
        Date.parse(event.timestamp) <= now.getTime()
    );
    const events = fitProjectedEventsToPayload(inWindow.map(projectActivityEvent));
    const submissionActions = inWindow.flatMap(projectSubmissionAction);

    return {
      events,
      submissionActions,
      totalAvailable: activity.length,
      totalInWindow: inWindow.length,
      windowMinutes: boundedWindowMinutes,
      windowStartedAt: windowStartedAt.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      truncated: inWindow.length > events.length,
      ...(events[0]?.timestamp ? { oldestReturnedAt: String(events[0].timestamp) } : {}),
      ...(events.at(-1)?.timestamp ? { newestReturnedAt: String(events.at(-1)!.timestamp) } : {})
    };
  }
}

function projectSubmissionAction(event: ActivityEvent): Array<Record<string, unknown>> {
  if (event.kind !== "pointer_click") return [];
  const control = [event.element?.title, event.element?.label, event.element?.identifier]
    .find((value) => value?.trim())?.trim();
  if (!control || !/\b(send|submit|publish|post)\b/i.test(control)) return [];
  const verb = /\bsend\b/i.test(control)
    ? "Sent"
    : /\bsubmit\b/i.test(control)
      ? "Submitted"
      : /\bpublish\b/i.test(control)
        ? "Published"
        : "Posted";
  return [compact({
    timestamp: event.timestamp,
    localTime: localTimestamp(event.timestamp),
    verb,
    control: sanitizeProjectionText(control),
    application: event.application?.localizedName
      ? sanitizeProjectionText(event.application.localizedName)
      : undefined,
    windowTitle: sanitizeOptional(event.windowTitle)
  })];
}

function fitProjectedEventsToPayload(
  projected: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const retained: Array<Record<string, unknown>> = [];
  let characters = 0;
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const event = projected[index]!;
    const eventCharacters = JSON.stringify(event).length;
    if (retained.length > 0 && characters + eventCharacters > MAX_PROJECTED_PAYLOAD_CHARACTERS) {
      break;
    }
    retained.unshift(event);
    characters += eventCharacters;
  }
  return retained;
}

function projectActivityEvent(event: ActivityEvent): Record<string, unknown> {
  return compact({
    timestamp: event.timestamp,
    localTime: localTimestamp(event.timestamp),
    kind: event.kind,
    application: event.application?.localizedName
      ? sanitizeProjectionText(event.application.localizedName)
      : undefined,
    windowTitle: sanitizeOptional(event.windowTitle),
    element: event.element ? compact({
      role: sanitizeOptional(event.element.role),
      subrole: sanitizeOptional(event.element.subrole),
      title: sanitizeOptional(event.element.title),
      label: sanitizeOptional(event.element.label),
      identifier: sanitizeOptional(event.element.identifier),
      value: sanitizeOptional(event.element.value)
    }) : undefined,
    selectedElements: event.selectedElements?.slice(0, MAX_VISIBLE_TEXT_ITEMS).map((element) => compact({
      role: sanitizeOptional(element.role),
      title: sanitizeOptional(element.title),
      label: sanitizeOptional(element.label),
      value: sanitizeOptional(element.value)
    })),
    textChange: event.textChange ? {
      insertedText: sanitizeProjectionText(event.textChange.insertedText),
      deletedCharacterCount: event.textChange.deletedCharacterCount,
      resultingValue: sanitizeProjectionText(event.textChange.resultingValue)
    } : undefined,
    browser: event.browser ? compact({
      domain: sanitizeProjectionText(event.browser.domain),
      title: sanitizeOptional(event.browser.title)
    }) : undefined,
    document: event.document ? compact({
      displayPath: sanitizeProjectionText(event.document.displayPath),
      name: sanitizeProjectionText(event.document.name),
      fileExtension: sanitizeOptional(event.document.fileExtension)
    }) : undefined,
    visibleText: event.visibleText?.slice(0, MAX_VISIBLE_TEXT_ITEMS).map(sanitizeProjectionText)
  });
}

function localTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(timestamp));
}

function sanitizeOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeProjectionText(value);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
