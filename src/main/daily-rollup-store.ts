import type { DailyRollupItem } from "@shared/contracts";
import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { historySummaryAsMarkdown } from "@shared/history-links";
import { DailyRollupItemSchema } from "./daily-rollup-schema";
import { ensurePrivateDirectory, writePrivateFile } from "./private-storage";

const DailyRollupIndexSchema = z.array(DailyRollupItemSchema);

export class DailyRollupStore {
  private readonly indexPath: string;
  private cache?: { size: number; modifiedMs: number; items: DailyRollupItem[] };

  constructor(readonly directory: string, legacyDirectory?: string) {
    ensurePrivateDirectory(directory);
    this.indexPath = resolve(directory, "index.json");
    if (legacyDirectory) this.importLegacyDailyRollups(legacyDirectory);
  }

  loadAll(): DailyRollupItem[] {
    if (!existsSync(this.indexPath)) return [];
    try {
      const stats = statSync(this.indexPath);
      if (this.cache?.size === stats.size && this.cache.modifiedMs === stats.mtimeMs) {
        return [...this.cache.items];
      }
      const items = DailyRollupIndexSchema.parse(JSON.parse(readFileSync(this.indexPath, "utf8")))
        .sort((left, right) => right.date.localeCompare(left.date));
      this.cache = { size: stats.size, modifiedMs: stats.mtimeMs, items };
      return [...items];
    } catch (error) {
      console.error("Unable to read daily rollup index", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return [];
    }
  }

  save(item: DailyRollupItem): void {
    const parsed = DailyRollupItemSchema.parse(item);
    const items = this.loadAll().filter((candidate) => candidate.id !== parsed.id);
    items.push(parsed);
    items.sort((left, right) => right.date.localeCompare(left.date));
    writePrivateFile(resolve(this.directory, `${parsed.date}.md`), renderDailyRollupMarkdown(parsed));
    writePrivateFile(this.indexPath, `${JSON.stringify(items, null, 2)}\n`);
    this.cache = undefined;
  }

  replaceAll(input: DailyRollupItem[]): void {
    const items = input.map((item) => DailyRollupItemSchema.parse(item))
      .sort((left, right) => right.date.localeCompare(left.date));
    const retained = new Set(items.map((item) => item.id));
    for (const item of this.loadAll()) {
      if (retained.has(item.id)) continue;
      const path = resolve(this.directory, `${item.date}.md`);
      if (existsSync(path)) unlinkSync(path);
    }
    writePrivateFile(this.indexPath, `${JSON.stringify(items, null, 2)}\n`);
    this.cache = undefined;
  }

  private importLegacyDailyRollups(legacyDirectory: string): void {
    if (existsSync(this.indexPath)) return;
    const legacyIndexPath = resolve(legacyDirectory, "index.json");
    if (!existsSync(legacyIndexPath)) return;
    try {
      const items = DailyRollupIndexSchema.parse(JSON.parse(readFileSync(legacyIndexPath, "utf8")))
        .sort((left, right) => right.date.localeCompare(left.date));
      for (const item of items) {
        writePrivateFile(resolve(this.directory, `${item.date}.md`), renderDailyRollupMarkdown(item));
      }
      writePrivateFile(this.indexPath, `${JSON.stringify(items, null, 2)}\n`);
    } catch (error) {
      console.error("Unable to import legacy version-1 daily rollups", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
    }
  }
}

function renderDailyRollupMarkdown(item: DailyRollupItem): string {
  const sections = [
    renderSection("Themes", item.themes),
    renderSection("Accomplishments", item.accomplishments),
    renderSection("Decisions", item.decisions),
    renderSection("Unfinished work", item.unfinishedWork),
    renderSection("Recurring patterns", item.recurringPatterns)
  ].filter(Boolean).join("\n");

  return `---\nversion: 2\nid: ${JSON.stringify(item.id)}\ndate: ${JSON.stringify(item.date)}\nupdatedAt: ${JSON.stringify(item.updatedAt)}\nsourceTimelineIds: ${JSON.stringify(item.sourceTimelineIds)}\nsourceTimelineRevisions: ${JSON.stringify(item.sourceTimelineRevisions ?? [])}\n---\n\n# ${item.title}\n\n${historySummaryAsMarkdown(item.summary, item.links)}\n\n${sections}`;
}

function renderSection(title: string, entries: string[]): string {
  if (entries.length === 0) return "";
  return `## ${title}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}\n`;
}
