const { existsSync, statSync } = require("node:fs");
const path = require("node:path");

const REQUIRED_ELECTRON_OUTPUTS = [
  "out/main/index.js",
  "out/preload/index.cjs",
  "out/renderer/index.html"
];

module.exports = async ({ appDir, arch }) => {
  if (process.platform !== "darwin") {
    throw new Error("OpenHistory's ToDesktop spike supports macOS builds only");
  }
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported ToDesktop build architecture: ${String(arch)}`);
  }

  for (const relativePath of REQUIRED_ELECTRON_OUTPUTS) {
    const output = path.join(appDir, relativePath);
    if (!existsSync(output) || !statSync(output).isFile() || statSync(output).size === 0) {
      throw new Error(`Prebuilt Electron output is missing or empty: ${relativePath}`);
    }
  }

  console.log(`Using verified prebuilt OpenHistory Electron assets for macOS ${arch}`);
};
