import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installedApplicationPath, listInstalledApplications } from "./installed-applications";

test("lists application names and bundle identifiers from macOS app bundles", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-installed-applications-"));
  try {
    const betaPath = createApplication(directory, "Beta.app", "com.example.beta", "Beta");
    createApplication(directory, "Alpha.app", "com.example.alpha", "Alpha Display Name");

    assert.deepEqual(listInstalledApplications([directory]), [
      { bundleIdentifier: "com.example.alpha", name: "Alpha Display Name" },
      { bundleIdentifier: "com.example.beta", name: "Beta" }
    ]);
    assert.equal(installedApplicationPath("com.example.beta"), betaPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createApplication(
  directory: string,
  filename: string,
  bundleIdentifier: string,
  displayName: string
): string {
  const applicationPath = join(directory, filename);
  const contents = join(applicationPath, "Contents");
  mkdirSync(contents, { recursive: true });
  writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
  <key>CFBundleDisplayName</key><string>${displayName}</string>
</dict></plist>
`);
  return applicationPath;
}
