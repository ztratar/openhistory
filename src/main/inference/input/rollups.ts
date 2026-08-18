import type { DailyRollupItem, HistoryLink, HourItem, TimelineApplication, TimelineItem } from "@shared/contracts";
import {
  historyLinkCandidatesForModel,
  rollupLinkCandidates
} from "../../history-links";
export function hourForHybridModel(timelineItems: TimelineItem[], lastHour?: HourItem): object {
  const importantLinkCandidates = rollupLinkCandidates(timelineItems);
  return {
    priorHourContextOnly: lastHour ? { title: lastHour.title, summary: lastHour.summary } : null,
    currentHourEntryCount: timelineItems.length,
    importantLinkCandidates: historyLinkCandidatesForModel(importantLinkCandidates),
    currentHourEntries: timelineItems.map((item, index) => ({
      sequence: index + 1,
      title: item.title,
      description: item.description,
      workThreads: item.workThreads,
      decisions: item.decisions,
      outcomes: item.outcomes,
      blockers: item.blockers,
      surfaces: item.surfaces
    })),
    rollupRules: {
      coverage: "Preserve every materially distinct current-hour workstream once; merge repetition.",
      status: "Only demonstrated outcomes are outcomes. Drafts and requests remain drafts and requests.",
      priorHour: "Use only to understand continuity; never copy unsupported facts into the current hour."
    }
  };
}

export function appleSemanticHourPrompt(timelineItems: TimelineItem[], lastHour?: HourItem): string {
  const prior = lastHour ? `${lastHour.title}: ${singleLine(lastHour.summary)}` : "none";
  const perEntryBudget = Math.max(180, Math.min(520, Math.floor(5_600 / timelineItems.length)));
  const facts = timelineItems.map((item, index) => {
    const supported = [
      item.decisions.length ? `Supported decisions or requests: ${item.decisions.join("; ")}` : "",
      item.outcomes.length ? `Demonstrated outcomes: ${item.outcomes.join("; ")}` : "",
      item.blockers.length ? `Explicit blockers: ${item.blockers.join("; ")}` : ""
    ].filter(Boolean).join("\n");
    return truncateBrief(
      `${index + 1}. ${item.title}\n${item.description}${supported ? `\n${supported}` : ""}`,
      perEntryBudget
    );
  }).join("\n\n");
  const links = semanticLinkCandidates(timelineItems);
  return truncateBrief(`Write the current-hour rollup in English. There are ${timelineItems.length} factual source entries. The prior hour is context only and cannot prove current work. Group related entries, preserve each materially distinct current-hour workstream once, and never turn a draft or request into an implemented result.\n\nPrior hour context only:\n${prior}\n\nCurrent-hour factual entries:\n${facts}\n\nImportant link candidates:\n${links}`, 7_500);
}

export function appleSemanticDailyRollupPrompt(
  hours: HourItem[],
  unrolledTimeline: TimelineItem[],
  existing?: DailyRollupItem
): string {
  const perHourBudget = Math.max(220, Math.min(520, Math.floor(6_000 / Math.max(1, hours.length))));
  const hourLines = hours.map((hour, index) =>
    truncateBrief(`${index + 1}. ${hour.title}. ${singleLine(hour.summary)}${structuredFacts(hour)}`, perHourBudget)
  );
  const sessionLines = unrolledTimeline.map((item, index) =>
    truncateBrief(`${index + 1}. ${item.title}. ${item.description}${structuredFacts(item)}`, 320)
  );
  const links = semanticLinkCandidates([...hours, ...unrolledTimeline]);
  return truncateBrief(`Write the day's factual rollup in English. There are ${hours.length} hour rollups and ${unrolledTimeline.length} additional sessions. Organize by meaningful workstream, not chronology or applications. Preserve every substantial source once, merge repetition, and never turn drafted requests into completed accomplishments. The prior draft is context only and cannot prove facts.\n\nPrior draft context only:\n${existing ? truncateBrief(`${existing.title}: ${singleLine(existing.summary)}`, 500) : "none"}\n\nCurrent hour rollups:\n${hourLines.join("\n\n") || "none"}\n\nCurrent sessions not represented by an hour:\n${sessionLines.join("\n\n") || "none"}\n\nImportant link candidates:\n${links}`, 8_200);
}

function semanticLinkCandidates(sources: Array<{ links?: HistoryLink[] }>): string {
  const candidates = rollupLinkCandidates(sources);
  if (!candidates.length) return "none";
  return candidates.map(({ reference, label, domain }) =>
    `${reference}: “${label}” (${domain})`
  ).join("\n");
}

function structuredFacts(item: TimelineItem | HourItem): string {
  const values = [
    item.decisions.length ? ` Decisions: ${item.decisions.join("; ")}.` : "",
    item.outcomes.length ? ` Demonstrated outcomes: ${item.outcomes.join("; ")}.` : "",
    item.blockers.length ? ` Blockers: ${item.blockers.join("; ")}.` : "",
    item.surfaces.length ? ` Surfaces: ${item.surfaces.join("; ")}.` : ""
  ];
  return values.join("");
}

function singleLine(value: string): string {
  return value.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

function truncateBrief(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
}

export function timelineItemForModel(item: TimelineItem): object {
  return {
    startTime: item.startTime,
    endTime: item.endTime,
    title: item.title,
    description: item.description,
    applications: item.applications.map((application) => application.name),
    workThreads: item.workThreads,
    decisions: item.decisions,
    outcomes: item.outcomes,
    blockers: item.blockers,
    surfaces: item.surfaces
  };
}

export function hourForModel(item: HourItem): object {
  return {
    startTime: item.startTime,
    endTime: item.endTime,
    title: item.title,
    summary: item.summary,
    applications: item.applications.map((application) => application.name),
    workThreads: item.workThreads,
    decisions: item.decisions,
    outcomes: item.outcomes,
    blockers: item.blockers,
    surfaces: item.surfaces
  };
}

export function uniqueTimelineApplications(items: TimelineItem[]): TimelineApplication[] {
  const applications = new Map<string, TimelineApplication>();
  for (const item of items) {
    for (const application of item.applications) {
      const key = application.bundleIdentifier ?? application.name;
      if (!applications.has(key)) applications.set(key, application);
    }
  }
  return [...applications.values()];
}

export function dailyEvidenceSummary(items: TimelineItem[]): object {
  const applicationCounts = new Map<string, number>();
  let durationMinutes = 0;
  let decisions = 0;
  let outcomes = 0;
  let blockers = 0;
  for (const item of items) {
    durationMinutes += Math.max(0, (Date.parse(item.endTime) - Date.parse(item.startTime)) / 60_000);
    decisions += item.decisions.length;
    outcomes += item.outcomes.length;
    blockers += item.blockers.length;
    for (const application of item.applications) {
      applicationCounts.set(application.name, (applicationCounts.get(application.name) ?? 0) + 1);
    }
  }
  return {
    timelineEntryCount: items.length,
    observedDurationMinutes: Math.round(durationMinutes),
    applications: [...applicationCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20)
      .map(([name, entryCount]) => ({ name, entryCount })),
    decisionCount: decisions,
    outcomeCount: outcomes,
    blockerCount: blockers
  };
}

export function dailyRollupForModel(item: DailyRollupItem): object {
  return {
    title: item.title,
    summary: item.summary,
    themes: item.themes,
    accomplishments: item.accomplishments,
    decisions: item.decisions,
    unfinishedWork: item.unfinishedWork,
    recurringPatterns: item.recurringPatterns
  };
}
