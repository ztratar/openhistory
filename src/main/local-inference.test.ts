import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { z } from "zod";
import { effectiveLocalInferenceBaseUrl, isPrivateInferenceHost, normalizeLocalInferenceBaseUrl } from "@shared/inference";
import { createInferenceProvider } from "./inference/provider";
import { InferenceOutputError } from "./inference/errors";
import { LocalOpenAICompatibleProvider } from "./inference/providers/local";
import { InferenceService } from "./inference/service";
import { probeLocalInferenceServer } from "./local-inference-probe";
import { cloudInferenceNeedsApiKey, cloudInferenceNeedsConsent } from "./privacy-consent";

const schema = z.object({ title: z.string() });
const request = {
  instructions: "Synthetic instructions",
  input: "Synthetic input",
  schema,
  schemaName: "synthetic_entry",
  maxOutputTokens: 321
};

function clientReturning(choice: unknown, sink?: (value: Record<string, unknown>) => void): OpenAI {
  return {
    chat: {
      completions: {
        parse: async (value: Record<string, unknown>) => {
          sink?.(value);
          return { choices: [choice] };
        }
      }
    }
  } as unknown as OpenAI;
}

test("sends a strict json_schema chat completion with thinking disabled", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = clientReturning(
    { finish_reason: "stop", message: { parsed: { title: "Structured result" } } },
    (value) => { captured = value; }
  );
  const provider = new LocalOpenAICompatibleProvider("http://127.0.0.1:8080/v1", "local-model", undefined, client);
  assert.deepEqual(await provider.generate(request), { title: "Structured result" });
  assert.equal(provider.provider, "local");
  assert.equal(captured?.model, "local-model");
  assert.equal(captured?.max_completion_tokens, 321);
  assert.deepEqual(captured?.chat_template_kwargs, { enable_thinking: false });
  assert.deepEqual(captured?.messages, [
    { role: "system", content: request.instructions },
    { role: "user", content: request.input }
  ]);
  const format = captured?.response_format as { type: string; json_schema: { name: string; strict: boolean } };
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.name, "synthetic_entry");
  assert.equal(format.json_schema.strict, true);
});

test("classifies truncated and missing output as retryable output errors", async () => {
  const truncated = new LocalOpenAICompatibleProvider("http://127.0.0.1:8080/v1", "m", undefined,
    clientReturning({ finish_reason: "length", message: { parsed: null } }));
  await assert.rejects(() => truncated.generate(request),
    (error: unknown) => error instanceof InferenceOutputError && error.kind === "incomplete");
  const empty = new LocalOpenAICompatibleProvider("http://127.0.0.1:8080/v1", "m", undefined,
    clientReturning({ finish_reason: "stop", message: { parsed: null } }));
  await assert.rejects(() => empty.generate(request),
    (error: unknown) => error instanceof InferenceOutputError && error.kind === "invalid_output");
});

test("accepts only private inference hosts", () => {
  for (const host of ["127.0.0.1", "localhost", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.20",
    "100.64.0.1", "100.127.9.9", "169.254.1.1", "::1", "fd12:3456::1", "mac-mini.local", "mini.tailnet.ts.net"]) {
    assert.equal(isPrivateInferenceHost(host), true, host);
  }
  for (const host of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "api.openai.com", "example.com", "1.2.3", "300.1.1.1"]) {
    assert.equal(isPrivateInferenceHost(host), false, host);
  }
});

test("normalizes local base URLs and rejects credentials or public hosts", () => {
  assert.equal(normalizeLocalInferenceBaseUrl(" http://127.0.0.1:8080/v1/ "), "http://127.0.0.1:8080/v1");
  assert.equal(normalizeLocalInferenceBaseUrl("http://[::1]:8080/v1"), "http://[::1]:8080/v1");
  assert.equal(normalizeLocalInferenceBaseUrl("https://api.openai.com/v1"), undefined);
  assert.equal(normalizeLocalInferenceBaseUrl("http://user:pw@127.0.0.1:8080/v1"), undefined);
  assert.equal(normalizeLocalInferenceBaseUrl("file:///etc/passwd"), undefined);
  assert.equal(normalizeLocalInferenceBaseUrl("http://127.0.0.1:8080/v1?x=1"), undefined);
  assert.equal(normalizeLocalInferenceBaseUrl(42), undefined);
});

test("uses the same effective default URL when no local address is stored", () => {
  assert.equal(effectiveLocalInferenceBaseUrl(undefined), "http://127.0.0.1:8080/v1");
  assert.equal(effectiveLocalInferenceBaseUrl(""), "http://127.0.0.1:8080/v1");
  assert.equal(effectiveLocalInferenceBaseUrl("https://example.com/v1"), undefined);
});

test("refuses to build a local adapter for a public address", () => {
  assert.throws(() => createInferenceProvider({ provider: "local", model: "m", baseUrl: "https://example.com/v1" }));
  const adapter = createInferenceProvider({ provider: "local", model: "m" });
  assert.equal(adapter.provider, "local");
  assert.equal((adapter as LocalOpenAICompatibleProvider).baseURL, "http://127.0.0.1:8080/v1");
});

test("configures the local provider without an API key or cloud consent", () => {
  const settings = {
    version: 1 as const,
    enabled: true,
    provider: "local" as const,
    models: { apple: "system-default", local: "local-model", openai: "o", anthropic: "a", kimi: "k" },
    localBaseUrl: "http://192.168.1.10:8080/v1"
  };
  const service = new InferenceService({ settings });
  assert.equal(service.configured, true);
  assert.equal(service.model, "local-model");
  assert.equal(cloudInferenceNeedsConsent(settings, { cloudInferenceConsents: [] } as never), false);
  assert.equal(cloudInferenceNeedsApiKey(settings, undefined), false);

  service.configure({ ...settings, localBaseUrl: "https://example.com/v1" });
  assert.equal(service.configured, false);
  assert.match(service.unavailableMessage, /private network/);
});

test("lists chat models from a private server and hides embedding models", async () => {
  let requested = "";
  const fakeFetch = (async (input: string) => {
    requested = input;
    return new Response(JSON.stringify({ data: [
      { id: "mlx-community/Qwen3.5-9B-4bit" }, { id: "nomic-embed-text-omlx" }, { id: "creative/dolphin" }
    ] }), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await probeLocalInferenceServer("http://127.0.0.1:8080/v1/", undefined, fakeFetch);
  assert.equal(requested, "http://127.0.0.1:8080/v1/models");
  assert.deepEqual(result, {
    ok: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    models: ["creative/dolphin", "mlx-community/Qwen3.5-9B-4bit"]
  });
});

test("never probes a public address", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  const result = await probeLocalInferenceServer("https://api.openai.com/v1", undefined, fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(called, false);
});
