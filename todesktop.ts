const config = {
  schemaVersion: 1,
  id: "260815ukaa3eq",
  appId: "io.github.ztratar.openhistory",
  productName: "OpenHistory",
  icon: "./resources/OpenHistory.icns",
  appPath: ".",
  packageManager: "npm",
  nodeVersion: "22.19.0",
  npmVersion: "10.9.3",
  asar: true,
  asarUnpack: [
    "**/*.node",
    "node_modules/@openai/codex-*/vendor/**"
  ],
  fuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableCookieEncryption: true,
    onlyLoadAppFromAsar: true
  },
  appFiles: [
    "out/**",
    "!out/**/.DS_Store",
    ".todesktop/native/universal/**",
    "scripts/todesktop-before-build.cjs",
    "scripts/todesktop-after-pack.cjs",
    "todesktop.ts",
    "LICENSE"
  ],
  filesForDistribution: [
    "!.todesktop/**",
    "!native/**",
    "!scripts/**",
    "!resources/**",
    "!todesktop.ts"
  ],
  extraResources: [
    {
      from: "./resources/openhistory-icon.png"
    }
  ],
  mac: {
    category: "public.app-category.productivity"
  }
};

export default config;
