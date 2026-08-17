import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "openhistory-todesktop-after-pack-"));
const appOutDir = resolve(temporaryRoot, "mac-arm64");
const application = resolve(appOutDir, "OpenHistory.app");
const destination = resolve(
  application,
  "Contents",
  "Resources",
  "native",
  "OpenHistory Collector.app"
);

try {
  mkdirSync(resolve(application, "Contents", "Resources"), { recursive: true });
  const require = createRequire(import.meta.url);
  const afterPack = require("./todesktop-after-pack.cjs") as (context: object) => Promise<void>;
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
  await afterPack({
    appDir: root,
    appOutDir,
    arch: 3,
    pkgJson: packageJson,
    packager: { appInfo: { productFilename: "OpenHistory" } }
  });

  for (const name of ["activity-collector", "foundation-model-worker"]) {
    const executable = resolve(destination, "Contents", "MacOS", name);
    if (!existsSync(executable)) throw new Error(`afterPack did not embed ${name}`);
  }
  const accessibilityProbe = resolve(
    application,
    "Contents",
    "Resources",
    "native",
    "accessibility-identity-probe.node"
  );
  if (!existsSync(accessibilityProbe)) throw new Error("afterPack did not embed the Accessibility identity spike module");
  const identifier = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    resolve(destination, "Contents", "Info.plist")
  ], { encoding: "utf8" }).trim();
  if (identifier !== "io.github.ztratar.openhistory.collector") {
    throw new Error(`afterPack embedded unexpected helper identity: ${identifier}`);
  }
  process.stdout.write("ToDesktop afterPack integration passed with an isolated synthetic app bundle.\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
