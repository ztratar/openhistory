import type {
  ActivityEpisode,
  ActivityEvent,
  ApplicationDescriptor
} from "@shared/contracts";
import { createHash } from "node:crypto";
import { filterProtectedActivityEvents } from "./privacy-policy";

const DEFAULT_MAX_DURATION_MS = 13 * 60 * 1_000;
const DEFAULT_IDLE_GAP_MS = 5 * 60 * 1_000;
const DEFAULT_CONTEXT_SWITCH_GAP_MS = 2 * 60 * 1_000;
const DEFAULT_CONTEXT_LEAD_MS = 30 * 1_000;

export interface SegmentOptions {
  maxDurationMs?: number;
  idleGapMs?: number;
  contextSwitchGapMs?: number;
  contextLeadMs?: number;
  captureEmailActivity?: boolean;
  captureMessagingActivity?: boolean;
}

export function segmentActivityEvents(
  input: ActivityEvent[],
  options: SegmentOptions = {}
): ActivityEpisode[] {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const idleGapMs = options.idleGapMs ?? DEFAULT_IDLE_GAP_MS;
  const contextSwitchGapMs = options.contextSwitchGapMs ?? DEFAULT_CONTEXT_SWITCH_GAP_MS;
  const contextLeadMs = options.contextLeadMs ?? DEFAULT_CONTEXT_LEAD_MS;
  const events = filterProtectedActivityEvents(input, {
    captureEmailActivity: options.captureEmailActivity,
    captureMessagingActivity: options.captureMessagingActivity
  })
    .filter((event) => event.kind !== "collector_started" && !isCollectorHostEvent(event) &&
      Number.isFinite(Date.parse(event.timestamp)))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  const episodes: ActivityEpisode[] = [];
  let current: ActivityEvent[] = [];

  const flush = (): void => {
    const prepared = prepareEpisodeEvents(current, contextLeadMs);
    if (prepared.some(isWorkEvent)) episodes.push(makeEpisode(prepared));
    current = [];
  };

  for (const event of events) {
    if (event.kind === "privacy_boundary") {
      flush();
      continue;
    }
    const previous = current.at(-1);
    const startedAt = current[0];
    const lastWork = lastMatching(current, isWorkEvent);
    const eventTime = Date.parse(event.timestamp);
    const shouldStartNew = Boolean(
      previous &&
      startedAt &&
      (
        eventTime - Date.parse(previous.timestamp) >= idleGapMs ||
        eventTime - Date.parse(startedAt.timestamp) >= maxDurationMs ||
        previous.kind === "screen_slept" ||
        previous.kind === "session_locked" ||
        event.kind === "screen_woke" ||
        event.kind === "session_unlocked" ||
        Boolean(
          lastWork &&
          eventTime - Date.parse(lastWork.timestamp) >= contextSwitchGapMs &&
          signalsTaskContextSwitch(current, lastWork, event)
        )
      )
    );

    if (shouldStartNew) flush();
    current.push(event);
    if (event.kind === "screen_slept" || event.kind === "session_locked") flush();
  }

  flush();
  return episodes;
}

function isCollectorHostEvent(event: ActivityEvent): boolean {
  return ["OpenHistory", "Computer History"].includes(event.windowTitle ?? "") && (
    event.application?.bundleIdentifier === "com.github.Electron" ||
    ["OpenHistory", "Computer History"].includes(event.application?.localizedName ?? "")
  );
}

function isWorkEvent(event: ActivityEvent): boolean {
  return [
    "focused_element_changed",
    "selection_changed",
    "text_input",
    "document_changed",
    "pointer_click",
    "url_changed",
    "document_context_changed",
    "ui_snapshot"
  ].includes(event.kind);
}

function makeEpisode(events: ActivityEvent[]): ActivityEpisode {
  const first = events[0]!;
  const last = events.at(-1)!;
  const identityEvent = events.find(isWorkEvent) ?? first;
  const identity = identityEvent.id;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  const startSlug = identityEvent.timestamp.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");

  return {
    id: `${startSlug}-${digest}`,
    startTime: first.timestamp,
    endTime: last.timestamp,
    events: [...events],
    applications: uniqueApplications(events)
  };
}

function prepareEpisodeEvents(events: ActivityEvent[], contextLeadMs: number): ActivityEvent[] {
  const firstWorkIndex = events.findIndex(isWorkEvent);
  if (firstWorkIndex < 0) return [];
  let lastWorkIndex = events.length - 1;
  while (lastWorkIndex >= 0 && !isWorkEvent(events[lastWorkIndex]!)) lastWorkIndex -= 1;

  const firstWorkTime = Date.parse(events[firstWorkIndex]!.timestamp);
  let startIndex = firstWorkIndex;
  while (
    startIndex > 0 &&
    firstWorkTime - Date.parse(events[startIndex - 1]!.timestamp) <= contextLeadMs
  ) {
    startIndex -= 1;
  }

  let endIndex = lastWorkIndex;
  if (["screen_slept", "session_locked"].includes(events[lastWorkIndex + 1]?.kind ?? "")) endIndex += 1;
  return compactAdjacentContextEvents(events.slice(startIndex, endIndex + 1));
}

function compactAdjacentContextEvents(events: ActivityEvent[]): ActivityEvent[] {
  const horizons: Partial<Record<ActivityEvent["kind"], number>> = {
    application_activated: 60_000,
    window_changed: 10_000,
    focused_element_changed: 5_000,
    ui_snapshot: 60_000,
    application_terminated: 10_000
  };
  const output: ActivityEvent[] = [];
  for (const event of events) {
    const previous = output.at(-1);
    const horizon = horizons[event.kind];
    if (
      previous &&
      horizon !== undefined &&
      eventFingerprint(previous) === eventFingerprint(event) &&
      Date.parse(event.timestamp) - Date.parse(previous.timestamp) <= horizon
    ) {
      continue;
    }
    output.push(event);
  }
  return output;
}

function signalsTaskContextSwitch(
  current: ActivityEvent[],
  lastWork: ActivityEvent,
  event: ActivityEvent
): boolean {
  const previousApplication = applicationKey(lastWork);
  const nextApplication = applicationKey(event);
  if (previousApplication && nextApplication && previousApplication !== nextApplication) return true;

  const comparableKinds: ActivityEvent["kind"][] = [
    "url_changed",
    "document_context_changed",
    "window_changed"
  ];
  if (!comparableKinds.includes(event.kind)) return false;
  const previousContext = lastMatching(
    current,
    (candidate) => candidate.kind === event.kind && applicationKey(candidate) === nextApplication
  );
  return Boolean(previousContext && eventFingerprint(previousContext) !== eventFingerprint(event));
}

function lastMatching(
  events: ActivityEvent[],
  predicate: (event: ActivityEvent) => boolean
): ActivityEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index]!)) return events[index];
  }
  return undefined;
}

function applicationKey(event: ActivityEvent): string | undefined {
  return event.application?.bundleIdentifier ?? (
    event.application ? `pid:${event.application.processIdentifier}` : undefined
  );
}

function eventFingerprint(event: ActivityEvent): string {
  return JSON.stringify([
    event.kind,
    applicationKey(event),
    event.windowTitle,
    event.element,
    event.visibleText,
    event.browser,
    event.document
  ]);
}

function uniqueApplications(events: ActivityEvent[]): ApplicationDescriptor[] {
  const applications = new Map<string, ApplicationDescriptor>();
  for (const event of events) {
    if (!event.application) continue;
    const key = event.application.bundleIdentifier ?? `pid:${event.application.processIdentifier}`;
    applications.set(key, event.application);
  }
  return [...applications.values()];
}
