import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const requestedTarget = process.argv[2]?.trim();
if (!requestedTarget) throw new Error("Usage: npm run export:public-snapshot -- /absolute/empty/target");
const target = resolve(requestedTarget);
const targetRelativeToRoot = relative(root, target);
if (target === root || (!targetRelativeToRoot.startsWith("..") && !isAbsolute(targetRelativeToRoot))) {
  throw new Error("The export target must be outside the working repository");
}
if (existsSync(target) && readdirSync(target).length > 0) throw new Error("The export target must not exist or must be empty");
const dirty = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: root,
  encoding: "utf8"
}).trim();
if (dirty) {
  throw new Error("Refusing to export from a dirty repository. Commit or remove every tracked and untracked change first.");
}

mkdirSync(target, { recursive: true, mode: 0o700 });
const temporaryDirectory = mkdtempSync(join(tmpdir(), "openhistory-public-export-"));
const archivePath = join(temporaryDirectory, "openhistory.tar");
try {
  execFileSync("git", ["archive", "--format=tar", `--output=${archivePath}`, "HEAD"], { cwd: root });
  execFileSync("tar", ["-xf", archivePath, "-C", target]);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
const exportedFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
  cwd: root,
  encoding: "utf8"
}).split("\n").filter(Boolean).length;
process.stdout.write(`Exported ${exportedFiles} committed files from HEAD to ${target} without Git history.\n`);
