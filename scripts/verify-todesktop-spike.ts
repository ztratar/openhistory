import { spawnSync } from "node:child_process";
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
expect(packageJson.scripts?.["desktop:package:local"] === "npm run build:electron && npm run package:native:todesktop && node --import tsx scripts/package-local-app.ts", "local desktop packaging command changed");
expect(packageJson.scripts?.["package:native:todesktop"]?.includes("native/bridge/build.sh universal release") === true, "ToDesktop native packaging must build the universal in-process collector bridge");
expect(packageJson.scripts?.["desktop:smoke-test"]?.includes("smoke-test --ephemeral --latest") === true, "credentialed ToDesktop smoke-test command is missing");
expect(packageJson.scripts?.["desktop:verify:signed"] === "sh scripts/verify-signed-macos-app.sh", "signed macOS verification command changed");
expect(config.id === "260815ukaa3eq", "ToDesktop application identifier changed");
expect(config.appId === "io.github.ztratar.openhistory", "production bundle identifier changed");
expect(config.productName === "OpenHistory", "ToDesktop product name changed");
expect(config.asar === true, "application code must remain in ASAR");
expect(config.asarUnpack?.includes("**/*.node") === true, "native Node modules must remain unpacked from ASAR");
expect(
  config.asarUnpack?.includes("node_modules/@openai/codex-*/vendor/**") === true,
  "the bundled Codex executable must be unpacked from ASAR"
);
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
const collectorSource = readFileSync(resolve(root, "src/main/collector-service.ts"), "utf8");
const appleSource = readFileSync(resolve(root, "src/main/inference/providers/apple.ts"), "utf8");
const localPackagerSource = readFileSync(resolve(root, "scripts/package-local-app.ts"), "utf8");
const nativeBridgeBuildSource = readFileSync(resolve(root, "native/bridge/build.sh"), "utf8");
const nativeAppPackagerSource = readFileSync(
  resolve(root, "native/collector/scripts/package-release-app.sh"),
  "utf8"
);
const beforeBuildSource = readFileSync(resolve(root, "scripts/todesktop-before-build.cjs"), "utf8");
const signedVerifierPath = resolve(root, "scripts/verify-signed-macos-app.sh");
const signedVerifierSource = readFileSync(signedVerifierPath, "utf8");
expect(mainSource.includes("todesktop.init();"), "ToDesktop runtime is not initialized in the main process");
expect(mainSource.includes("setPermissionCheckHandler(() => false)"), "renderer permission checks must fail closed");
expect(mainSource.includes("setPermissionRequestHandler"), "renderer permission requests must be denied explicitly");
expect(mainSource.includes("will-navigate"), "top-level renderer navigation must be guarded");
expect(collectorSource.includes('"native", "openhistory-native.node"'), "collector does not know the packaged native module path");
expect(collectorSource.includes("excludedProcessIdentifiers: [process.pid]"), "collector must exclude its Electron host process");
expect(appleSource.includes('resolve(process.resourcesPath, "native", name)'), "Apple worker does not know the packaged native worker path");
expect(localPackagerSource.includes("ignoreOutsideRuntimeAllowlist"), "local package must use a runtime file allowlist");
expect(localPackagerSource.includes("todesktop-after-pack.cjs"), "local package must exercise the ToDesktop native embedding hook");
expect(localPackagerSource.includes("OnlyLoadAppFromAsar"), "local package must enforce ASAR-only loading");
expect(localPackagerSource.includes("@openai/codex-*/vendor"), "local package must unpack the Codex executable");
expect(localPackagerSource.includes("clearUnsupportedSigningMetadata(application)"), "local package must normalize app metadata before signing");
expect(localPackagerSource.includes("OPENHISTORY_LOCAL_PACKAGE_OUTPUT"), "local package must support a non-File Provider staging directory");
expect(
  nativeBridgeBuildSource.includes("ActivityCore.build/BrowserProtectionState.swift.o"),
  "native bridge must link the browser-protection state implementation"
);
expect(nativeAppPackagerSource.includes('xattr -cr "${app_directory}"'), "native app must clear unsupported metadata before signing");
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
  const architectureDirectory = resolve(root, ".todesktop", "native", architecture);
  const stagingBundle = resolve(architectureDirectory, "OpenHistory Collector.app");
  const worker = resolve(stagingBundle, "Contents", "MacOS", "foundation-model-worker");
  expect(existsSync(worker) && statSync(worker).isFile(), "foundation-model-worker is missing from the release staging bundle");
  if (existsSync(worker)) expect((statSync(worker).mode & 0o111) !== 0, "foundation-model-worker is not executable");
  for (const name of ["openhistory-native.node", "libOpenHistoryCollector.dylib"]) {
    const executable = resolve(architectureDirectory, name);
    expect(existsSync(executable) && statSync(executable).isFile(), `${name} is missing from the release native bridge`);
    if (existsSync(executable)) expect((statSync(executable).mode & 0o111) !== 0, `${name} is not executable`);
    const signature = spawnSync("codesign", ["--verify", "--strict", executable], { encoding: "utf8" });
    expect(signature.status === 0, `${name} baseline signature is invalid: ${signature.stderr.trim()}`);
  }

  const universalDirectory = resolve(root, ".todesktop", "native", "universal");
  for (const name of ["openhistory-native.node", "libOpenHistoryCollector.dylib", "foundation-model-worker"]) {
    const executable = name === "foundation-model-worker"
      ? resolve(universalDirectory, "OpenHistory Collector.app", "Contents", "MacOS", name)
      : resolve(universalDirectory, name);
    expect(existsSync(executable) && statSync(executable).isFile(), `${name} is missing from the universal ToDesktop native components`);
    if (!existsSync(executable)) continue;
    const architectures = spawnSync("lipo", ["-archs", executable], { encoding: "utf8" });
    expect(architectures.status === 0, `could not inspect ${name} architectures: ${architectures.stderr.trim()}`);
    expect(/\barm64\b/.test(architectures.stdout) && /\bx86_64\b/.test(architectures.stdout), `${name} is not universal`);
  }

  const universalModule = resolve(universalDirectory, "openhistory-native.node");
  if (existsSync(universalModule)) {
    const dependencies = spawnSync("otool", ["-L", universalModule], { encoding: "utf8" });
    expect(dependencies.status === 0, `could not inspect native module dependencies: ${dependencies.stderr.trim()}`);
    expect(dependencies.stdout.includes("@rpath/libOpenHistoryCollector.dylib"), "native module does not link the embedded collector library through @rpath");
  }

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
