import type { LocalInferenceProbeResult } from "@shared/contracts";
import { normalizeLocalInferenceBaseUrl } from "@shared/inference";
import { privateInferenceFetch } from "./private-inference-fetch";

const PROBE_TIMEOUT_MS = 5_000;
const EMBEDDING_MODEL_PATTERN = /(embed|embedding|rerank|whisper|tts|stt)/i;

/**
 * Lists chat-capable models from a private OpenAI-compatible server. The renderer's CSP
 * blocks direct network access, so the main process performs this request.
 */
export async function probeLocalInferenceServer(
  value: unknown,
  apiKey?: string,
  fetchImpl: typeof fetch = privateInferenceFetch as typeof fetch
): Promise<LocalInferenceProbeResult> {
  const baseUrl = normalizeLocalInferenceBaseUrl(value);
  if (!baseUrl) {
    return { ok: false, models: [], error: "Use a private network address, for example http://127.0.0.1:8080/v1." };
  }
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (!response.ok) {
      return { ok: false, baseUrl, models: [], error: `The server answered with HTTP ${response.status}.` };
    }
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
      .filter((id) => id.length > 0 && id.length <= 200 && !EMBEDDING_MODEL_PATTERN.test(id))
      .sort((left, right) => left.localeCompare(right));
    return { ok: true, baseUrl, models: [...new Set(models)] };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      baseUrl,
      models: [],
      error: timedOut ? "The server did not answer within 5 seconds." : "OpenHistory could not reach the server."
    };
  }
}
