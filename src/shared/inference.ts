export const INFERENCE_PROVIDERS = ["apple", "local", "openai", "anthropic", "kimi"] as const;
export const CLOUD_INFERENCE_PROVIDERS = ["openai", "anthropic", "kimi"] as const;

export type InferenceProvider = (typeof INFERENCE_PROVIDERS)[number];
export type CloudInferenceProvider = (typeof CLOUD_INFERENCE_PROVIDERS)[number];
export type ApiKeySource = "saved" | "environment" | "none";

export interface InferenceSettings {
  version: 1;
  enabled: boolean;
  provider: InferenceProvider;
  models: Record<InferenceProvider, string>;
  /** Base URL of a private OpenAI-compatible server such as oMLX, LM Studio, or Ollama. */
  localBaseUrl?: string;
}

export interface LocalInferenceConnectionState {
  reachable: boolean;
  checkedAt: string;
  lastConnectedAt?: string;
  unreachableSince?: string;
  modelCount?: number;
  error?: string;
}

export interface InferenceState {
  settings: InferenceSettings;
  configured: boolean;
  appleAvailability: AppleInferenceAvailability;
  keySources: Record<InferenceProvider, ApiKeySource>;
  localConnection?: LocalInferenceConnectionState;
}

export interface AppleInferenceAvailability {
  available: boolean;
  reason?: string;
  reasonCode?: AppleInferenceUnavailabilityReason;
}

export type AppleInferenceUnavailabilityReason =
  | "unsupportedOperatingSystem"
  | "appleIntelligenceNotEnabled"
  | "deviceNotEligible"
  | "modelNotReady"
  | "foundationModelsUnavailable"
  | "foundationModelsFrameworkMissing"
  | "unsupportedPlatform"
  | "helperMissing"
  | "workerLaunchFailed"
  | "invalidWorkerResponse";

export interface AppleInferenceAvailabilityGuidance {
  title: string;
  description: string;
  helpLabel?: string;
  helpUrl?: string;
}

export function appleInferenceAvailabilityGuidance(
  availability: AppleInferenceAvailability
): AppleInferenceAvailabilityGuidance {
  switch (availability.reasonCode) {
    case "appleIntelligenceNotEnabled":
      return {
        title: "Turn on Apple Intelligence",
        description: "Apple Intelligence is turned off on this Mac. Turn it on in System Settings, then come back and check again.",
        helpLabel: "How to turn it on",
        helpUrl: "https://support.apple.com/guide/mac-help/mchl46361784/mac"
      };
    case "unsupportedOperatingSystem":
      return {
        title: "Update macOS to use Apple On-Device",
        description: `${availability.reason ?? "Apple On-Device requires macOS 26 or later."} Update macOS, then reopen OpenHistory.`,
        helpLabel: "How to update macOS",
        helpUrl: "https://support.apple.com/guide/mac-help/mchlpx1065/mac"
      };
    case "deviceNotEligible":
      return {
        title: "This Mac is not compatible",
        description: "Apple On-Device requires a Mac that supports Apple Intelligence. Choose a cloud provider to continue."
      };
    case "modelNotReady":
      return {
        title: "Apple Intelligence is still getting ready",
        description: "The on-device model may still be downloading. Keep this Mac connected to power and Wi-Fi, then check again."
      };
    case "foundationModelsFrameworkMissing":
    case "helperMissing":
      return {
        title: "This OpenHistory build cannot use Apple On-Device",
        description: `${availability.reason ?? "The required on-device model component is missing."} Install a newer OpenHistory build or choose a cloud provider.`
      };
    case "unsupportedPlatform":
      return {
        title: "Apple On-Device requires a Mac",
        description: availability.reason ?? "Apple's on-device model is available only on macOS."
      };
    case "workerLaunchFailed":
    case "invalidWorkerResponse":
    case "foundationModelsUnavailable":
    default:
      return {
        title: "Apple On-Device is unavailable",
        description: `${availability.reason ?? "This Mac does not currently meet the on-device model requirements."} Check again or choose a cloud provider.`
      };
  }
}

export const DEFAULT_LOCAL_INFERENCE_BASE_URL = "http://127.0.0.1:8080/v1";
export const DEFAULT_LOCAL_INFERENCE_MODEL = "mlx-community/Qwen3.5-9B-4bit";

export function effectiveLocalInferenceBaseUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return DEFAULT_LOCAL_INFERENCE_BASE_URL;
  }
  return normalizeLocalInferenceBaseUrl(value);
}

/**
 * Local inference must stay private: accept only loopback, private-network, link-local,
 * Tailscale (100.64.0.0/10, *.ts.net), and mDNS (*.local) hosts over http(s).
 */
export function normalizeLocalInferenceBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed.length > 500) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  return isPrivateInferenceHost(url.hostname) ? trimmed : undefined;
}

export function isPrivateInferenceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".ts.net")) return true;
  if (host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = octets.map(Number) as [number, number, number, number];
  if (octets.map(Number).some((part) => part > 255)) return false;
  return a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127);
}

export interface InferenceModelOption {
  id: string;
  label: string;
  description: string;
}

export const INFERENCE_PROVIDER_LABELS: Record<InferenceProvider, string> = {
  apple: "Apple On-Device (Experimental)",
  local: "Local server (OpenAI-compatible)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  kimi: "Kimi (Moonshot AI)"
};

export const INFERENCE_MODEL_OPTIONS: Record<InferenceProvider, InferenceModelOption[]> = {
  apple: [
    { id: "system-default", label: "System Language Model", description: "Private and on-device" }
  ],
  local: [
    { id: DEFAULT_LOCAL_INFERENCE_MODEL, label: "Qwen3.5 9B (4-bit)", description: "Private, runs on your server" }
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
  local: DEFAULT_LOCAL_INFERENCE_MODEL,
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
