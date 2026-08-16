import type { ActivityEvent } from "@shared/contracts";
import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  ActivityPrivacyFilter,
  type ActivityPrivacyOptions,
  filterProtectedActivityEvents,
  isProtectedActivityEvent
} from "./privacy-policy";

const MAX_EVENT_LINE_CHARACTERS = 256 * 1_024;
const ACTIVITY_EVENT_KINDS = [
  "collector_started",
  "application_activated",
  "window_changed",
  "focused_element_changed",
  "selection_changed",
  "text_input",
  "document_changed",
  "pointer_click",
  "url_changed",
  "document_context_changed",
  "ui_snapshot",
  "application_terminated",
  "screen_slept",
  "screen_woke",
  "session_locked",
  "session_unlocked",
  "privacy_boundary"
] as const satisfies readonly ActivityEvent["kind"][];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const boundedString = (maximum: number) => z.string().max(maximum);
const semanticElementSchema = z.object({
  role: boundedString(200).optional(),
  subrole: boundedString(200).optional(),
  title: boundedString(1_000).optional(),
  label: boundedString(1_000).optional(),
  identifier: boundedString(600).optional(),
  value: boundedString(4_000).optional()
});
const activityEventSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(128),
  timestamp: z.string().max(40).refine(
    (value) => ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
  ),
  kind: z.enum(ACTIVITY_EVENT_KINDS),
  application: z.object({
    bundleIdentifier: boundedString(500).nullable().optional(),
    localizedName: boundedString(500).nullable().optional(),
    processIdentifier: z.number().int()
  }).optional(),
  windowTitle: boundedString(2_000).optional(),
  accessibilityTrusted: z.boolean().optional(),
  pointerCaptureAvailable: z.boolean().optional(),
  element: semanticElementSchema.optional(),
  selectedElements: z.array(semanticElementSchema).max(20).optional(),
  textChange: z.object({
    insertedText: boundedString(4_000),
    deletedCharacterCount: z.number().int().nonnegative().max(1_000_000_000),
    resultingValue: boundedString(8_000)
  }).optional(),
  browser: z.object({
    url: boundedString(4_000),
    domain: boundedString(500),
    title: boundedString(2_000).optional()
  }).optional(),
  document: z.object({
    displayPath: boundedString(2_000),
    name: boundedString(1_000),
    fileExtension: boundedString(100).optional()
  }).optional(),
  visibleText: z.array(boundedString(1_000)).max(100).optional()
});
const EVENT_FILE_CACHE_LIMIT = 128;
const eventFileCache = new Map<string, {
  size: number;
  modifiedMs: number;
  captureEmailActivity: boolean;
  events: ActivityEvent[];
  trailingBytes: Buffer;
}>();

export function parseActivityEvent(
  line: string,
  options: ActivityPrivacyOptions = {}
): ActivityEvent | undefined {
  const event = parseRawActivityEvent(line);
  return event && !isProtectedActivityEvent(event, options) ? event : undefined;
}

export function parseRawActivityEvent(line: string): ActivityEvent | undefined {
  if (line.length > MAX_EVENT_LINE_CHARACTERS) return undefined;
  try {
    const parsed = activityEventSchema.safeParse(JSON.parse(line));
    if (!parsed.success) return undefined;
    return parsed.data as ActivityEvent;
  } catch {
    return undefined;
  }
}

export function loadActivityEvents(
  dataDirectory: string,
  limit?: number,
  options: ActivityPrivacyOptions = {}
): ActivityEvent[] {
  try {
    const files = readdirSync(dataDirectory)
      .filter((name) => name.startsWith("events-") && name.endsWith(".jsonl"))
      .sort();
    const events = limit === undefined
      ? loadAllEvents(dataDirectory, files, options)
      : loadNewestEvents(dataDirectory, files, Math.max(0, limit), options);

    const sorted = [...events.values()].sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    );
    const protectedFiltered = filterProtectedActivityEvents(sorted, options);
    return limit === undefined ? protectedFiltered : protectedFiltered.slice(-limit);
  } catch {
    return [];
  }
}

export function scrubProtectedActivityEvents(
  dataDirectory: string,
  options: ActivityPrivacyOptions = {}
): number {
  let removed = 0;
  let files: string[];
  try {
    files = readdirSync(dataDirectory)
      .filter((name) => name.startsWith("events-") && name.endsWith(".jsonl"))
      .sort();
  } catch {
    return 0;
  }

  const privacyFilter = new ActivityPrivacyFilter(options);
  for (const file of files) {
    const path = resolve(dataDirectory, file);
    const lines = readFileSync(path, "utf8").split("\n");
    let changed = false;
    const kept = lines.flatMap((line): string[] => {
      if (!line) return [];
      const event = parseRawActivityEvent(line);
      if (!event) return [line];
      const filtered = privacyFilter.filter([event]);
      if (filtered.length === 1 && filtered[0] === event) return [line];
      changed = true;
      removed += 1;
      return filtered.map((candidate) => JSON.stringify(candidate));
    });
    if (!changed) continue;

    const temporaryPath = `${path}.privacy-scrub-${process.pid}`;
    writeFileSync(temporaryPath, kept.length ? `${kept.join("\n")}\n` : "", { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    eventFileCache.delete(path);
  }
  return removed;
}

function loadAllEvents(
  dataDirectory: string,
  files: string[],
  options: ActivityPrivacyOptions
): Map<string, ActivityEvent> {
  const events = new Map<string, ActivityEvent>();
  for (const file of files) {
    for (const event of parsedFileEvents(dataDirectory, file, options)) events.set(event.id, event);
  }
  return events;
}

function loadNewestEvents(
  dataDirectory: string,
  files: string[],
  limit: number,
  options: ActivityPrivacyOptions
): Map<string, ActivityEvent> {
  const events = new Map<string, ActivityEvent>();
  if (limit === 0) return events;

  newestFiles: for (const file of [...files].reverse()) {
    for (const event of [...parsedFileEvents(dataDirectory, file, options)].reverse()) {
      if (events.has(event.id)) continue;
      events.set(event.id, event);
      if (events.size >= limit) break newestFiles;
    }
  }
  return events;
}

function parsedFileEvents(
  dataDirectory: string,
  file: string,
  options: ActivityPrivacyOptions
): ActivityEvent[] {
  const path = resolve(dataDirectory, file);
  const stats = statSync(path);
  const cached = eventFileCache.get(path);
  const captureEmailActivity = options.captureEmailActivity ?? false;
  if (cached?.size === stats.size && cached.modifiedMs === stats.mtimeMs &&
      cached.captureEmailActivity === captureEmailActivity) return cached.events;

  let events: ActivityEvent[];
  let trailingBytes: Buffer;
  if (cached && cached.captureEmailActivity === captureEmailActivity && stats.size > cached.size) {
    const appended = readFileRange(path, cached.size, stats.size - cached.size);
    const parsed = parseEventChunk(Buffer.concat([cached.trailingBytes, appended]));
    events = [...cached.events, ...parsed.events];
    trailingBytes = parsed.trailingBytes;
  } else {
    const parsed = parseEventChunk(readFileSync(path));
    events = parsed.events;
    trailingBytes = parsed.trailingBytes;
  }
  eventFileCache.delete(path);
  eventFileCache.set(path, {
    size: stats.size,
    modifiedMs: stats.mtimeMs,
    captureEmailActivity,
    events,
    trailingBytes
  });
  while (eventFileCache.size > EVENT_FILE_CACHE_LIMIT) {
    const oldest = eventFileCache.keys().next().value as string | undefined;
    if (!oldest) break;
    eventFileCache.delete(oldest);
  }
  return events;
}

function readFileRange(path: string, offset: number, length: number): Buffer {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const count = readSync(descriptor, buffer, bytesRead, length - bytesRead, offset + bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function parseEventChunk(bytes: Buffer): {
  events: ActivityEvent[];
  trailingBytes: Buffer;
} {
  const finalNewline = bytes.lastIndexOf(0x0a);
  const completeBytes = finalNewline >= 0 ? bytes.subarray(0, finalNewline) : Buffer.alloc(0);
  const unterminated = finalNewline >= 0 ? bytes.subarray(finalNewline + 1) : bytes;
  const events = completeBytes.toString("utf8").split("\n").flatMap((line) => {
    const event = line ? parseRawActivityEvent(line) : undefined;
    return event ? [event] : [];
  });
  if (unterminated.length === 0) return { events, trailingBytes: Buffer.alloc(0) };

  const finalEvent = parseRawActivityEvent(unterminated.toString("utf8"));
  return finalEvent
    ? { events: [...events, finalEvent], trailingBytes: Buffer.alloc(0) }
    : { events, trailingBytes: Buffer.from(unterminated) };
}
