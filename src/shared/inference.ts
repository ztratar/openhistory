export const INFERENCE_PROVIDERS = ["apple", "openai", "anthropic", "kimi"] as const;
export const CLOUD_INFERENCE_PROVIDERS = ["openai", "anthropic", "kimi"] as const;

export type InferenceProvider = (typeof INFERENCE_PROVIDERS)[number];
export type CloudInferenceProvider = (typeof CLOUD_INFERENCE_PROVIDERS)[number];
export type ApiKeySource = "saved" | "environment" | "none";

export interface InferenceSettings {
  version: 1;
  enabled: boolean;
  provider: InferenceProvider;
  models: Record<InferenceProvider, string>;
}

export interface InferenceState {
  settings: InferenceSettings;
  configured: boolean;
  appleAvailability: AppleInferenceAvailability;
  keySources: Record<InferenceProvider, ApiKeySource>;
}

export interface AppleInferenceAvailability {
  available: boolean;
  reason?: string;
}

export interface InferenceModelOption {
  id: string;
  label: string;
  description: string;
}

export const INFERENCE_PROVIDER_LABELS: Record<InferenceProvider, string> = {
  apple: "Apple On-Device (Experimental)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  kimi: "Kimi (Moonshot AI)"
};

export const INFERENCE_MODEL_OPTIONS: Record<InferenceProvider, InferenceModelOption[]> = {
  apple: [
    { id: "system-default", label: "System Language Model", description: "Private and on-device" }
  ],
  openai: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Efficient, high-volume" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Balanced" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Highest capability" }
  ],
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fastest" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Balanced" },
    { id: "claude-opus-5", label: "Claude Opus 5", description: "Highest capability" }
  ],
  kimi: [
    { id: "kimi-k3", label: "Kimi K3", description: "Flagship model" }
  ]
};

export const DEFAULT_INFERENCE_MODELS: Record<InferenceProvider, string> = {
  apple: "system-default",
  openai: "gpt-5.6-luna",
  anthropic: "claude-sonnet-5",
  kimi: "kimi-k3"
};

export function isInferenceProvider(value: unknown): value is InferenceProvider {
  return typeof value === "string" && INFERENCE_PROVIDERS.includes(value as InferenceProvider);
}

export function isCloudInferenceProvider(value: unknown): value is CloudInferenceProvider {
  return typeof value === "string" && CLOUD_INFERENCE_PROVIDERS.includes(value as CloudInferenceProvider);
}
