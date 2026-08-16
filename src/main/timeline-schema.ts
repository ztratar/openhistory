import { z } from "zod";
import { HistoryLinkSchema } from "./history-link-schema";

export const TimelineSuggestionSchema = z.object({
  type: z.enum(["skill", "automation"]),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(400)
}).strict();

export const TimelineDraftSchema = z.object({
  title: z.string().min(1).max(120).describe(
    "A specific 4–10 word title beginning with an evidence-calibrated past-tense action verb and naming the actual object or outcome."
  ),
  description: z.string().min(1).max(800).describe(
    "One or two factual sentences that preserve whether evidence is requested, observed, or completed; meaningful action or result first, then optional supported context or status."
  ),
  workThreads: z.array(z.string().min(1).max(240)).max(8).describe(
    "Concrete workstreams supported by direct interaction, not briefly visible secondary context."
  ),
  decisions: z.array(z.string().min(1).max(240)).max(8).describe(
    "Explicitly supported choices or requested targets, phrased as decisions rather than completed results."
  ),
  outcomes: z.array(z.string().min(1).max(240)).max(8).describe(
    "Demonstrated results only; never requests, proposals, drafts, or intended targets."
  ),
  blockers: z.array(z.string().min(1).max(240)).max(8),
  surfaces: z.array(z.string().min(1).max(240)).max(12).describe(
    "Work surfaces created, edited, configured, saved, or used as the sustained direct object of work; exclude pages or screens that were merely opened, navigated to, or viewed."
  ),
  suggestion: TimelineSuggestionSchema.nullable()
}).strict();

export const TimelineApplicationSchema = z.object({
  bundleIdentifier: z.string().nullable(),
  name: z.string().min(1)
}).strict();

const CurrentTimelineItemSchema = TimelineDraftSchema.extend({
  version: z.literal(1),
  id: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  applications: z.array(TimelineApplicationSchema),
  links: z.array(HistoryLinkSchema).max(12).default([]),
  sourceEventIds: z.array(z.string().min(1).max(128)).max(2_000).optional()
}).strict();

export const TimelineItemSchema = z.preprocess(migrateLegacyArtifacts, CurrentTimelineItemSchema);

function migrateLegacyArtifacts(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!("artifacts" in record)) return value;
  const { artifacts, ...current } = record;
  return { ...current, surfaces: current.surfaces ?? artifacts };
}

export type TimelineDraft = z.infer<typeof TimelineDraftSchema>;
