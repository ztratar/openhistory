import type { CollectionSettings } from "@shared/contracts";
import {
  isCloudInferenceProvider,
  selectedOpenAIAuthMode,
  type InferenceSettings
} from "@shared/inference";

export function cloudInferenceNeedsConsent(
  inference: InferenceSettings,
  collection: CollectionSettings
): boolean {
  return inference.enabled &&
    isCloudInferenceProvider(inference.provider) &&
    !collection.cloudInferenceConsents.includes(inference.provider);
}

export function cloudInferenceNeedsCredential(
  inference: InferenceSettings,
  credentials: { apiKey?: string; chatGPTSignedIn?: boolean }
): boolean {
  if (!inference.enabled || !isCloudInferenceProvider(inference.provider)) return false;
  if (inference.provider === "openai" && selectedOpenAIAuthMode(inference) === "chatgpt") {
    return credentials.chatGPTSignedIn !== true;
  }
  return !credentials.apiKey?.trim();
}
