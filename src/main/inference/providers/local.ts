import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { InferenceProviderAdapter, StructuredGenerationRequest } from "../contracts";
import { InferenceOutputError } from "../errors";
import { privateInferenceFetch } from "../../private-inference-fetch";

/** Local OpenAI-compatible servers often accept any bearer token; the SDK still requires one. */
const PLACEHOLDER_API_KEY = "local-no-key";
const LOCAL_REQUEST_TIMEOUT_MS = 180_000;

/**
 * Adapter for a private OpenAI-compatible chat-completions server (oMLX, LM Studio,
 * llama.cpp, Ollama). Structured output uses `response_format: json_schema`, which
 * oMLX enforces with constrained decoding.
 */
export class LocalOpenAICompatibleProvider implements InferenceProviderAdapter {
  readonly provider = "local" as const;
  private readonly client: OpenAI;

  constructor(
    readonly baseURL: string,
    readonly model: string,
    apiKey?: string,
    client?: OpenAI
  ) {
    this.client = client ?? new OpenAI({
      apiKey: apiKey?.trim() || PLACEHOLDER_API_KEY,
      baseURL,
      timeout: LOCAL_REQUEST_TIMEOUT_MS,
      // The service owns retry policy; in particular, HTTP 507 must not retry.
      maxRetries: 0,
      fetch: privateInferenceFetch as typeof fetch
    });
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: request.input }
      ],
      response_format: zodResponseFormat(request.schema, request.schemaName),
      max_completion_tokens: request.maxOutputTokens,
      temperature: 0.2,
      // Qwen-style hybrid reasoning models spend the output budget on hidden thinking
      // unless it is disabled. Servers that do not recognize the field ignore it.
      ...({ chat_template_kwargs: { enable_thinking: false } } as Record<string, unknown>)
    });
    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") throw new InferenceOutputError("incomplete");
    const parsed = choice?.message.parsed;
    if (!parsed) throw new InferenceOutputError("invalid_output");
    return request.schema.parse(parsed);
  }
}
