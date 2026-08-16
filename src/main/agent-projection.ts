import type { DailyRollupItem, TimelineItem } from "@shared/contracts";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ensurePrivateDirectory, writePrivateFile } from "./private-storage";

const MAX_TEXT_LENGTH = 2_000;
const MAX_COLLECTION_LENGTH = 100;

const ProjectedTimelineSchema = z.object({
  id: z.string().min(1).max(256),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  title: z.string().max(MAX_TEXT_LENGTH),
  description: z.string().max(MAX_TEXT_LENGTH),
  applications: z.array(z.string().max(300)).max(MAX_COLLECTION_LENGTH),
  workThreads: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  decisions: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  outcomes: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  blockers: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  surfaces: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  evidenceEventCount: z.number().int().nonnegative()
});

const ProjectedDailyRollupSchema = z.object({
  id: z.string().min(1).max(256),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().max(MAX_TEXT_LENGTH),
  summary: z.string().max(MAX_TEXT_LENGTH),
  themes: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  accomplishments: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  decisions: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  unfinishedWork: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  recurringPatterns: z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_COLLECTION_LENGTH),
  sourceTimelineIds: z.array(z.string().min(1).max(256)).max(2_000),
  updatedAt: z.string().datetime()
});

const AgentProjectionSchema = z.object({
  version: z.literal(2),
  revision: z.string().length(64),
  generatedAt: z.string().datetime(),
  timeline: z.array(ProjectedTimelineSchema),
  dailyRollups: z.array(ProjectedDailyRollupSchema)
});

export type ProjectedTimelineItem = z.infer<typeof ProjectedTimelineSchema>;
export type ProjectedDailyRollupItem = z.infer<typeof ProjectedDailyRollupSchema>;
export type AgentProjection = z.infer<typeof AgentProjectionSchema>;

interface ReadStore<T> {
  loadAll(): T[];
}

export interface ProjectionSearchOptions {
  query: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ProjectionSearchResult {
  kind: "timeline" | "daily_rollup";
  id: string;
  date: string;
  title: string;
  summary: string;
  applications: string[];
  score: number;
  resourceUri: string;
}

export interface ProjectedSurface {
  surface: string;
  timelineIds: string[];
  lastSeen: string;
}

export interface ProjectedUnfinishedWork {
  date: string;
  dailyRollupId: string;
  unfinishedWork: string;
  resourceUri: string;
}

export class AgentProjectionStore {
  private readonly indexPath: string;
  private cached?: AgentProjection;

  constructor(
    readonly directory: string,
    private readonly timelineStore: ReadStore<TimelineItem>,
    private readonly dailyRollupStore: ReadStore<DailyRollupItem>
  ) {
    ensurePrivateDirectory(directory);
    this.indexPath = resolve(directory, "index.json");
  }

  refresh(): AgentProjection {
    const timeline = this.timelineStore.loadAll().map(projectTimelineItem);
    const dailyRollups = this.dailyRollupStore.loadAll().map(projectDailyRollupItem);
    const revision = createHash("sha256")
      .update(JSON.stringify({ timeline, dailyRollups }))
      .digest("hex");
    const existing = this.loadFromDisk();
    if (existing?.revision === revision) {
      this.cached = existing;
      return structuredClone(existing);
    }

    const projection = AgentProjectionSchema.parse({
      version: 2,
      revision,
      generatedAt: new Date().toISOString(),
      timeline,
      dailyRollups
    });
    writePrivateFile(this.indexPath, `${JSON.stringify(projection, null, 2)}\n`);
    this.cached = projection;
    return structuredClone(projection);
  }

  get(): AgentProjection {
    return this.refresh();
  }

  search(options: ProjectionSearchOptions): ProjectionSearchResult[] {
    const projection = this.refresh();
    const terms = searchTerms(options.query);
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    const timelineResults = projection.timeline.flatMap((item): ProjectionSearchResult[] => {
      const date = localDate(item.startTime);
      if (!inRange(date, options.from, options.to)) return [];
      const score = scoreText(timelineSearchText(item), terms);
      if (terms.length > 0 && score === 0) return [];
      return [{
        kind: "timeline",
        id: item.id,
        date,
        title: item.title,
        summary: item.description,
        applications: item.applications,
        score,
        resourceUri: `openhistory://timeline/${encodeURIComponent(item.id)}`
      }];
    });
    const dailyRollupResults = projection.dailyRollups.flatMap((item): ProjectionSearchResult[] => {
      if (!inRange(item.date, options.from, options.to)) return [];
      const score = scoreText(dailyRollupSearchText(item), terms);
      if (terms.length > 0 && score === 0) return [];
      return [{
        kind: "daily_rollup",
        id: item.id,
        date: item.date,
        title: item.title,
        summary: item.summary,
        applications: [],
        score,
        resourceUri: `openhistory://daily-rollup/${encodeURIComponent(item.id)}`
      }];
    });
    return [...timelineResults, ...dailyRollupResults]
      .sort((left, right) => right.score - left.score || right.date.localeCompare(left.date))
      .slice(0, limit);
  }

  getDay(date: string): { date: string; dailyRollup?: ProjectedDailyRollupItem; timeline: ProjectedTimelineItem[] } {
    const projection = this.refresh();
    return {
      date,
      dailyRollup: projection.dailyRollups.find((item) => item.date === date),
      timeline: projection.timeline.filter((item) => localDate(item.startTime) === date)
    };
  }

  getTimelineItem(id: string): ProjectedTimelineItem | undefined {
    return this.refresh().timeline.find((item) => item.id === id);
  }

  findSurfaces(options: ProjectionSearchOptions): ProjectedSurface[] {
    const needle = options.query.trim().toLocaleLowerCase();
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
    const surfaces = new Map<string, ProjectedSurface>();
    for (const item of this.refresh().timeline) {
      const date = localDate(item.startTime);
      if (!inRange(date, options.from, options.to)) continue;
      for (const surface of item.surfaces) {
        if (needle && !surface.toLocaleLowerCase().includes(needle)) continue;
        const key = surface.toLocaleLowerCase();
        const existing = surfaces.get(key) ?? { surface, timelineIds: [], lastSeen: item.startTime };
        if (!existing.timelineIds.includes(item.id)) existing.timelineIds.push(item.id);
        if (item.startTime > existing.lastSeen) existing.lastSeen = item.startTime;
        surfaces.set(key, existing);
      }
    }
    return [...surfaces.values()]
      .sort((left, right) => right.lastSeen.localeCompare(left.lastSeen))
      .slice(0, limit);
  }

  getUnfinishedWork(options: Omit<ProjectionSearchOptions, "query">): ProjectedUnfinishedWork[] {
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
    return this.refresh().dailyRollups.flatMap((dailyRollup) => {
      if (!inRange(dailyRollup.date, options.from, options.to)) return [];
      return dailyRollup.unfinishedWork.map((unfinishedWork) => ({
        date: dailyRollup.date,
        dailyRollupId: dailyRollup.id,
        unfinishedWork,
        resourceUri: `openhistory://daily-rollup/${encodeURIComponent(dailyRollup.id)}`
      }));
    }).slice(0, limit);
  }

  private loadFromDisk(): AgentProjection | undefined {
    if (this.cached) return this.cached;
    if (!existsSync(this.indexPath)) return undefined;
    try {
      return AgentProjectionSchema.parse(JSON.parse(readFileSync(this.indexPath, "utf8")));
    } catch {
      return undefined;
    }
  }
}

export function sanitizeProjectionText(value: string): string {
  let sanitized = Array.from(value).slice(0, MAX_TEXT_LENGTH).join("");
  const replacements: Array<[RegExp, string]> = [
    [/\bsk-[a-z0-9_-]{12,}\b/gi, "[redacted credential]"],
    [/\b[rs]k_(?:live|test)_[a-z0-9]{12,}\b/gi, "[redacted credential]"],
    [/\bgh[pousr]_[a-z0-9]{20,}\b/gi, "[redacted credential]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted credential]"],
    [/\bBearer\s+[a-z0-9._~-]{16,}\b/gi, "Bearer [redacted credential]"],
    [/\b(password|passwd|pwd|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted credential]"],
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted credential]@"],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]"],
    [/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, "[redacted identifier]"]
  ];
  for (const [pattern, replacement] of replacements) sanitized = sanitized.replace(pattern, replacement);
  return sanitized;
}

function projectTimelineItem(item: TimelineItem): ProjectedTimelineItem {
  return ProjectedTimelineSchema.parse({
    id: item.id,
    startTime: item.startTime,
    endTime: item.endTime,
    title: sanitizeProjectionText(item.title),
    description: sanitizeProjectionText(item.description),
    applications: item.applications.slice(0, MAX_COLLECTION_LENGTH)
      .map((application) => sanitizeProjectionText(application.name)),
    workThreads: sanitizeList(item.workThreads),
    decisions: sanitizeList(item.decisions),
    outcomes: sanitizeList(item.outcomes),
    blockers: sanitizeList(item.blockers),
    surfaces: sanitizeList(item.surfaces),
    evidenceEventCount: item.sourceEventIds?.length ?? 0
  });
}

function projectDailyRollupItem(item: DailyRollupItem): ProjectedDailyRollupItem {
  return ProjectedDailyRollupSchema.parse({
    id: item.id,
    date: item.date,
    title: sanitizeProjectionText(item.title),
    summary: sanitizeProjectionText(item.summary),
    themes: sanitizeList(item.themes),
    accomplishments: sanitizeList(item.accomplishments),
    decisions: sanitizeList(item.decisions),
    unfinishedWork: sanitizeList(item.unfinishedWork),
    recurringPatterns: sanitizeList(item.recurringPatterns),
    sourceTimelineIds: item.sourceTimelineIds.slice(0, 2_000),
    updatedAt: item.updatedAt
  });
}

function sanitizeList(values: string[]): string[] {
  return values.slice(0, MAX_COLLECTION_LENGTH).map(sanitizeProjectionText);
}

export function localDate(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function searchTerms(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 20))];
}

function scoreText(text: string, terms: string[]): number {
  if (terms.length === 0) return 1;
  const normalized = text.toLocaleLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function timelineSearchText(item: ProjectedTimelineItem): string {
  return [
    item.title,
    item.description,
    ...item.applications,
    ...item.workThreads,
    ...item.decisions,
    ...item.outcomes,
    ...item.blockers,
    ...item.surfaces
  ].join("\n");
}

function dailyRollupSearchText(item: ProjectedDailyRollupItem): string {
  return [
    item.title,
    item.summary,
    ...item.themes,
    ...item.accomplishments,
    ...item.decisions,
    ...item.unfinishedWork,
    ...item.recurringPatterns
  ].join("\n");
}

function inRange(date: string, from?: string, to?: string): boolean {
  return (!from || date >= from) && (!to || date <= to);
}
