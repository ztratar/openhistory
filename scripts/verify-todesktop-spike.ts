import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch as hostArchitecture } from "node:os";
import { resolve } from "node:path";
import config from "../todesktop";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  author?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const releaseToolPackage = JSON.parse(readFileSync(
  resolve(root, "tools/todesktop/package.json"),
  "utf8"
)) as { devDependencies?: Record<string, string>; overrides?: Record<string, unknown> };
const failures: string[] = [];

expect(packageJson.dependencies?.["@todesktop/runtime"] === "2.1.4", "ToDesktop runtime must remain pinned to 2.1.4");
expect(releaseToolPackage.devDependencies?.["@todesktop/cli"] === "1.28.0", "isolated ToDesktop CLI must remain pinned to 1.28.0");
expect(Boolean(releaseToolPackage.overrides?.["@todesktop/cli"]), "isolated ToDesktop CLI security override is missing");
expect(packageJson.devDependencies?.electron === "43.4.0", "Electron must remain an exact ToDesktop dev dependency");
expect(packageJson.devDependencies?.["@electron/packager"] === "20.3.0", "local Electron packager must remain pinned to 20.3.0");
expect(packageJson.devDependencies?.["@electron/fuses"] === "2.1.3", "local Electron fuses must remain pinned to 2.1.3");
expect(typeof packageJson.author === "string" && /<[^<>\s]+@[^<>\s]+>/.test(packageJson.author), "package author must contain a valid email");
expect(packageJson.scripts?.["todesktop:beforeBuild"] === "./scripts/todesktop-before-build.cjs", "beforeBuild hook must remain configured");
expect(packageJson.scripts?.["todesktop:afterPack"] === "./scripts/todesktop-after-pack.cjs", "afterPack hook must remain configured");
expect(packageJson.scripts?.["desktop:package:local"] === "npm run build:electron && node --import tsx scripts/package-local-app.ts", "local desktop packaging command changed");
expect(packageJson.scripts?.["desktop:smoke-test"]?.includes("smoke-test --ephemeral --latest") === true, "credentialed ToDesktop smoke-test command is missing");
expect(packageJson.scripts?.["desktop:verify:signed"] === "sh scripts/verify-signed-macos-app.sh", "signed macOS verification command changed");
expect(config.id === "260815ukaa3eq", "ToDesktop application identifier changed");
expect(config.appId === "io.github.ztratar.openhistory", "production bundle identifier changed");
expect(config.productName === "OpenHistory", "ToDesktop product name changed");
expect(config.asar === true, "application code must remain in ASAR");
expect(config.fuses?.runAsNode === false, "runAsNode fuse must remain disabled");
expect(config.fuses?.enableNodeOptionsEnvironmentVariable === false, "NODE_OPTIONS fuse must remain disabled");
expect(config.fuses?.enableNodeCliInspectArguments === false, "Node inspector fuse must remain disabled");
expect(config.fuses?.onlyLoadAppFromAsar === true, "Electron must load application code only from ASAR");

const uploadPatterns = config.appFiles ?? [];
expect(uploadPatterns.length > 0, "ToDesktop upload manifest must be explicit");
expect(!uploadPatterns.includes("**"), "ToDesktop must not upload the entire repository");
for (const pattern of uploadPatterns) {
  expect(!/(^|\/)(?:\.env|activity-data|fixtures\/inference\/private|reports\/private)/.test(pattern), `private path is present in upload manifest: ${pattern}`);
}
expect(!uploadPatterns.includes("src/**"), "Electron source must not be uploaded when prebuilt output is available");
for (const required of [
  "out/**",
  ".todesktop/native/universal/**",
  "scripts/todesktop-before-build.cjs",
  "scripts/todesktop-after-pack.cjs"
]) {
  expect(uploadPatterns.includes(required), `ToDesktop upload manifest is missing ${required}`);
}

const distributionPatterns = config.filesForDistribution ?? [];
for (const excluded of ["!.todesktop/**", "!native/**", "!scripts/**", "!todesktop.ts"]) {
  expect(distributionPatterns.includes(excluded), `distribution filter is missing ${excluded}`);
}

const mainSource = readFileSync(resolve(root, "src/main/index.ts"), "utf8");
const collectorSource = readFileSync(resolve(root, "src/main/collector-process.ts"), "utf8");
const appleSource = readFileSync(resolve(root, "src/main/inference/providers/apple.ts"), "utf8");
const localPackagerSource = readFileSync(resolve(root, "scripts/package-local-app.ts"), "utf8");
const beforeBuildSource = readFileSync(resolve(root, "scripts/todesktop-before-build.cjs"), "utf8");
const signedVerifierPath = resolve(root, "scripts/verify-signed-macos-app.sh");
const signedVerifierSource = readFileSync(signedVerifierPath, "utf8");
expect(mainSource.includes("todesktop.init();"), "ToDesktop runtime is not initialized in the main process");
expect(mainSource.includes("setPermissionCheckHandler(() => false)"), "renderer permission checks must fail closed");
expect(mainSource.includes("setPermissionRequestHandler"), "renderer permission requests must be denied explicitly");
expect(mainSource.includes("will-navigate"), "top-level renderer navigation must be guarded");
expect(collectorSource.includes("native/OpenHistory Collector.app/Contents/MacOS"), "collector does not know the packaged helper path");
expect(appleSource.includes("native/OpenHistory Collector.app/Contents/MacOS"), "Apple worker does not know the packaged helper path");
expect(localPackagerSource.includes("ignoreOutsideRuntimeAllowlist"), "local package must use a runtime file allowlist");
expect(localPackagerSource.includes("todesktop-after-pack.cjs"), "local package must exercise the ToDesktop native embedding hook");
expect(localPackagerSource.includes("OnlyLoadAppFromAsar"), "local package must enforce ASAR-only loading");
expect(beforeBuildSource.includes("out/main/index.js"), "beforeBuild must validate prebuilt Electron output");
expect(!beforeBuildSource.includes("build:electron"), "beforeBuild must not depend on remote development dependencies");
expect((statSync(signedVerifierPath).mode & 0o111) !== 0, "signed macOS verifier is not executable");
for (const required of ["Developer ID Application:", "Timestamp=", "flags=.*runtime", "spctl", "stapler validate"]) {
  expect(signedVerifierSource.includes(required), `signed macOS verifier is missing the ${required} gate`);
}

if (process.argv.includes("--native-bundle")) verifyNativeBundle();

if (failures.length > 0) {
  process.stderr.write(`ToDesktop spike verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`ToDesktop spike verification passed${process.argv.includes("--native-bundle") ? " with a release native bundle" : ""}.\n`);

function verifyNativeBundle(): void {
  const architecture = hostArchitecture() === "x64" ? "x64" : "arm64";
  const bundle = resolve(root, ".todesktop", "native", architecture, "OpenHistory Collector.app");
  const infoPlist = resolve(bundle, "Contents", "Info.plist");
  expect(existsSync(infoPlist), "release native helper Info.plist is missing");
  for (const name of ["activity-collector", "foundation-model-worker"]) {
    const executable = resolve(bundle, "Contents", "MacOS", name);
    expect(existsSync(executable) && statSync(executable).isFile(), `${name} is missing from the release helper`);
    if (existsSync(executable)) expect((statSync(executable).mode & 0o111) !== 0, `${name} is not executable`);
  }
  if (!existsSync(infoPlist)) return;

  const bundleIdentifier = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    infoPlist
  ], { encoding: "utf8" }).trim();
  expect(bundleIdentifier === "io.github.ztratar.openhistory.collector", "native helper bundle identifier changed");

  const signature = spawnSync("codesign", ["--verify", "--deep", "--strict", bundle], { encoding: "utf8" });
  expect(signature.status === 0, `local native helper signature is invalid: ${signature.stderr.trim()}`);

  const universalBundle = resolve(root, ".todesktop", "native", "universal", "OpenHistory Collector.app");
  const universalSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", universalBundle], { encoding: "utf8" });
  expect(universalSignature.status === 0, `universal ToDesktop helper baseline signature is invalid: ${universalSignature.stderr.trim()}`);
  for (const name of ["activity-collector", "foundation-model-worker"]) {
    const executable = resolve(universalBundle, "Contents", "MacOS", name);
    expect(existsSync(executable) && statSync(executable).isFile(), `${name} is missing from the universal ToDesktop helper`);
    if (!existsSync(executable)) continue;
    const architectures = spawnSync("lipo", ["-archs", executable], { encoding: "utf8" });
    expect(architectures.status === 0, `could not inspect ${name} architectures: ${architectures.stderr.trim()}`);
    expect(/\barm64\b/.test(architectures.stdout) && /\bx86_64\b/.test(architectures.stdout), `${name} is not universal`);
  }

  const worker = resolve(bundle, "Contents", "MacOS", "foundation-model-worker");
  if (!existsSync(worker)) return;
  const availability = spawnSync(worker, [], {
    input: JSON.stringify({ operation: "availability" }),
    encoding: "utf8",
    timeout: 10_000
  });
  expect(availability.status === 0, `Apple model worker availability probe failed: ${availability.stderr.trim()}`);
  try {
    const response = JSON.parse(availability.stdout.trim()) as { ok?: unknown };
    expect(response.ok === true, "Apple model worker availability response was not successful");
  } catch {
    failures.push("Apple model worker returned invalid JSON during availability probe");
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}
