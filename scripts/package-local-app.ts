import { listPackage } from "@electron/asar";
import {
  flipFuses,
  FuseV1Options,
  FuseVersion
} from "@electron/fuses";
import { packager } from "@electron/packager";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { arch as hostArchitecture, homedir } from "node:os";
import { resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { selectLocalSigningIdentity } from "./local-signing-identity";

const root = resolve(import.meta.dirname, "..");
const architecture = hostArchitecture();
if (process.platform !== "darwin" || (architecture !== "arm64" && architecture !== "x64")) {
  throw new Error("Local OpenHistory packaging supports ARM64 and Intel macOS hosts only");
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  version: string;
};
const outputRoot = resolve(root, ".todesktop", "local");
const applicationPaths = await packager({
  dir: root,
  name: "OpenHistory",
  platform: "darwin",
  arch: architecture,
  out: outputRoot,
  overwrite: true,
  asar: true,
  prune: true,
  appBundleId: "io.github.ztratar.openhistory",
  appCategoryType: "public.app-category.productivity",
  appVersion: packageJson.version,
  buildVersion: packageJson.version,
  icon: resolve(root, "resources", "OpenHistory.icns"),
  extraResource: [resolve(root, "resources", "openhistory-icon.png")],
  ignore: ignoreOutsideRuntimeAllowlist,
  osxSign: undefined
});

if (applicationPaths.length !== 1) {
  throw new Error(`Expected one local application but Electron Packager returned ${applicationPaths.length}`);
}
const packagedDirectory = applicationPaths[0];
const application = resolve(packagedDirectory, "OpenHistory.app");
const toDesktopArchitecture = architecture === "arm64" ? 3 : 1;
const require = createRequire(import.meta.url);
const afterPack = require("./todesktop-after-pack.cjs") as (context: object) => Promise<void>;
await afterPack({
  appDir: root,
  appOutDir: packagedDirectory,
  arch: toDesktopArchitecture,
  pkgJson: packageJson,
  packager: { appInfo: { productFilename: "OpenHistory" } }
});

const mainExecutable = resolve(application, "Contents", "MacOS", "OpenHistory");
await flipFuses(mainExecutable, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true
});

const nativeDirectory = resolve(
  application,
  "Contents",
  "Resources",
  "native"
);
const nativeComponents = [
  "libOpenHistoryCollector.dylib",
  "openhistory-native.node",
  "foundation-model-worker"
].map((name) => resolve(nativeDirectory, name));
const availableIdentities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
  encoding: "utf8"
});
const signingConfigPath = resolve(homedir(), ".config", "openhistory", "local-signing.json");
const signingConfig = existsSync(signingConfigPath)
  ? JSON.parse(readFileSync(signingConfigPath, "utf8")) as { expectedIdentitySha1?: string; expectedTeamIdentifier?: string }
  : {};
const signingIdentity = selectLocalSigningIdentity(availableIdentities, {
  configuredIdentity: process.env.OPENHISTORY_CODESIGN_IDENTITY,
  expectedSha1: process.env.OPENHISTORY_CODESIGN_SHA1 ?? signingConfig.expectedIdentitySha1
});
const signingValue = signingIdentity?.sha1 ?? "-";
if (!signingIdentity) {
  process.stderr.write("Warning: no Apple Development identity found; using ad-hoc signing. Accessibility must be granted again after rebuilds.\n");
} else {
  process.stdout.write(`Signing local application with: ${signingIdentity.name} (${signingIdentity.sha1})\n`);
}
for (const component of nativeComponents) {
  execFileSync("codesign", ["--force", "--sign", signingValue, "--timestamp=none", component], {
    stdio: "inherit"
  });
}
execFileSync("codesign", ["--force", "--deep", "--sign", signingValue, "--timestamp=none", application], {
  stdio: "inherit"
});

verifyApplication(
  application,
  signingIdentity,
  process.env.OPENHISTORY_CODESIGN_TEAM_ID ?? signingConfig.expectedTeamIdentifier
);
process.stdout.write(`Local application ready: ${application}\n`);

function ignoreOutsideRuntimeAllowlist(candidate: string): boolean {
  const path = candidate.replaceAll("\\", "/");
  if (path === "" || path === "/package.json") return false;
  const allowedDirectory = ["/out", "/node_modules"].some(
    (directory) => path === directory || path.startsWith(`${directory}/`)
  );
  return !allowedDirectory;
}

function verifyApplication(
  applicationPath: string,
  expectedIdentity: { sha1: string; name: string } | undefined,
  expectedTeamIdentifier: string | undefined
): void {
  const infoPlist = resolve(applicationPath, "Contents", "Info.plist");
  const bundleIdentifier = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    infoPlist
  ], { encoding: "utf8" }).trim();
  if (bundleIdentifier !== "io.github.ztratar.openhistory") {
    throw new Error(`Unexpected local bundle identifier: ${bundleIdentifier}`);
  }

  for (const component of nativeComponents) {
    if (!statSync(component).isFile() || (statSync(component).mode & 0o111) === 0) {
      throw new Error(`Local package is missing native component: ${component}`);
    }
  }

  const asarPath = resolve(applicationPath, "Contents", "Resources", "app.asar");
  const unexpectedTopLevels = new Set(
    listPackage(asarPath, { isPack: false })
      .map((entry) => entry.replace(/^\//, "").split("/")[0])
      .filter((entry) => entry && !["node_modules", "out", "package.json"].includes(entry))
  );
  if (unexpectedTopLevels.size > 0) {
    throw new Error(`Unexpected files in local application ASAR: ${[...unexpectedTopLevels].join(", ")}`);
  }

  execFileSync("codesign", ["--verify", "--deep", "--strict", applicationPath], {
    stdio: "inherit"
  });
  const display = spawnSync("codesign", ["-dv", "--verbose=4", applicationPath], { encoding: "utf8" });
  if (display.status !== 0) throw new Error(`Could not inspect packaged signature: ${display.stderr}`);
  const signingDetails = `${display.stdout ?? ""}\n${display.stderr ?? ""}`;
  if (expectedIdentity && !signingDetails.includes(`Authority=${expectedIdentity.name}`)) {
    throw new Error(`Packaged signature did not use expected authority: ${expectedIdentity.name}`);
  }
  if (expectedTeamIdentifier && !signingDetails.includes(`TeamIdentifier=${expectedTeamIdentifier}`)) {
    throw new Error(`Packaged signature did not use expected team: ${expectedTeamIdentifier}`);
  }
  execFileSync("plutil", ["-lint", infoPlist], { stdio: "inherit" });
}
