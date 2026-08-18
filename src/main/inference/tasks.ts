import type { z } from "zod";
import { HourDraftSchema } from "../hour-schema";
import { DailyRollupDraftSchema } from "../daily-rollup-schema";
import { TimelineDraftSchema } from "../timeline-schema";

export type InferenceTaskId = "timeline" | "hour" | "day";
export type InferenceExecutionPath = "apple" | "cloud";

export interface InferenceTaskProfile {
  readonly inputVersion: string;
  readonly promptVersion: string;
  readonly schemaName: string;
  readonly schemaVersion: string;
  readonly normalizationVersion: string;
  readonly maxOutputTokens: number;
}

export interface InferenceTaskDefinition<T> {
  readonly id: InferenceTaskId;
  readonly schema: z.ZodType<T>;
  readonly apple: InferenceTaskProfile;
  readonly cloud: InferenceTaskProfile;
}

function defineTask<T>(
  id: InferenceTaskId,
  schema: z.ZodType<T>,
  profiles: Pick<InferenceTaskDefinition<T>, "apple" | "cloud">
): InferenceTaskDefinition<T> {
  return Object.freeze({
    id,
    schema,
    apple: Object.freeze({ ...profiles.apple }),
    cloud: Object.freeze({ ...profiles.cloud })
  });
}

export const TIMELINE_TASK = defineTask("timeline", TimelineDraftSchema, {
  apple: {
    inputVersion: "e12-search-title-language",
    promptVersion: "apple-timeline-v3",
    schemaName: "timeline_entry_compact",
    schemaVersion: "timeline-draft-v1",
    normalizationVersion: "apple-normalization-v2",
    maxOutputTokens: 550
  },
  cloud: {
    inputVersion: "hybrid-evidence-v4",
    promptVersion: "cloud-timeline-v4",
    schemaName: "timeline_entry",
    schemaVersion: "timeline-draft-v1",
    normalizationVersion: "provider-native-zod-v1",
    maxOutputTokens: 1_200
  }
});

export const HOUR_TASK = defineTask("hour", HourDraftSchema, {
  apple: {
    inputVersion: "h3-budgeted-semantic-link-candidates",
    promptVersion: "apple-hour-v3",
    schemaName: "hour_rollup_compact",
    schemaVersion: "hour-draft-v2",
    normalizationVersion: "apple-normalization-v3-grounded-coverage",
    maxOutputTokens: 650
  },
  cloud: {
    inputVersion: "hybrid-link-candidates-v3",
    promptVersion: "cloud-hour-v3",
    schemaName: "hour_rollup",
    schemaVersion: "hour-draft-v2",
    normalizationVersion: "provider-native-zod-v1",
    maxOutputTokens: 1_300
  }
});

export const DAY_TASK = defineTask("day", DailyRollupDraftSchema, {
  apple: {
    inputVersion: "d4-budgeted-semantic-link-candidates",
    promptVersion: "apple-day-v3",
    schemaName: "daily_rollup_compact",
    schemaVersion: "daily-rollup-draft-v3",
    normalizationVersion: "apple-normalization-v3-grounded-coverage",
    maxOutputTokens: 750
  },
  cloud: {
    inputVersion: "semantic-link-candidates-v3",
    promptVersion: "cloud-day-v4",
    schemaName: "daily_rollup",
    schemaVersion: "daily-rollup-draft-v3",
    normalizationVersion: "provider-native-zod-v1",
    maxOutputTokens: 1_600
  }
});

export const INFERENCE_TASKS = Object.freeze({
  timeline: TIMELINE_TASK,
  hour: HOUR_TASK,
  day: DAY_TASK
});

export function inferenceTaskManifest(): Record<InferenceTaskId, {
  apple: InferenceTaskProfile;
  cloud: InferenceTaskProfile;
}> {
  return {
    timeline: { apple: { ...TIMELINE_TASK.apple }, cloud: { ...TIMELINE_TASK.cloud } },
    hour: { apple: { ...HOUR_TASK.apple }, cloud: { ...HOUR_TASK.cloud } },
    day: { apple: { ...DAY_TASK.apple }, cloud: { ...DAY_TASK.cloud } }
  };
}
