import type { TimelineApplication } from "@shared/contracts";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { installedApplicationPath } from "./installed-applications";

const execFileAsync = promisify(execFile);
const BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;
const SUPPORTED_ICON_EXTENSIONS = new Set([".icns", ".png"]);

async function findApplicationPath(application: TimelineApplication): Promise<string | undefined> {
  const name = application.name.trim();
  if (!name || name.length > 100 || /[/\\\0]/.test(name)) return undefined;

  const candidates = [
    join("/Applications", `${name}.app`),
    join("/System/Applications", `${name}.app`),
    join(homedir(), "Applications", `${name}.app`)
  ];
  const exactMatch = candidates.find(existsSync);
  if (exactMatch) return exactMatch;

  const bundleIdentifier = application.bundleIdentifier?.trim();
  if (!bundleIdentifier || !BUNDLE_IDENTIFIER_PATTERN.test(bundleIdentifier)) return undefined;
  const installedPath = installedApplicationPath(bundleIdentifier);
  if (installedPath) return installedPath;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/mdfind",
      [`kMDItemCFBundleIdentifier == '${bundleIdentifier}'`],
      { encoding: "utf8", timeout: 2_000, maxBuffer: 256 * 1_024 }
    );
    return stdout
      .split("\n")
      .map((path) => path.trim())
      .find((path) => path.endsWith(".app") && existsSync(path));
  } catch {
    return undefined;
  }
}

async function declaredIconName(applicationPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleIconFile", "raw", "-o", "-", join(applicationPath, "Contents", "Info.plist")],
      { encoding: "utf8", timeout: 2_000, maxBuffer: 16 * 1_024 }
    );
    const name = basename(stdout.trim());
    return name || undefined;
  } catch {
    return undefined;
  }
}

function existingIconPath(resourcesPath: string, iconName: string): string | undefined {
  const extension = extname(iconName).toLocaleLowerCase();
  const candidateNames = extension ? [iconName] : [`${iconName}.icns`, `${iconName}.png`, iconName];
  return candidateNames
    .filter((candidate) => SUPPORTED_ICON_EXTENSIONS.has(extname(candidate).toLocaleLowerCase()))
    .map((candidate) => join(resourcesPath, candidate))
    .find(existsSync);
}

async function findIconPath(applicationPath: string): Promise<string | undefined> {
  const resourcesPath = join(applicationPath, "Contents", "Resources");
  const declared = await declaredIconName(applicationPath);
  if (declared) {
    const declaredPath = existingIconPath(resourcesPath, declared);
    if (declaredPath) return declaredPath;
  }

  try {
    const iconFiles = readdirSync(resourcesPath).filter((entry) =>
      SUPPORTED_ICON_EXTENSIONS.has(extname(entry).toLocaleLowerCase())
    );
    const preferred = iconFiles.find((entry) => /^appicon\.icns$/i.test(entry))
      ?? iconFiles.find((entry) => /^icon\.icns$/i.test(entry))
      ?? iconFiles.find((entry) => extname(entry).toLocaleLowerCase() === ".icns")
      ?? iconFiles[0];
    return preferred ? join(resourcesPath, preferred) : undefined;
  } catch {
    return undefined;
  }
}

function iconDataUrl(path: string): string | undefined {
  try {
    const extension = extname(path).toLocaleLowerCase();
    if (extension !== ".png") return undefined;
    return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function convertIcon(iconPath: string, cacheDirectory: string): Promise<string | undefined> {
  if (extname(iconPath).toLocaleLowerCase() === ".png") return iconDataUrl(iconPath);

  try {
    mkdirSync(cacheDirectory, { recursive: true });
    const modifiedAt = statSync(iconPath).mtimeMs;
    const key = createHash("sha256").update(`${iconPath}:${modifiedAt}:64:v1`).digest("hex");
    const outputPath = join(cacheDirectory, `${key}.png`);
    if (!existsSync(outputPath)) {
      await execFileAsync(
        "/usr/bin/sips",
        ["-s", "format", "png", "-Z", "64", iconPath, "--out", outputPath],
        { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1_024 }
      );
    }
    return iconDataUrl(outputPath);
  } catch {
    return undefined;
  }
}

export async function loadApplicationIcon(
  application: TimelineApplication,
  cacheDirectory: string
): Promise<string | undefined> {
  const applicationPath = await findApplicationPath(application);
  if (!applicationPath) return undefined;
  const iconPath = await findIconPath(applicationPath);
  if (!iconPath) return undefined;
  return convertIcon(iconPath, cacheDirectory);
}
