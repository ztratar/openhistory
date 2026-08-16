import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync
} from "node:fs";
import { basename, parse, relative, resolve, sep } from "node:path";
import { ensurePrivateDirectory, writePrivateFile } from "./private-storage";

export const DATA_ROOT_MARKER = ".openhistory-data-root";
const DATA_ROOT_MARKER_CONTENT = "OpenHistory activity data v1\n";

export interface DataDirectoryOwnershipOptions {
  adoptExistingUnmarked?: boolean;
}

export function ensureOwnedDataDirectory(
  candidate: string,
  options: DataDirectoryOwnershipOptions = {}
): string {
  const directory = safeDataDirectory(candidate);
  const existed = existsSync(directory);
  if (existed && lstatSync(directory).isSymbolicLink()) {
    throw new Error("OpenHistory data directory cannot be a symbolic link");
  }
  const marker = resolve(directory, DATA_ROOT_MARKER);
  const marked = existsSync(marker);
  if (marked) {
    assertOwnedMarker(marker);
  } else if (existed && readdirSync(directory).length > 0 && !options.adoptExistingUnmarked) {
    throw new Error(
      "Refusing to adopt a nonempty custom activity-data directory without explicit approval"
    );
  }
  ensurePrivateDirectory(directory);
  if (!marked) {
    writePrivateFile(marker, DATA_ROOT_MARKER_CONTENT);
  }
  return directory;
}

export function deleteOwnedDataDirectory(candidate: string): void {
  const directory = safeDataDirectory(candidate);
  if (!existsSync(directory) || lstatSync(directory).isSymbolicLink()) {
    throw new Error("OpenHistory data directory is missing or unsafe");
  }
  assertOwnedMarker(resolve(directory, DATA_ROOT_MARKER));

  const quarantine = `${directory}.deleting-${process.pid}-${Date.now()}`;
  renameSync(directory, quarantine);
  try {
    ensurePrivateDirectory(directory);
    writePrivateFile(resolve(directory, DATA_ROOT_MARKER), DATA_ROOT_MARKER_CONTENT);
  } catch (error) {
    renameSync(quarantine, directory);
    throw error;
  }
  try {
    rmSync(quarantine, { recursive: true, force: false });
  } catch (error) {
    rmSync(directory, { recursive: true, force: false });
    renameSync(quarantine, directory);
    throw error;
  }
}

function safeDataDirectory(candidate: string): string {
  const directory = resolve(candidate);
  const root = parse(directory).root;
  const segments = relative(root, directory).split(sep).filter(Boolean);
  if (basename(directory) !== "activity-data" || segments.length < 3) {
    throw new Error("Refusing to operate outside a dedicated activity-data directory");
  }
  return directory;
}

function assertOwnedMarker(marker: string): void {
  if (!existsSync(marker) || lstatSync(marker).isSymbolicLink()) {
    throw new Error("OpenHistory ownership marker is missing or unsafe");
  }
  if (readFileSync(marker, "utf8") !== DATA_ROOT_MARKER_CONTENT) {
    throw new Error("OpenHistory ownership marker is invalid");
  }
}
