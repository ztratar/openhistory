import { z } from "zod";
import { HistoryLinkSchema, LinkReferencesSchema } from "./history-link-schema";

export const DailyRollupDraftSchema = z.object({
  title: z.string().min(1).max(120).describe(
    "A specific 4–10 word title beginning with a concrete past-tense verb and naming the day's most meaningful outcome or workstream."
  ),
  summary: z.string().min(1).max(1_200).describe(
    "One to five concise bullet points for human scanning, separated by newlines and each prefixed with '- '."
  ),
  themes: z.array(z.string().min(1).max(120)).max(12).describe(
    "Durable, directly supported workstreams; exclude passive or briefly mentioned context."
  ),
  accomplishments: z.array(z.string().min(1).max(240)).max(12).describe(
    "Demonstrated results only; never requested, proposed, drafted, or intended targets."
  ),
  decisions: z.array(z.string().min(1).max(240)).max(12).describe(
    "Consequential supported choices or requested targets, kept distinct from completed results."
  ),
  unfinishedWork: z.array(z.string().min(1).max(240)).max(12).describe(
    "Work explicitly supported as unfinished or blocked by the current day's timeline evidence."
  ),
  recurringPatterns: z.array(z.string().min(1).max(240)).max(12),
  linkReferences: LinkReferencesSchema
}).strict();

export const DailyRollupItemSchema = DailyRollupDraftSchema.omit({ linkReferences: true }).extend({
  version: z.literal(2),
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  links: z.array(HistoryLinkSchema).max(5).default([]),
  sourceTimelineIds: z.array(z.string().min(1)),
  sourceTimelineRevisions: z.array(z.string().min(1)).optional(),
  updatedAt: z.string().datetime()
}).strict().or(z.object({
  version: z.literal(1),
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(1_200),
  themes: z.array(z.string().min(1).max(120)).max(12),
  accomplishments: z.array(z.string().min(1).max(240)).max(12),
  decisions: z.array(z.string().min(1).max(240)).max(12),
  openLoops: z.array(z.string().min(1).max(240)).max(12),
  recurringPatterns: z.array(z.string().min(1).max(240)).max(12),
  links: z.array(HistoryLinkSchema).max(5).default([]),
  sourceTimelineIds: z.array(z.string().min(1)),
  sourceTimelineRevisions: z.array(z.string().min(1)).optional(),
  updatedAt: z.string().datetime()
}).strict().transform(({ openLoops, ...legacy }) => ({
  ...legacy,
  version: 2 as const,
  unfinishedWork: openLoops
})));

export type DailyRollupDraft = z.infer<typeof DailyRollupDraftSchema>;
