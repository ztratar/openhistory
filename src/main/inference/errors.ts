export type InferenceOutputFailureKind =
  | "content_filter"
  | "incomplete"
  | "invalid_output"
  | "refusal";

export class InferenceOutputError extends Error {
  constructor(readonly kind: InferenceOutputFailureKind) {
    super("The inference provider did not return usable structured output.");
    this.name = "InferenceOutputError";
  }
}

export function inferenceFailureKind(error: unknown): InferenceOutputFailureKind | undefined {
  return error instanceof InferenceOutputError ? error.kind : undefined;
}

export function isRetryableInferenceError(error: unknown): boolean {
  const kind = inferenceFailureKind(error);
  if (kind) return kind === "incomplete" || kind === "invalid_output";

  const name = errorName(error);
  if ([
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "APITimeoutError",
    "LengthFinishReasonError",
    "ZodError"
  ].includes(name)) return true;

  const status = errorStatus(error);
  return status === 408 || status === 409 || status === 429 || Boolean(status && status >= 500);
}

export function isItemScopedInferenceError(error: unknown): boolean {
  if (inferenceFailureKind(error)) return true;
  return ["ContentFilterFinishReasonError", "LengthFinishReasonError", "ZodError"].includes(errorName(error));
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}
