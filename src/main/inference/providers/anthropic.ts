import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { InferenceProviderAdapter, StructuredGenerationRequest } from "../contracts";

export class AnthropicProvider implements InferenceProviderAdapter {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, readonly model: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: request.maxOutputTokens,
      system: request.instructions,
      messages: [{ role: "user", content: request.input }],
      output_config: { format: zodOutputFormat(request.schema) }
    });
    if (!response.parsed_output) throw new Error("The model did not return structured output");
    return request.schema.parse(response.parsed_output);
  }
}
