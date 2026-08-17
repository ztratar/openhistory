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
  "native"
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

  for (const name of ["openhistory-native.node", "libOpenHistoryCollector.dylib", "foundation-model-worker"]) {
    const executable = resolve(destination, name);
    if (!existsSync(executable)) throw new Error(`afterPack did not embed ${name}`);
  }
  process.stdout.write("ToDesktop afterPack integration passed with an isolated synthetic app bundle.\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
