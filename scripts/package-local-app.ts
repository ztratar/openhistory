import { listPackage } from "@electron/asar";
import {
  flipFuses,
  FuseV1Options,
  FuseVersion
} from "@electron/fuses";
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { arch as hostArchitecture, homedir, tmpdir } from "node:os";
import { parse, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";

const root = resolve(import.meta.dirname, "..");
const architecture = hostArchitecture();
if (process.platform !== "darwin" || (architecture !== "arm64" && architecture !== "x64")) {
  throw new Error("Local OpenHistory packaging supports ARM64 and Intel macOS hosts only");
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  version: string;
};
const outputRoot = localPackageOutputRoot(process.env.OPENHISTORY_LOCAL_PACKAGE_OUTPUT);
const applicationPaths = await packager({
  dir: root,
  name: "OpenHistory",
  platform: "darwin",
  arch: architecture,
  out: outputRoot,
  overwrite: true,
  asar: {
    unpack: "**/{.**,**}/**/*.node",
    unpackDir: "node_modules/@openai/codex-*/vendor/**"
  },
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
clearUnsupportedSigningMetadata(application);
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
for (const component of nativeComponents) {
  execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", component], {
    stdio: "inherit"
  });
}
clearUnsupportedSigningMetadata(application);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", application], {
  stdio: "inherit"
});

verifyApplication(application);
process.stdout.write(`Local application ready: ${application}\n`);

function localPackageOutputRoot(override: string | undefined): string {
  if (!override) return resolve(root, ".todesktop", "local");
  const candidate = resolve(override);
  const forbidden = new Set([parse(candidate).root, homedir(), tmpdir(), root]);
  if (forbidden.has(candidate)) {
    throw new Error("OPENHISTORY_LOCAL_PACKAGE_OUTPUT must be a dedicated subdirectory");
  }
  return candidate;
}

function clearUnsupportedSigningMetadata(applicationPath: string): void {
  execFileSync("xattr", ["-cr", applicationPath], { stdio: "inherit" });
}

function ignoreOutsideRuntimeAllowlist(candidate: string): boolean {
  const path = candidate.replaceAll("\\", "/");
  if (path === "" || path === "/package.json") return false;
  const allowedDirectory = ["/out", "/node_modules"].some(
    (directory) => path === directory || path.startsWith(`${directory}/`)
  );
  return !allowedDirectory;
}

function verifyApplication(applicationPath: string): void {
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
  execFileSync("plutil", ["-lint", infoPlist], { stdio: "inherit" });
}
