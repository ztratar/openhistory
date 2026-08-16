import assert from "node:assert/strict";
import test from "node:test";
import { InferenceOutputError } from "./inference/errors";
import { publicInferenceErrorMessage } from "./openai-error";

test("never exposes credential fragments from authentication errors", () => {
  const message = publicInferenceErrorMessage({
    status: 401,
    message: "Incorrect API key provided: sk-sensitive-fragment"
  }, "Timeline summarization", "anthropic");
  assert.equal(message.includes("sk-sensitive"), false);
  assert.match(message, /couldn't connect with this API key/i);
});

test("turns rate limits into a retryable public message", () => {
  const message = publicInferenceErrorMessage({ status: 429 }, "Daily rollup consolidation", "kimi");
  assert.match(message, /try again automatically/i);
  assert.doesNotMatch(message, /status|process|log/i);
});

test("turns malformed model output into a user-facing timeline message", () => {
  const message = publicInferenceErrorMessage(
    new InferenceOutputError("invalid_output"),
    "Timeline summarization",
    "openai"
  );
  assert.match(message, /couldn't update part of your timeline/i);
  assert.match(message, /nothing was lost/i);
  assert.doesNotMatch(message, /main-process|status code|structured output/i);
});
