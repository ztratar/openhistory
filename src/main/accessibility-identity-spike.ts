import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writePrivateFile } from "./private-storage";

interface AccessibilityIdentityProbe {
  isTrusted(): boolean;
  requestTrust(): boolean;
  processIdentifier(): number;
  canReadFocusedApplication(): boolean;
  bundleIdentifier(): string | null;
}

interface AccessibilityIdentityResult {
  timestamp: string;
  javascriptProcessIdentifier: number;
  nativeProcessIdentifier: number;
  processIdentifiersMatch: boolean;
  bundleIdentifier: string | null;
  accessibilityTrusted: boolean;
  focusedApplicationReadable: boolean;
  promptRequested: boolean;
}

export const ACCESSIBILITY_IDENTITY_SPIKE_ENABLED =
  process.env.OPENHISTORY_ACCESSIBILITY_IDENTITY_SPIKE === "1";

export function startAccessibilityIdentitySpike(dataDirectory: string): () => void {
  if (!ACCESSIBILITY_IDENTITY_SPIKE_ENABLED) return () => undefined;

  const modulePath = accessibilityIdentityProbePath();
  const require = createRequire(import.meta.url);
  const probe = require(modulePath) as AccessibilityIdentityProbe;
  const promptRequested = process.env.OPENHISTORY_ACCESSIBILITY_IDENTITY_PROMPT === "1";
  if (promptRequested) probe.requestTrust();

  const resultPath = resolve(dataDirectory, "accessibility-identity-spike.json");
  let previousTrusted: boolean | undefined;
  const record = (): void => {
    const nativeProcessIdentifier = probe.processIdentifier();
    const result: AccessibilityIdentityResult = {
      timestamp: new Date().toISOString(),
      javascriptProcessIdentifier: process.pid,
      nativeProcessIdentifier,
      processIdentifiersMatch: nativeProcessIdentifier === process.pid,
      bundleIdentifier: probe.bundleIdentifier(),
      accessibilityTrusted: probe.isTrusted(),
      focusedApplicationReadable: probe.canReadFocusedApplication(),
      promptRequested
    };
    if (result.accessibilityTrusted === previousTrusted) return;
    previousTrusted = result.accessibilityTrusted;
    writePrivateFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.info("Accessibility identity spike", result);
  };

  record();
  const timer = setInterval(record, 1_000);
  return () => clearInterval(timer);
}

function accessibilityIdentityProbePath(): string {
  const candidates = [
    resolve(process.resourcesPath, "native", "accessibility-identity-probe.node"),
    resolve(process.cwd(), ".todesktop/native/universal/accessibility-identity-probe.node")
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error("Accessibility identity spike module is missing; run npm run package:accessibility-spike");
  }
  return found;
}
