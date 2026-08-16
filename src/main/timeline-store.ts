import type { TimelineItem } from "@shared/contracts";
import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { TimelineItemSchema } from "./timeline-schema";
import { ensurePrivateDirectory, writePrivateFile } from "./private-storage";

const TimelineIndexSchema = z.array(TimelineItemSchema);

export class TimelineStore {
  private readonly indexPath: string;
  private cache?: { size: number; modifiedMs: number; items: TimelineItem[] };

  constructor(readonly directory: string) {
    ensurePrivateDirectory(directory);
    this.indexPath = resolve(directory, "index.json");
  }

  loadAll(): TimelineItem[] {
    if (!existsSync(this.indexPath)) return [];
    try {
      const stats = statSync(this.indexPath);
      if (this.cache?.size === stats.size && this.cache.modifiedMs === stats.mtimeMs) {
        return [...this.cache.items];
      }
      const parsed = TimelineIndexSchema.parse(JSON.parse(readFileSync(this.indexPath, "utf8")));
      const items = parsed.sort(compareTimelineItems);
      this.cache = { size: stats.size, modifiedMs: stats.mtimeMs, items };
      return [...items];
    } catch (error) {
      console.error("Unable to read timeline index", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return [];
    }
  }

  save(item: TimelineItem): void {
    const items = this.loadAll().filter((candidate) => candidate.id !== item.id);
    items.push(TimelineItemSchema.parse(item));
    items.sort(compareTimelineItems);

    writePrivateFile(resolve(this.directory, `${safeFileName(item.id)}.md`), renderTimelineMarkdown(item));
    writePrivateFile(this.indexPath, `${JSON.stringify(items, null, 2)}\n`);
    this.cache = undefined;
  }

  replaceAll(input: TimelineItem[]): void {
    const items = input.map((item) => TimelineItemSchema.parse(item)).sort(compareTimelineItems);
    const retained = new Set(items.map((item) => item.id));
    for (const item of this.loadAll()) {
      if (retained.has(item.id)) continue;
      const path = resolve(this.directory, `${safeFileName(item.id)}.md`);
      if (existsSync(path)) unlinkSync(path);
    }
    writePrivateFile(this.indexPath, `${JSON.stringify(items, null, 2)}\n`);
    this.cache = undefined;
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  return Date.parse(right.startTime) - Date.parse(left.startTime);
}

function renderTimelineMarkdown(item: TimelineItem): string {
  const applications = item.applications.map((application) => application.name);
  return [
    "---",
    "version: 1",
    `id: ${JSON.stringify(item.id)}`,
    `startTime: ${JSON.stringify(item.startTime)}`,
    `endTime: ${JSON.stringify(item.endTime)}`,
    `title: ${JSON.stringify(item.title)}`,
    `description: ${JSON.stringify(item.description)}`,
    `applications: ${JSON.stringify(applications)}`,
    `sourceEventIds: ${JSON.stringify(item.sourceEventIds ?? [])}`,
    `suggestion: ${JSON.stringify(item.suggestion)}`,
    "---",
    "",
    `# ${item.title}`,
    "",
    item.description,
    "",
    renderSection("Work threads", item.workThreads),
    renderSection("Decisions", item.decisions),
    renderSection("Outcomes", item.outcomes),
    renderSection("Blockers", item.blockers),
    renderSection("Surfaces", item.surfaces),
    item.suggestion
      ? `## Suggested ${item.suggestion.type}\n\n**${item.suggestion.name}** — ${item.suggestion.description}\n`
      : ""
  ].filter((line) => line !== "").join("\n") + "\n";
}

function renderSection(title: string, entries: string[]): string {
  if (entries.length === 0) return "";
  return `## ${title}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}\n`;
}
