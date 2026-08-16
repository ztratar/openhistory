import type { InferenceProvider } from "@shared/inference";
import type { z } from "zod";

export interface StructuredGenerationRequest<T> {
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
}

export interface InferenceProviderAdapter {
  readonly provider: InferenceProvider;
  readonly model: string;
  generate<T>(request: StructuredGenerationRequest<T>): Promise<T>;
}
