import Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { z } from "zod";
import { AnthropicProvider } from "./inference/providers/anthropic";
import { KimiProvider } from "./inference/providers/kimi";
import { OpenAIProvider } from "./inference/providers/openai";
import { InferenceOutputError } from "./inference/errors";

const schema = z.object({ title: z.string() });
const request = {
  instructions: "Synthetic instructions",
  input: "Synthetic input",
  schema,
  schemaName: "synthetic_entry",
  maxOutputTokens: 321
};

test("preserves the OpenAI structured response contract", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    responses: {
      parse: async (value: Record<string, unknown>) => {
        captured = value;
        return { output_parsed: { title: "Structured result" } };
      }
    }
  } as unknown as OpenAI;

  const result = await new OpenAIProvider("synthetic-key", "synthetic-openai", client).generate(request);
  assert.deepEqual(result, { title: "Structured result" });
  assert.equal(captured?.model, "synthetic-openai");
  assert.equal(captured?.instructions, request.instructions);
  assert.equal(captured?.input, request.input);
  assert.equal(captured?.max_output_tokens, 321);
  assert.equal(captured?.store, false);
});

test("classifies incomplete and refused OpenAI responses without exposing their text", async () => {
  const incompleteClient = {
    responses: {
      parse: async () => ({
        output_parsed: null,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: []
      })
    }
  } as unknown as OpenAI;
  await assert.rejects(
    () => new OpenAIProvider("synthetic-key", "synthetic-openai", incompleteClient).generate(request),
    (error: unknown) => error instanceof InferenceOutputError && error.kind === "incomplete"
  );

  const refusalClient = {
    responses: {
      parse: async () => ({
        output_parsed: null,
        status: "completed",
        incomplete_details: null,
        output: [{ type: "message", content: [{ type: "refusal", refusal: "private refusal text" }] }]
      })
    }
  } as unknown as OpenAI;
  await assert.rejects(
    () => new OpenAIProvider("synthetic-key", "synthetic-openai", refusalClient).generate(request),
    (error: unknown) => error instanceof InferenceOutputError &&
      error.kind === "refusal" && !error.message.includes("private refusal text")
  );
});

test("preserves the Anthropic structured message contract", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    messages: {
      parse: async (value: Record<string, unknown>) => {
        captured = value;
        return { parsed_output: { title: "Structured result" } };
      }
    }
  } as unknown as Anthropic;

  const result = await new AnthropicProvider("synthetic-key", "synthetic-anthropic", client).generate(request);
  assert.deepEqual(result, { title: "Structured result" });
  assert.equal(captured?.model, "synthetic-anthropic");
  assert.equal(captured?.system, request.instructions);
  assert.equal(captured?.max_tokens, 321);
  assert.deepEqual(captured?.messages, [{ role: "user", content: request.input }]);
});

test("preserves Kimi compatibility limits and reasoning settings", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    chat: {
      completions: {
        parse: async (value: Record<string, unknown>) => {
          captured = value;
          return { choices: [{ message: { parsed: { title: "Structured result" } } }] };
        }
      }
    }
  } as unknown as OpenAI;

  const result = await new KimiProvider("synthetic-key", "kimi-k3", client).generate(request);
  assert.deepEqual(result, { title: "Structured result" });
  assert.equal(captured?.model, "kimi-k3");
  assert.equal(captured?.max_completion_tokens, 4_000);
  assert.equal(captured?.reasoning_effort, "low");
  assert.deepEqual(captured?.messages, [
    { role: "system", content: request.instructions },
    { role: "user", content: request.input }
  ]);
});
