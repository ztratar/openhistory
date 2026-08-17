import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInferenceOnboardingAvailability,
  normalizeInferenceOnboardingSelection
} from "./inference-onboarding";
import { appleInferenceAvailabilityGuidance } from "../shared/inference";

test("accepts the supported Apple model without a credential", () => {
  assert.deepEqual(normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default"
  }), {
    provider: "apple",
    model: "system-default",
    captureEmailActivity: false,
    captureMessagingActivity: false,
    appPresentationMode: "dock"
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
    captureMessagingActivity: false,
    appPresentationMode: "dock"
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
    captureMessagingActivity: false,
    appPresentationMode: "dock"
  });
  assert.throws(() => normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default",
    captureMessagingActivity: "yes"
  }), /Invalid messaging capture selection/);
  assert.throws(() => normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default",
    appPresentationMode: "window"
  }), /Invalid app presentation selection/);
});

test("accepts menu bar presentation during onboarding", () => {
  assert.equal(normalizeInferenceOnboardingSelection({
    provider: "apple",
    model: "system-default",
    appPresentationMode: "menuBar"
  }).appPresentationMode, "menuBar");
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

test("gives Apple Intelligence and macOS failures distinct next steps", () => {
  const disabled = appleInferenceAvailabilityGuidance({
    available: false,
    reasonCode: "appleIntelligenceNotEnabled"
  });
  assert.equal(disabled.title, "Turn on Apple Intelligence");
  assert.match(disabled.description, /System Settings/);
  assert.match(disabled.helpUrl ?? "", /^https:\/\/support\.apple\.com\//);
  assert.doesNotMatch(disabled.description, /Update macOS/);

  const outdated = appleInferenceAvailabilityGuidance({
    available: false,
    reason: "This Mac is running macOS 15.7. Apple On-Device requires macOS 26 or later.",
    reasonCode: "unsupportedOperatingSystem"
  });
  assert.equal(outdated.title, "Update macOS to use Apple On-Device");
  assert.match(outdated.description, /macOS 15\.7/);
  assert.equal(outdated.helpLabel, "How to update macOS");
});

test("does not recommend an OS update for an ineligible Mac or pending model", () => {
  const ineligible = appleInferenceAvailabilityGuidance({
    available: false,
    reasonCode: "deviceNotEligible"
  });
  assert.match(ineligible.description, /cloud provider/);
  assert.doesNotMatch(ineligible.description, /Update macOS/);

  const pending = appleInferenceAvailabilityGuidance({
    available: false,
    reasonCode: "modelNotReady"
  });
  assert.match(pending.description, /power and Wi-Fi/);
  assert.doesNotMatch(pending.description, /Update macOS/);
});
