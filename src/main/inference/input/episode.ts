import type { ActivityEpisode } from "@shared/contracts";
import { buildEpisodeEvidencePacket } from "../../episode-evidence";
export function episodeForModel(episode: ActivityEpisode): object {
  const observations = eventsForModel(episode);
  return {
    startTime: episode.startTime,
    endTime: episode.endTime,
    applications: episode.applications.map((application) => ({
      name: application.localizedName
    })),
    evidenceSummary: evidenceSummary(observations, episode.startTime, episode.endTime),
    observations: observations.map((event) => ({
      timestamp: event.timestamp,
      kind: semanticKindForModel(event),
      evidenceStrength: evidenceStrength(event),
      application: event.application?.localizedName,
      windowTitle: event.windowTitle?.slice(0, 500),
      focusedElement: event.element,
      selectedElements: event.selectedElements?.slice(0, 10),
      textChange: event.textChange ? {
        insertedText: event.textChange.insertedText.slice(0, 1_200),
        deletedCharacterCount: event.textChange.deletedCharacterCount,
        resultingValue: event.textChange.resultingValue.slice(0, 2_000)
      } : undefined,
      browser: event.browser,
      document: event.document,
      visibleText: event.visibleText?.slice(0, 30)
    }))
  };
}

export function episodeForHybridModel(episode: ActivityEpisode): object {
  const source = withoutAbsoluteTimestamps(episodeForModel(episode)) as Record<string, unknown>;
  return {
    ...source,
    semanticGuide: buildEpisodeEvidencePacket(episode)
  };
}

function withoutAbsoluteTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAbsoluteTimestamps);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["startTime", "endTime", "timestamp"].includes(key))
    .map(([key, entry]) => [key, withoutAbsoluteTimestamps(entry)]));
}

export function episodeForAppleModel(episode: ActivityEpisode): object {
  const observations = eventsForModel(episode);
  const material = observations.filter((event) => evidenceStrength(event) !== "context");
  const selected = material.length ? evenlySpacedValues(material, Math.min(12, material.length)) : observations.slice(0, 4);
  return {
    startTime: episode.startTime,
    endTime: episode.endTime,
    applications: episode.applications.map((application) => application.localizedName).filter(Boolean),
    evidenceSummary: evidenceSummary(observations, episode.startTime, episode.endTime),
    observations: selected.map((event) => ({
      kind: semanticKindForModel(event),
      evidenceStrength: evidenceStrength(event),
      application: event.application?.localizedName,
      windowTitle: event.windowTitle?.slice(0, 180),
      focusedElement: event.element ? {
        role: event.element.role,
        title: event.element.title?.slice(0, 180),
        value: event.element.value?.slice(0, 240)
      } : undefined,
      selectedElements: event.selectedElements?.slice(0, 4),
      textChange: event.textChange ? {
        insertedText: event.textChange.insertedText.slice(0, 500),
        deletedCharacterCount: event.textChange.deletedCharacterCount
      } : undefined,
      browser: event.browser ? {
        domain: event.browser.domain,
        title: event.browser.title?.slice(0, 180)
      } : undefined,
      document: event.document ? {
        name: event.document.name,
        displayPath: event.document.displayPath?.slice(0, 240)
      } : undefined
    }))
  };
}

export function appleEpisodePrompt(episode: ActivityEpisode): string {
  const value = episodeForAppleModel(episode) as {
    startTime: string;
    endTime: string;
    applications: string[];
    evidenceSummary: { summaryMode: string; durationSeconds: number; directActionCount: number; contentChangeCount: number };
    observations: Array<Record<string, unknown>>;
  };
  const lines = value.observations.map((observation, index) =>
    `${index + 1}. ${humanObservation(observation)}`
  );
  return `Write the work-history entry in English. Focus on what the person meaningfully did, not telemetry.\nApplications present: ${value.applications.join(", ") || "none identified"}\nCalibration: ${value.evidenceSummary.summaryMode}; ${value.evidenceSummary.durationSeconds}s; ${value.evidenceSummary.directActionCount} direct actions; ${value.evidenceSummary.contentChangeCount} content changes.\nObserved evidence:\n${lines.join("\n") || "No direct action was observed."}`;
}

function humanObservation(observation: Record<string, unknown>): string {
  const parts = [
    typeof observation.evidenceStrength === "string" ? observation.evidenceStrength.replaceAll("_", " ") : undefined,
    typeof observation.kind === "string" ? observation.kind.replaceAll("_", " ") : undefined,
    typeof observation.application === "string" ? `in ${observation.application}` : undefined,
    typeof observation.windowTitle === "string" ? `on ${observation.windowTitle}` : undefined
  ];
  const element = observation.focusedElement as { role?: string; title?: string; value?: string } | undefined;
  if (element?.title) parts.push(`control “${element.title}”`);
  if (element?.value) parts.push(`value “${element.value}”`);
  const text = observation.textChange as { insertedText?: string; deletedCharacterCount?: number } | undefined;
  if (text?.insertedText) parts.push(`entered “${text.insertedText}”`);
  if (text?.deletedCharacterCount) parts.push(`deleted ${text.deletedCharacterCount} characters`);
  const browser = observation.browser as { domain?: string; title?: string } | undefined;
  if (browser?.title || browser?.domain) parts.push(`page “${browser.title ?? browser.domain}”`);
  const document = observation.document as { name?: string; displayPath?: string } | undefined;
  if (document?.name || document?.displayPath) parts.push(`document “${document.name ?? document.displayPath}”`);
  return parts.filter(Boolean).join("; ");
}

function evenlySpacedValues<T>(values: T[], count: number): T[] {
  if (count >= values.length) return [...values];
  if (count <= 1) return values.length ? [values[Math.floor(values.length / 2)]!] : [];
  return Array.from({ length: count }, (_entry, index) =>
    values[Math.round((index * (values.length - 1)) / (count - 1))]!
  );
}

export function semanticKindForModel(
  event: ActivityEpisode["events"][number]
): ActivityEpisode["events"][number]["kind"] {
  return event.kind === "text_input" && (event.textChange?.deletedCharacterCount ?? 0) >= 500
    ? "document_changed"
    : event.kind;
}

function evidenceStrength(
  event: ActivityEpisode["events"][number]
): "direct_action" | "navigation" | "context" | "boundary" {
  if (["screen_slept", "screen_woke", "session_locked", "session_unlocked"].includes(event.kind)) {
    return "boundary";
  }
  if (["selection_changed", "text_input", "document_changed", "pointer_click"].includes(event.kind)) {
    return "direct_action";
  }
  return ["url_changed", "document_context_changed"].includes(event.kind) ? "navigation" : "context";
}

export function eventsForModel(episode: ActivityEpisode): ActivityEpisode["events"] {
  const compactedEvents = compactModelContext(episode.events);
  const limits: Partial<Record<ActivityEpisode["events"][number]["kind"], number>> = {
    application_activated: 30,
    window_changed: 40,
    ui_snapshot: 12,
    pointer_click: 80,
    focused_element_changed: 60,
    selection_changed: 60,
    text_input: 60,
    document_changed: 30,
    url_changed: 30,
    document_context_changed: 30,
    application_terminated: 10,
    session_locked: 10,
    session_unlocked: 10
  };
  const indicesByKind = new Map<ActivityEpisode["events"][number]["kind"], number[]>();
  compactedEvents.forEach((event, index) => {
    const indices = indicesByKind.get(event.kind) ?? [];
    indices.push(index);
    indicesByKind.set(event.kind, indices);
  });

  const includedIndices = new Set<number>();
  for (const [kind, indices] of indicesByKind) {
    const limit = limits[kind];
    if (!limit || indices.length <= limit) {
      indices.forEach((index) => includedIndices.add(index));
      continue;
    }
    for (let slot = 0; slot < limit; slot += 1) {
      const position = Math.round((slot * (indices.length - 1)) / (limit - 1));
      includedIndices.add(indices[position]!);
    }
  }
  return compactedEvents.filter((_event, index) => includedIndices.has(index));
}

function compactModelContext(events: ActivityEpisode["events"]): ActivityEpisode["events"] {
  const compactable = new Set<ActivityEpisode["events"][number]["kind"]>([
    "application_activated",
    "window_changed",
    "focused_element_changed",
    "ui_snapshot"
  ]);
  const output: ActivityEpisode["events"] = [];
  for (const event of events) {
    const previous = output.at(-1);
    if (
      previous &&
      compactable.has(event.kind) &&
      modelContextFingerprint(previous) === modelContextFingerprint(event)
    ) {
      continue;
    }
    output.push(event);
  }
  return output;
}

function modelContextFingerprint(event: ActivityEpisode["events"][number]): string {
  return JSON.stringify([
    event.kind,
    event.application?.bundleIdentifier,
    event.windowTitle,
    event.element,
    event.visibleText
  ]);
}

function evidenceSummary(
  events: ActivityEpisode["events"],
  startTime: string,
  endTime: string
): object {
  const counts: Record<string, number> = {};
  let directActionCount = 0;
  let navigationCount = 0;
  let contextCount = 0;
  let contentChangeCount = 0;
  for (const event of events) {
    const kind = semanticKindForModel(event);
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (kind === "text_input" || kind === "document_changed") contentChangeCount += 1;
    if (evidenceStrength(event) === "direct_action") directActionCount += 1;
    else if (evidenceStrength(event) === "navigation") navigationCount += 1;
    else if (evidenceStrength(event) === "context") contextCount += 1;
  }

  const sequence: Array<{ offsetSeconds: number; kind: string; application?: string }> = [];
  for (const event of events) {
    const item = {
      offsetSeconds: Math.max(0, Math.round((Date.parse(event.timestamp) - Date.parse(startTime)) / 1_000)),
      kind: semanticKindForModel(event),
      ...(event.application?.localizedName ? { application: event.application.localizedName } : {})
    };
    const previous = sequence.at(-1);
    if (previous?.kind === item.kind && previous.application === item.application) continue;
    sequence.push(item);
    if (sequence.length >= 40) break;
  }

  const durationSeconds = Math.max(0, Math.round((Date.parse(endTime) - Date.parse(startTime)) / 1_000));
  const summaryMode = directActionCount === 0 && navigationCount === 0 && contentChangeCount === 0
    ? "context_only"
    : durationSeconds < 30 && contentChangeCount === 0
      ? "sparse_literal"
      : "standard";
  return {
    durationSeconds,
    summaryMode,
    observationCounts: counts,
    directActionCount,
    navigationCount,
    contextCount,
    contentChangeCount,
    actionSurfaces: actionSurfaceSummary(events),
    sequence
  };
}

function actionSurfaceSummary(events: ActivityEpisode["events"]): Array<{
  application: string;
  surface?: string;
  directActionCount: number;
  navigationCount: number;
  contentChangeCount: number;
}> {
  const surfaces = new Map<string, {
    application: string;
    surface?: string;
    directActionCount: number;
    navigationCount: number;
    contentChangeCount: number;
  }>();
  for (const event of events) {
    const strength = evidenceStrength(event);
    if (strength !== "direct_action" && strength !== "navigation") continue;
    const application = event.application?.localizedName ?? "Unknown application";
    const surface = event.document?.name
      ?? event.browser?.title
      ?? event.browser?.domain
      ?? event.windowTitle;
    const key = JSON.stringify([application, surface]);
    const existing = surfaces.get(key) ?? {
      application,
      ...(surface ? { surface: surface.slice(0, 300) } : {}),
      directActionCount: 0,
      navigationCount: 0,
      contentChangeCount: 0
    };
    if (strength === "direct_action") existing.directActionCount += 1;
    if (strength === "navigation") existing.navigationCount += 1;
    const kind = semanticKindForModel(event);
    if (kind === "text_input" || kind === "document_changed") existing.contentChangeCount += 1;
    surfaces.set(key, existing);
  }
  return [...surfaces.values()].slice(0, 24);
}
