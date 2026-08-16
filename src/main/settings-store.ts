import type { CollectionSettings } from "@shared/contracts";
import { CLOUD_INFERENCE_PROVIDERS } from "@shared/inference";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { writePrivateFile } from "./private-storage";

const CollectionSettingsSchema = z.object({
  version: z.literal(1),
  privacyNoticeVersion: z.number().int().min(0).max(100).default(0),
  inferenceOnboardingVersion: z.number().int().min(0).max(100).default(0),
  cloudInferenceConsents: z.array(z.enum(CLOUD_INFERENCE_PROVIDERS)).max(CLOUD_INFERENCE_PROVIDERS.length).default([]),
  appearanceMode: z.enum(["system", "light", "dark"]).default("system"),
  captureWindowTitles: z.boolean().default(true),
  captureFocusedElements: z.boolean().default(true),
  captureTextInput: z.boolean().default(true),
  capturePointerClicks: z.boolean().default(true),
  captureBrowserURLs: z.boolean().default(true),
  captureDocumentContext: z.boolean().default(true),
  captureUISnapshots: z.boolean().default(true),
  captureEmailActivity: z.boolean().default(false),
  captureMessagingActivity: z.boolean().default(false),
  excludedBundleIdentifiers: z.array(z.string().min(1)).max(200)
}).strict();

export const DEFAULT_COLLECTION_SETTINGS: CollectionSettings = {
  version: 1,
  privacyNoticeVersion: 0,
  inferenceOnboardingVersion: 0,
  cloudInferenceConsents: [],
  appearanceMode: "system",
  captureWindowTitles: true,
  captureFocusedElements: true,
  captureTextInput: true,
  capturePointerClicks: true,
  captureBrowserURLs: true,
  captureDocumentContext: true,
  captureUISnapshots: true,
  captureEmailActivity: false,
  captureMessagingActivity: false,
  excludedBundleIdentifiers: []
};

export class SettingsStore {
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = resolve(dataDirectory, "settings.json");
  }

  load(): CollectionSettings {
    if (!existsSync(this.path)) return structuredClone(DEFAULT_COLLECTION_SETTINGS);
    try {
      return CollectionSettingsSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      console.error("Unable to read collection settings", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return structuredClone(DEFAULT_COLLECTION_SETTINGS);
    }
  }

  save(settings: CollectionSettings): CollectionSettings {
    const normalized = CollectionSettingsSchema.parse({
      ...settings,
      cloudInferenceConsents: [...new Set(settings.cloudInferenceConsents)].sort(),
      excludedBundleIdentifiers: [...new Set(settings.excludedBundleIdentifiers)].sort()
    });
    writePrivateFile(this.path, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  }
}
