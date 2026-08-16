import type { InferenceProvider } from "@shared/inference";
import type { InferenceProviderAdapter } from "./contracts";
import { AnthropicProvider } from "./providers/anthropic";
import { AppleFoundationModelProvider } from "./providers/apple";
import { KimiProvider } from "./providers/kimi";
import { OpenAIProvider } from "./providers/openai";

export * from "./contracts";
export {
  AppleFoundationModelProvider,
  findFoundationModelExecutable,
  probeAppleFoundationModel
} from "./providers/apple";

export function createInferenceProvider(options: {
  apiKey?: string;
  model: string;
  provider: InferenceProvider;
}): InferenceProviderAdapter {
  if (options.provider === "apple") return new AppleFoundationModelProvider(options.model);
  if (!options.apiKey) throw new Error(`${options.provider} requires an API key`);
  if (options.provider === "anthropic") return new AnthropicProvider(options.apiKey, options.model);
  if (options.provider === "kimi") return new KimiProvider(options.apiKey, options.model);
  return new OpenAIProvider(options.apiKey, options.model);
}
