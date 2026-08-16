import type { HourItem } from "@shared/contracts";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { HourItemSchema } from "./hour-schema";
import { historySummaryAsMarkdown } from "@shared/history-links";
import { ensurePrivateDirectory, writePrivateFile } from "./private-storage";

const HourIndexSchema = z.array(HourItemSchema);

export class HourStore {
  private readonly indexPath: string;
  private cache?: { size: number; modifiedMs: number; items: HourItem[] };

  constructor(readonly directory: string) {
    ensurePrivateDirectory(directory);
    this.indexPath = resolve(directory, "index.json");
  }

  loadAll(): HourItem[] {
    if (!existsSync(this.indexPath)) return [];
    try {
      const stats = statSync(this.indexPath);
      if (this.cache?.size === stats.size && this.cache.modifiedMs === stats.mtimeMs) {
        return [...this.cache.items];
      }
      const items = HourIndexSchema.parse(JSON.parse(readFileSync(this.indexPath, "utf8")))
        .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));
      this.cache = { size: stats.size, modifiedMs: stats.mtimeMs, items };
      return [...items];
    } catch (error) {
      console.error("Unable to read hour index", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return [];
    }
  }

  save(item: HourItem): void {
    const parsed = HourItemSchema.parse(item);
    const items = this.loadAll().filter((candidate) => candidate.id !== parsed.id);
    items.push(parsed);
    items.sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));
    writePrivateFile(resolve(this.directory, `${safeFileName(parsed.id)}.md`), renderHourMarkdown(parsed));
    writePrivateFile(this.indexPath, `${JSON.stringify(items, null, 2)}\n`);
    this.cache = undefined;
  }

  replaceAll(input: HourItem[]): void {
    const items = input.map((item) => HourItemSchema.parse(item))
      .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));
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

function renderHourMarkdown(item: HourItem): string {
  const sections = [
    renderSection("Work threads", item.workThreads),
    renderSection("Decisions", item.decisions),
    renderSection("Outcomes", item.outcomes),
    renderSection("Blockers", item.blockers),
    renderSection("Surfaces", item.surfaces)
  ].filter(Boolean).join("\n");
  return `---\nversion: 1\nid: ${JSON.stringify(item.id)}\nstartTime: ${JSON.stringify(item.startTime)}\nendTime: ${JSON.stringify(item.endTime)}\nupdatedAt: ${JSON.stringify(item.updatedAt)}\napplications: ${JSON.stringify(item.applications.map(({ name }) => name))}\nsourceTimelineIds: ${JSON.stringify(item.sourceTimelineIds)}\nsourceTimelineRevisions: ${JSON.stringify(item.sourceTimelineRevisions)}\n---\n\n# ${item.title}\n\n${historySummaryAsMarkdown(item.summary, item.links)}\n\n${sections}`;
}

function renderSection(title: string, entries: string[]): string {
  if (entries.length === 0) return "";
  return `## ${title}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}\n`;
}
