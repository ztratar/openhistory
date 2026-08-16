import type { InferenceOnboardingSelection } from "@shared/contracts";
import {
  INFERENCE_MODEL_OPTIONS,
  isCloudInferenceProvider,
  isInferenceProvider,
  type AppleInferenceAvailability
} from "@shared/inference";

export function normalizeInferenceOnboardingSelection(
  value: unknown
): InferenceOnboardingSelection {
  if (!value || typeof value !== "object") throw new Error("Invalid model selection");
  const candidate = value as Partial<InferenceOnboardingSelection>;
  if (!isInferenceProvider(candidate.provider)) throw new Error("Invalid inference provider");

  const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
  if (!INFERENCE_MODEL_OPTIONS[candidate.provider].some((option) => option.id === model)) {
    throw new Error("Choose a supported model");
  }

  if (!isCloudInferenceProvider(candidate.provider)) {
    return { provider: candidate.provider, model };
  }

  const apiKey = typeof candidate.apiKey === "string" ? candidate.apiKey.trim() : "";
  if (!apiKey) throw new Error(`${candidate.provider} requires an API key`);
  if (apiKey.length > 10_000) throw new Error("API key is too long");
  return { provider: candidate.provider, model, apiKey };
}

export function assertInferenceOnboardingAvailability(
  selection: InferenceOnboardingSelection,
  appleAvailability: AppleInferenceAvailability
): void {
  if (selection.provider !== "apple" || appleAvailability.available) return;
  throw new Error(
    appleAvailability.reason ?? "Apple's on-device model is unavailable on this Mac."
  );
}
