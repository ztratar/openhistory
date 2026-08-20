import type { CollectionSettings } from "@shared/contracts";
import type { InferenceSettings } from "@shared/inference";
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COLLECTION_SETTINGS } from "./settings-store";
import { cloudInferenceNeedsCredential, cloudInferenceNeedsConsent } from "./privacy-consent";

const cloud: InferenceSettings = {
  version: 1,
  enabled: true,
  provider: "openai",
  models: { apple: "system-default", openai: "gpt-test", anthropic: "a", kimi: "k" }
};

test("requires specific confirmation before enabled cloud inference", () => {
  const collection = structuredClone(DEFAULT_COLLECTION_SETTINGS);
  assert.equal(cloudInferenceNeedsConsent(cloud, collection), true);
  assert.equal(cloudInferenceNeedsConsent({ ...cloud, enabled: false }, collection), false);
  assert.equal(cloudInferenceNeedsConsent({ ...cloud, provider: "apple" }, collection), false);
});

test("accepts only consent for the selected cloud provider", () => {
  const collection: CollectionSettings = {
    ...structuredClone(DEFAULT_COLLECTION_SETTINGS),
    cloudInferenceConsents: ["anthropic"]
  };
  assert.equal(cloudInferenceNeedsConsent(cloud, collection), true);
  collection.cloudInferenceConsents.push("openai");
  assert.equal(cloudInferenceNeedsConsent(cloud, collection), false);
});

test("requires a provider-specific API key before enabling cloud inference", () => {
  assert.equal(cloudInferenceNeedsCredential(cloud, {}), true);
  assert.equal(cloudInferenceNeedsCredential(cloud, { apiKey: "  " }), true);
  assert.equal(cloudInferenceNeedsCredential(cloud, { apiKey: "anthropic-key" }), false);
  assert.equal(cloudInferenceNeedsCredential({ ...cloud, enabled: false }, {}), false);
  assert.equal(cloudInferenceNeedsCredential({ ...cloud, provider: "apple" }, {}), false);
});

test("accepts an isolated ChatGPT account instead of an OpenAI API key", () => {
  const chatgpt = { ...cloud, openAIAuthMode: "chatgpt" as const };
  assert.equal(cloudInferenceNeedsCredential(chatgpt, {}), true);
  assert.equal(cloudInferenceNeedsCredential(chatgpt, { chatGPTSignedIn: false }), true);
  assert.equal(cloudInferenceNeedsCredential(chatgpt, { chatGPTSignedIn: true }), false);
});
