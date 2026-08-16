import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInferenceOnboardingAvailability,
  normalizeInferenceOnboardingSelection
} from "./inference-onboarding";

test("accepts the supported Apple model without a credential", () => {
  assert.deepEqual(normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default"
  }), {
    provider: "apple",
    model: "system-default",
    captureEmailActivity: false,
    captureMessagingActivity: false
  });
});

test("requires and trims a cloud credential", () => {
  assert.deepEqual(normalizeInferenceOnboardingSelection({
    provider: "openai",
    model: "gpt-5.6-luna",
    apiKey: "  sk-synthetic  "
  }), {
    provider: "openai",
    model: "gpt-5.6-luna",
    apiKey: "sk-synthetic",
    captureEmailActivity: false,
    captureMessagingActivity: false
  });
  assert.throws(() => normalizeInferenceOnboardingSelection({
    provider: "anthropic",
    model: "claude-sonnet-5"
  }), /requires an API key/);
});

test("normalizes independent onboarding capture opt-ins", () => {
  assert.deepEqual(normalizeInferenceOnboardingSelection({
    provider: "openai",
    model: "gpt-5.6-luna",
    apiKey: "sk-synthetic",
    captureEmailActivity: true,
    captureMessagingActivity: false
  }), {
    provider: "openai",
    model: "gpt-5.6-luna",
    apiKey: "sk-synthetic",
    captureEmailActivity: true,
    captureMessagingActivity: false
  });
  assert.throws(() => normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default",
    captureMessagingActivity: "yes"
  }), /Invalid messaging capture selection/);
});

test("rejects unlisted providers and models", () => {
  assert.throws(() => normalizeInferenceOnboardingSelection({
    provider: "unknown",
    model: "anything"
  }), /Invalid inference provider/);
  assert.throws(() => normalizeInferenceOnboardingSelection({
    provider: "kimi",
    model: "unlisted-model",
    apiKey: "key"
  }), /supported model/);
});

test("blocks unavailable Apple inference during onboarding", () => {
  const selection = normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default"
  });
  assert.throws(() => assertInferenceOnboardingAvailability(selection, {
    available: false,
    reason: "macOS 26 or later is required."
  }), /macOS 26 or later is required/);
  assert.doesNotThrow(() => assertInferenceOnboardingAvailability(selection, { available: true }));
});

test("does not apply Apple availability to cloud onboarding", () => {
  const selection = normalizeInferenceOnboardingSelection({
    provider: "openai",
    model: "gpt-5.6-luna",
    apiKey: "sk-synthetic"
  });
  assert.doesNotThrow(() => assertInferenceOnboardingAvailability(selection, {
    available: false,
    reason: "macOS 26 or later is required."
  }));
});
