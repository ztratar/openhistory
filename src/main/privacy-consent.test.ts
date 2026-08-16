import type { CollectionSettings } from "@shared/contracts";
import type { InferenceSettings } from "@shared/inference";
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COLLECTION_SETTINGS } from "./settings-store";
import { cloudInferenceNeedsApiKey, cloudInferenceNeedsConsent } from "./privacy-consent";

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
  assert.equal(cloudInferenceNeedsApiKey(cloud, undefined), true);
  assert.equal(cloudInferenceNeedsApiKey(cloud, "  "), true);
  assert.equal(cloudInferenceNeedsApiKey(cloud, "anthropic-key"), false);
  assert.equal(cloudInferenceNeedsApiKey({ ...cloud, enabled: false }, undefined), false);
  assert.equal(cloudInferenceNeedsApiKey({ ...cloud, provider: "apple" }, undefined), false);
});
