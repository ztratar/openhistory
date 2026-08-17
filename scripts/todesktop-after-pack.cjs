const { execFileSync } = require("node:child_process");
const { cpSync, existsSync, mkdirSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const SUPPORTED_ARCHITECTURES = new Set([1, 3, 4]);

module.exports = async ({ appDir, appOutDir, arch, packager }) => {
  if (process.platform !== "darwin") {
    throw new Error("OpenHistory's ToDesktop packaging supports macOS builds only");
  }
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported packaged architecture: ${String(arch)}`);
  }

  const nativeSource = path.join(
    appDir,
    ".todesktop",
    "native",
    "universal"
  );
  const application = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  const destination = path.join(
    application,
    "Contents",
    "Resources",
    "native"
  );
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const sources = {
    "openhistory-native.node": path.join(nativeSource, "openhistory-native.node"),
    "libOpenHistoryCollector.dylib": path.join(nativeSource, "libOpenHistoryCollector.dylib"),
    "foundation-model-worker": path.join(
      nativeSource,
      "OpenHistory Collector.app",
      "Contents",
      "MacOS",
      "foundation-model-worker"
    )
  };
  for (const [name, source] of Object.entries(sources)) {
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(`Packaged native component is missing: ${name}`);
    }
    cpSync(source, path.join(destination, name));
  }
  verifyNativeBundle(destination);
  console.log(`Embedded baseline-signed universal native components for ToDesktop Developer ID signing: ${destination}`);
};

function verifyNativeBundle(bundle) {
  for (const name of ["openhistory-native.node", "libOpenHistoryCollector.dylib", "foundation-model-worker"]) {
    const executable = path.join(bundle, name);
    if (!existsSync(executable) || !statSync(executable).isFile()) {
      throw new Error(`Packaged native executable is missing: ${name}`);
    }
    if ((statSync(executable).mode & 0o111) === 0) {
      throw new Error(`Packaged native executable is not executable: ${name}`);
    }
  }
  execFileSync("codesign", ["--verify", "--strict", path.join(bundle, "openhistory-native.node")], {
    stdio: "inherit"
  });
  execFileSync("codesign", ["--verify", "--strict", path.join(bundle, "libOpenHistoryCollector.dylib")], {
    stdio: "inherit"
  });
  execFileSync("codesign", ["--verify", "--strict", path.join(bundle, "foundation-model-worker")], {
    stdio: "inherit"
  });
}
