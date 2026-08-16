import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { InferenceProviderAdapter, StructuredGenerationRequest } from "../contracts";

export class KimiProvider implements InferenceProviderAdapter {
  readonly provider = "kimi" as const;
  private readonly client: OpenAI;

  constructor(apiKey: string, readonly model: string, client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey, baseURL: "https://api.moonshot.ai/v1" });
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: request.input }
      ],
      response_format: zodResponseFormat(request.schema, request.schemaName),
      max_completion_tokens: Math.max(request.maxOutputTokens, 4_000),
      ...(this.model === "kimi-k3" ? { reasoning_effort: "low" as const } : {})
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) throw new Error("The model did not return structured output");
    return request.schema.parse(parsed);
  }
}
