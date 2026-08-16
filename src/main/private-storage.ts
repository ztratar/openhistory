import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";

export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function writePrivateFile(path: string, contents: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}
