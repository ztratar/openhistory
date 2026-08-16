import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const temporaryRoot = await mkdtemp(resolve(tmpdir(), "openhistory-todesktop-before-build-"));
const outputs = [
  "out/main/index.js",
  "out/preload/index.cjs",
  "out/renderer/index.html"
];

try {
  for (const relativePath of outputs) {
    const output = resolve(temporaryRoot, relativePath);
    mkdirSync(resolve(output, ".."), { recursive: true });
    writeFileSync(output, "verified build output\n");
  }

  const require = createRequire(import.meta.url);
  const beforeBuild = require("./todesktop-before-build.cjs") as (context: object) => Promise<void>;
  await beforeBuild({ appDir: temporaryRoot, arch: "arm64" });
  await beforeBuild({ appDir: temporaryRoot, arch: "x64" });
  await assert.rejects(beforeBuild({ appDir: temporaryRoot, arch: "ia32" }), /Unsupported ToDesktop build architecture/);

  unlinkSync(resolve(temporaryRoot, outputs[0]));
  await assert.rejects(beforeBuild({ appDir: temporaryRoot, arch: "arm64" }), /Prebuilt Electron output is missing or empty/);
  process.stdout.write("ToDesktop beforeBuild prebuilt-output verification passed.\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
