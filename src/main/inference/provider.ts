import {
  effectiveLocalInferenceBaseUrl,
  type InferenceProvider
} from "@shared/inference";
import type { InferenceProviderAdapter } from "./contracts";
import { AnthropicProvider } from "./providers/anthropic";
import { AppleFoundationModelProvider } from "./providers/apple";
import { KimiProvider } from "./providers/kimi";
import { LocalOpenAICompatibleProvider } from "./providers/local";
import { OpenAIProvider } from "./providers/openai";

export * from "./contracts";
export {
  AppleFoundationModelProvider,
  findFoundationModelExecutable,
  probeAppleFoundationModel
} from "./providers/apple";

export { LocalOpenAICompatibleProvider } from "./providers/local";

export function createInferenceProvider(options: {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  provider: InferenceProvider;
}): InferenceProviderAdapter {
  if (options.provider === "apple") return new AppleFoundationModelProvider(options.model);
  if (options.provider === "local") {
    const baseUrl = effectiveLocalInferenceBaseUrl(options.baseUrl);
    if (!baseUrl) throw new Error("The local inference server must use a private network address");
    return new LocalOpenAICompatibleProvider(baseUrl, options.model, options.apiKey);
  }
  if (!options.apiKey) throw new Error(`${options.provider} requires an API key`);
  if (options.provider === "anthropic") return new AnthropicProvider(options.apiKey, options.model);
  if (options.provider === "kimi") return new KimiProvider(options.apiKey, options.model);
  return new OpenAIProvider(options.apiKey, options.model);
}
