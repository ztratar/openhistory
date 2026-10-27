import {
  DEFAULT_INFERENCE_MODELS,
  INFERENCE_PROVIDERS,
  normalizeLocalInferenceBaseUrl,
  type InferenceProvider,
  type InferenceSettings
} from "@shared/inference";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { writePrivateFile } from "./private-storage";

const InferenceProviderSchema = z.enum(INFERENCE_PROVIDERS);
const ModelSchema = z.string().trim().min(1).max(200);
const InferenceSettingsSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  provider: InferenceProviderSchema,
  models: z.object({
    apple: ModelSchema.default(DEFAULT_INFERENCE_MODELS.apple),
    local: ModelSchema.default(DEFAULT_INFERENCE_MODELS.local),
    openai: ModelSchema,
    anthropic: ModelSchema,
    kimi: ModelSchema
  }).strict(),
  localBaseUrl: z.string().trim().max(500)
    .refine((value) => normalizeLocalInferenceBaseUrl(value) !== undefined, "Use a private network address")
    .transform((value) => normalizeLocalInferenceBaseUrl(value)!)
    .optional()
}).strict();

export class InferenceSettingsStore {
  private readonly path: string;
  private readonly defaults: InferenceSettings;

  constructor(
    dataDirectory: string,
    modelDefaults?: Partial<Record<InferenceProvider, string>>,
    localBaseUrlDefault?: string
  ) {
    this.path = resolve(dataDirectory, "inference-settings.json");
    this.defaults = {
      version: 1,
      enabled: true,
      provider: "openai",
      models: {
        ...DEFAULT_INFERENCE_MODELS,
        ...normalizedModelDefaults(modelDefaults)
      },
      ...(normalizeLocalInferenceBaseUrl(localBaseUrlDefault)
        ? { localBaseUrl: normalizeLocalInferenceBaseUrl(localBaseUrlDefault) }
        : {})
    };
  }

  load(): InferenceSettings {
    if (!existsSync(this.path)) return structuredClone(this.defaults);
    try {
      const stored = InferenceSettingsSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
      return stored.localBaseUrl || !this.defaults.localBaseUrl
        ? stored
        : { ...stored, localBaseUrl: this.defaults.localBaseUrl };
    } catch (error) {
      console.error("Unable to read inference settings", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return structuredClone(this.defaults);
    }
  }

  save(settings: InferenceSettings): InferenceSettings {
    const normalized = InferenceSettingsSchema.parse(settings);
    writePrivateFile(this.path, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  }
}

function normalizedModelDefaults(
  values: Partial<Record<InferenceProvider, string>> | undefined
): Partial<Record<InferenceProvider, string>> {
  if (!values) return {};
  return Object.fromEntries(
    Object.entries(values).flatMap(([provider, model]) => {
      const normalized = model?.trim();
      return normalized ? [[provider, normalized]] : [];
    })
  );
}
