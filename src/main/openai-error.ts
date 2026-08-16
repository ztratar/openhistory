import { INFERENCE_PROVIDER_LABELS, type InferenceProvider } from "@shared/inference";
import { inferenceFailureKind } from "./inference/errors";

export function publicInferenceErrorMessage(
  error: unknown,
  operation: string,
  provider: InferenceProvider
): string {
  const status = errorStatus(error);
  const providerLabel = INFERENCE_PROVIDER_LABELS[provider];
  if (status === 401) return `${providerLabel} couldn't connect with this API key. Check it in Settings, then retry.`;
  if (status === 403 || status === 404) {
    return `${providerLabel} can't use the selected model with this account. Check the model in Settings, then retry.`;
  }
  if (status === 429) return `${providerLabel} is busy right now. Nothing was lost, and OpenHistory will try again automatically.`;
  if (status && status >= 500) {
    return `${providerLabel} is temporarily unavailable. Nothing was lost, and OpenHistory will try again automatically.`;
  }
  if (error instanceof Error && [
    "No inference API key is configured. Add one in Settings.",
    "Automatic summaries are turned off in Settings."
  ].includes(error.message)) {
    return error.message;
  }
  if (isConnectionError(error)) {
    return `${providerLabel} couldn't be reached. Nothing was lost, and OpenHistory will try again automatically.`;
  }
  return publicOperationFailure(operation);
}

export function inferenceErrorMetadata(error: unknown, provider: InferenceProvider): object {
  return {
    provider,
    name: error instanceof Error ? error.name : "UnknownError",
    status: errorStatus(error),
    kind: inferenceFailureKind(error),
    issuePaths: safeIssuePaths(error)
  };
}

function publicOperationFailure(operation: string): string {
  if (operation === "History chat") return "OpenHistory couldn't answer that right now. Please try again.";
  return "OpenHistory couldn't update part of your timeline. Nothing was lost, and it will try again automatically.";
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ["APIConnectionError", "APIConnectionTimeoutError", "APITimeoutError"].includes(error.name);
}

function safeIssuePaths(error: unknown): Array<{ path: string; code: string }> | undefined {
  if (!error || typeof error !== "object" || !("issues" in error) || !Array.isArray(error.issues)) return undefined;
  return error.issues.slice(0, 8).flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const record = issue as { path?: unknown; code?: unknown };
    if (!Array.isArray(record.path) || typeof record.code !== "string") return [];
    const path = record.path.filter((part) => typeof part === "string" || typeof part === "number").join(".");
    return [{ path, code: record.code }];
  });
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}
