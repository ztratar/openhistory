const { execFileSync } = require("node:child_process");
const { cpSync, existsSync, mkdirSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const SUPPORTED_ARCHITECTURES = new Set([1, 3, 4]);

module.exports = async ({ appDir, appOutDir, arch, packager }) => {
  if (process.platform !== "darwin") {
    throw new Error("OpenHistory's ToDesktop spike supports macOS builds only");
  }
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported packaged architecture: ${String(arch)}`);
  }

  const source = path.join(
    appDir,
    ".todesktop",
    "native",
    "universal",
    "OpenHistory Collector.app"
  );
  const application = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  const destination = path.join(
    application,
    "Contents",
    "Resources",
    "native",
    "OpenHistory Collector.app"
  );
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: false });
  verifyNativeBundle(destination);
  const accessibilityProbeSource = path.join(
    appDir,
    ".todesktop",
    "native",
    "universal",
    "accessibility-identity-probe.node"
  );
  const accessibilityProbeDestination = path.join(
    application,
    "Contents",
    "Resources",
    "native",
    "accessibility-identity-probe.node"
  );
  if (!existsSync(accessibilityProbeSource)) {
    throw new Error("Accessibility identity spike module is missing; run npm run package:accessibility-spike");
  }
  cpSync(accessibilityProbeSource, accessibilityProbeDestination);
  console.log(`Embedded baseline-signed universal native components for ToDesktop Developer ID signing: ${destination}`);
};

function verifyNativeBundle(bundle) {
  const executableDirectory = path.join(bundle, "Contents", "MacOS");
  for (const name of ["activity-collector", "foundation-model-worker"]) {
    const executable = path.join(executableDirectory, name);
    if (!existsSync(executable) || !statSync(executable).isFile()) {
      throw new Error(`Packaged native executable is missing: ${name}`);
    }
    if ((statSync(executable).mode & 0o111) === 0) {
      throw new Error(`Packaged native executable is not executable: ${name}`);
    }
  }
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    path.join(bundle, "Contents", "Info.plist")
  ], { stdio: ["ignore", "pipe", "inherit"] });
}
