import { defaultOpenHistoryDataDirectory } from "./lib/data-directory";
import type { HourItem, DailyRollupItem, TimelineItem } from "../src/shared/contracts";
import { config as loadDotEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadActivityEvents } from "../src/main/activity-event-file";
import { segmentActivityEvents } from "../src/main/episode-segmenter";
import { HourItemSchema } from "../src/main/hour-schema";
import { DailyRollupItemSchema } from "../src/main/daily-rollup-schema";
import { OpenAIService } from "../src/main/openai-service";
import { TimelineItemSchema } from "../src/main/timeline-schema";

const dataDirectory = process.argv[2] ?? defaultOpenHistoryDataDirectory();
const sampleSize = 5;

loadDotEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

const service = new OpenAIService({
  apiKey,
  model: process.env.OPENAI_MODEL?.trim() || "gpt-5.6"
});
const timeline = TimelineItemSchema.array().parse(readIndex("timeline"));
const hours = HourItemSchema.array().parse(readIndex("hours"));
const dailyRollups = DailyRollupItemSchema.array().parse(readIndex("daily-rollups"));
const latestHour = [...hours].sort(newestStartFirst)[0];
const latestDailyRollup = [...dailyRollups].sort((left, right) => right.date.localeCompare(left.date))[0];
if (!latestHour || !latestDailyRollup) throw new Error("Current hour and daily summaries are required for comparison");

const timelineById = new Map(timeline.map((item) => [item.id, item]));
const hourTimeline = latestHour.sourceTimelineIds
  .map((id) => timelineById.get(id))
  .filter((item): item is TimelineItem => Boolean(item))
  .sort(newestStartFirst);
const dayTimeline = latestDailyRollup.sourceTimelineIds
  .map((id) => timelineById.get(id))
  .filter((item): item is TimelineItem => Boolean(item))
  .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
if (hourTimeline.length === 0 || dayTimeline.length === 0) throw new Error("Source timeline entries are unavailable");

const episodesById = new Map(
  segmentActivityEvents(loadActivityEvents(dataDirectory)).map((episode) => [episode.id, episode])
);
const historySample = hourTimeline
  .filter((item) => episodesById.has(item.id))
  .slice(0, sampleSize);
if (historySample.length === 0) throw new Error("Source episodes are unavailable for recent history entries");

const regeneratedHistory: TimelineItem[] = [];
for (const item of historySample) {
  const episode = episodesById.get(item.id);
  if (!episode) continue;
  regeneratedHistory.push(await service.summarizeEpisode(episode));
}

const lastHour = hours.find((item) => Date.parse(item.endTime) === Date.parse(latestHour.startTime));
const regeneratedHour = await service.consolidateHour(
  latestHour.startTime,
  latestHour.endTime,
  [...hourTimeline].reverse(),
  lastHour
);
const regeneratedDailyRollup = await service.consolidateDailyRollup(latestDailyRollup.date, dayTimeline, latestDailyRollup);

const regeneratedById = new Map(regeneratedHistory.map((item) => [item.id, item]));
const result = {
  generatedAt: new Date().toISOString(),
  model: service.model,
  methodology: {
    history: `${historySample.length} recent entries regenerated from their raw activity episodes`,
    hour: `${hourTimeline.length} current history entries regenerated with the adjacent lastHour as context`,
    day: `${dayTimeline.length} current history entries regenerated with the current daily rollup as a prior draft`
  },
  history: historySample.map((item) => ({
    startTime: item.startTime,
    endTime: item.endTime,
    current: timelineProjection(item),
    regenerated: timelineProjection(regeneratedById.get(item.id)!)
  })),
  hour: {
    startTime: latestHour.startTime,
    endTime: latestHour.endTime,
    current: hourProjection(latestHour),
    regenerated: hourProjection(regeneratedHour)
  },
  day: {
    date: latestDailyRollup.date,
    current: dailyRollupProjection(latestDailyRollup),
    regenerated: dailyRollupProjection(regeneratedDailyRollup)
  }
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function readIndex(kind: "timeline" | "hours" | "daily-rollups"): unknown {
  return JSON.parse(readFileSync(resolve(dataDirectory, kind, "index.json"), "utf8"));
}

function newestStartFirst(left: { startTime: string }, right: { startTime: string }): number {
  return Date.parse(right.startTime) - Date.parse(left.startTime);
}

function timelineProjection(item: TimelineItem): object {
  return {
    title: item.title,
    description: item.description,
    workThreads: item.workThreads,
    decisions: item.decisions,
    outcomes: item.outcomes,
    blockers: item.blockers,
    surfaces: item.surfaces
  };
}

function hourProjection(item: HourItem): object {
  return {
    title: item.title,
    summary: item.summary,
    workThreads: item.workThreads,
    decisions: item.decisions,
    outcomes: item.outcomes,
    blockers: item.blockers,
    surfaces: item.surfaces
  };
}

function dailyRollupProjection(item: DailyRollupItem): object {
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
