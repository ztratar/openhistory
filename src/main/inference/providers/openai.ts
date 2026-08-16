import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { InferenceProviderAdapter, StructuredGenerationRequest } from "../contracts";
import { InferenceOutputError, type InferenceOutputFailureKind } from "../errors";

export class OpenAIProvider implements InferenceProviderAdapter {
  readonly provider = "openai" as const;
  private readonly client: OpenAI;

  constructor(apiKey: string, readonly model: string, client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey });
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: request.instructions,
      input: request.input,
      text: { format: zodTextFormat(request.schema, request.schemaName) },
      max_output_tokens: request.maxOutputTokens,
      store: false
    });
    if (!response.output_parsed) throw new InferenceOutputError(outputFailureKind(response));
    return request.schema.parse(response.output_parsed);
  }
}

function outputFailureKind(response: {
  status?: string | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string }> }>;
}): InferenceOutputFailureKind {
  const refused = response.output?.some((item) =>
    item.type === "message" && item.content?.some((content) => content.type === "refusal")
  );
  if (refused) return "refusal";
  if (response.incomplete_details?.reason === "content_filter") return "content_filter";
  if (response.status === "incomplete") return "incomplete";
  return "invalid_output";
}
