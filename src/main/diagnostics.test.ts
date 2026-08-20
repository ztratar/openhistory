import type { BootstrapState } from "@shared/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { sanitizedDiagnostics } from "./diagnostics";

test("diagnostics omit activity content, local paths, errors, and credentials", () => {
  const secret = "PRIVATE_DIAGNOSTIC_SENTINEL";
  const state = {
    collectorState: "running",
    collectionEnabled: true,
    dataDirectory: `/Users/example/${secret}/activity-data`,
    inference: {
      settings: {
        version: 1,
        enabled: true,
        provider: "openai",
        openAIAuthMode: "chatgpt",
        models: { apple: "system-default", openai: "gpt-test", anthropic: "a", kimi: "k" }
      },
      configured: true,
      appleAvailability: { available: false, reason: secret },
      codexAccount: { status: "signedIn", email: `${secret}@example.com`, planType: "plus" },
      keySources: { apple: "none", openai: "saved", anthropic: "none", kimi: "none" }
    },
    recentEvents: [{ id: secret }],
    timeline: { items: [{ title: secret }], pendingEpisodeCount: 1, summarizing: false, lastError: secret },
    hour: { items: [{ title: secret }], pendingHourCount: 2, consolidating: false, lastError: secret },
    dailyRollup: { items: [{ title: secret }], pendingDayCount: 3, consolidating: false, lastError: secret },
    settings: {
      version: 1,
      privacyNoticeVersion: 1,
      inferenceOnboardingVersion: 1,
      cloudInferenceConsents: ["openai"],
      appearanceMode: "dark",
      captureWindowTitles: true,
      captureFocusedElements: true,
      captureTextInput: true,
      capturePointerClicks: true,
      captureBrowserURLs: true,
      captureDocumentContext: true,
      captureUISnapshots: true,
      captureEmailActivity: false,
      captureMessagingActivity: false,
      excludedBundleIdentifiers: [secret]
    },
    accessibilityTrusted: true,
    agentAccess: {
      status: "running",
      endpoint: secret,
      connections: [{ id: secret, name: secret, createdAt: new Date().toISOString(), accessCount: 1 }],
      projection: { timelineCount: 1, dailyRollupCount: 1 }
    }
  } as unknown as BootstrapState;

  const output = JSON.stringify(sanitizedDiagnostics(state, {
    appVersion: "1.0.0",
    electronVersion: "43",
    nodeVersion: "22",
    platform: "darwin",
    architecture: "arm64",
    osRelease: "26.0"
  }));
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /"contentIncluded":false/);
  assert.match(output, /"timelineCount":1/);
});
