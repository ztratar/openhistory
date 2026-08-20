import {
  selectedOpenAIAuthMode,
  type InferenceProvider,
  type InferenceSettings
} from "@shared/inference";
import type { CodexRuntime } from "../codex-runtime";
import type { InferenceProviderAdapter } from "./contracts";
import { AnthropicProvider } from "./providers/anthropic";
import { AppleFoundationModelProvider } from "./providers/apple";
import { KimiProvider } from "./providers/kimi";
import { OpenAIProvider } from "./providers/openai";
import { CodexChatGPTProvider } from "./providers/codex";

export * from "./contracts";
export {
  AppleFoundationModelProvider,
  findFoundationModelExecutable,
  probeAppleFoundationModel
} from "./providers/apple";

export function createInferenceProvider(options: {
  apiKey?: string;
  codexRuntime?: CodexRuntime;
  model: string;
  provider: InferenceProvider;
  settings?: InferenceSettings;
}): InferenceProviderAdapter {
  if (options.provider === "apple") return new AppleFoundationModelProvider(options.model);
  if (options.provider === "openai" && options.settings &&
      selectedOpenAIAuthMode(options.settings) === "chatgpt") {
    if (!options.codexRuntime) throw new Error("OpenAI ChatGPT sign-in is unavailable");
    return new CodexChatGPTProvider(options.model, options.codexRuntime);
  }
  if (!options.apiKey) throw new Error(`${options.provider} requires an API key`);
  if (options.provider === "anthropic") return new AnthropicProvider(options.apiKey, options.model);
  if (options.provider === "kimi") return new KimiProvider(options.apiKey, options.model);
  return new OpenAIProvider(options.apiKey, options.model);
}
