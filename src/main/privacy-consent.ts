import type { CollectionSettings } from "@shared/contracts";
import { isCloudInferenceProvider, type InferenceSettings } from "@shared/inference";

export function cloudInferenceNeedsConsent(
  inference: InferenceSettings,
  collection: CollectionSettings
): boolean {
  return inference.enabled &&
    isCloudInferenceProvider(inference.provider) &&
    !collection.cloudInferenceConsents.includes(inference.provider);
}

export function cloudInferenceNeedsApiKey(
  inference: InferenceSettings,
  apiKey: string | undefined
): boolean {
  return inference.enabled &&
    isCloudInferenceProvider(inference.provider) &&
    !apiKey?.trim();
}
