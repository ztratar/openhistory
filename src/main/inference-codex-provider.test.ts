import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { CodexChatGPTProvider } from "./inference/providers/codex";
import { InferenceOutputError } from "./inference/errors";

const request = {
  instructions: "Synthetic instructions",
  input: "Synthetic evidence",
  schema: z.object({ title: z.string() }),
  schemaName: "synthetic_entry",
  maxOutputTokens: 321
};
const runtime = {
  codexHome: "/private/openhistory/codex",
  executablePath: "/synthetic/codex",
  workingDirectory: "/private/openhistory/codex/workspace"
};

test("runs structured inference through a locked-down Codex SDK thread", async () => {
  let threadOptions: Record<string, unknown> | undefined;
  let prompt = "";
  let outputSchema: unknown;
  const client = {
    startThread(options: Record<string, unknown>) {
      threadOptions = options;
      return {
        async run(input: string, turn: { outputSchema: unknown }) {
          prompt = input;
          outputSchema = turn.outputSchema;
          return { finalResponse: JSON.stringify({ title: "Structured result" }) };
        }
      };
    }
  };

  const result = await new CodexChatGPTProvider("synthetic-codex", runtime, client).generate(request);
  assert.deepEqual(result, { title: "Structured result" });
  assert.deepEqual(threadOptions, {
    model: "synthetic-codex",
    sandboxMode: "read-only",
    workingDirectory: runtime.workingDirectory,
    skipGitRepoCheck: true,
    modelReasoningEffort: "low",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never"
  });
  assert.match(prompt, /Do not use tools/);
  assert.match(prompt, /Synthetic evidence/);
  assert.equal(typeof outputSchema, "object");
});

test("classifies malformed SDK output without exposing it", async () => {
  const client = {
    startThread() {
      return { async run() { return { finalResponse: "private malformed output" }; } };
    }
  };
  await assert.rejects(
    () => new CodexChatGPTProvider("synthetic-codex", runtime, client).generate(request),
    (error: unknown) => error instanceof InferenceOutputError &&
      error.kind === "invalid_output" && !error.message.includes("private malformed output")
  );
});
