import { z } from "zod";
import { HistoryLinkSchema, LinkReferencesSchema } from "./history-link-schema";
import { TimelineApplicationSchema } from "./timeline-schema";

export const HourDraftSchema = z.object({
  title: z.string().min(1).max(120).describe(
    "A specific 4–10 word title beginning with a concrete past-tense verb and naming the dominant object, outcome, or workstream."
  ),
  summary: z.string().min(1).max(1_000).describe(
    "One to four concise, prioritized bullet points for human scanning, separated by newlines and each prefixed with '- '."
  ),
  workThreads: z.array(z.string().min(1).max(240)).max(8).describe(
    "Directly supported workstreams, excluding passive or briefly mentioned secondary context."
  ),
  decisions: z.array(z.string().min(1).max(240)).max(8).describe(
    "Supported choices or requested targets that remain distinct from implementation outcomes."
  ),
  outcomes: z.array(z.string().min(1).max(240)).max(8).describe(
    "Demonstrated results only, with requested or intended targets excluded."
  ),
  blockers: z.array(z.string().min(1).max(240)).max(8),
  surfaces: z.array(z.string().min(1).max(240)).max(12).describe(
    "Work surfaces directly supported by the current hour; exclude pages or screens that were merely opened, navigated to, or viewed."
  ),
  linkReferences: LinkReferencesSchema
}).strict();

const CurrentHourItemSchema = HourDraftSchema.omit({ linkReferences: true }).extend({
  version: z.literal(1),
  id: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  applications: z.array(TimelineApplicationSchema),
  links: z.array(HistoryLinkSchema).max(5).default([]),
  sourceTimelineIds: z.array(z.string().min(1)),
  sourceTimelineRevisions: z.array(z.string().min(1)),
  updatedAt: z.string().datetime()
}).strict();

export const HourItemSchema = z.preprocess(migrateLegacyArtifacts, CurrentHourItemSchema);

function migrateLegacyArtifacts(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!("artifacts" in record)) return value;
  const { artifacts, ...current } = record;
  return { ...current, surfaces: current.surfaces ?? artifacts };
}

export type HourDraft = z.infer<typeof HourDraftSchema>;
