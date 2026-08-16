import type { TimelineApplication } from "@shared/contracts";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

interface ApplicationPlist {
  CFBundleDisplayName?: unknown;
  CFBundleIdentifier?: unknown;
  CFBundleName?: unknown;
}

const knownApplicationPaths = new Map<string, string>();
let cachedApplications: TimelineApplication[] | undefined;

export function listInstalledApplications(
  directories?: string[]
): TimelineApplication[] {
  if (!directories && cachedApplications) return cachedApplications;
  const applications = new Map<string, TimelineApplication>();

  for (const directory of directories ?? applicationDirectories()) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
      const applicationPath = join(directory, entry.name);
      const application = applicationFromBundle(applicationPath);
      if (application && !applications.has(application.bundleIdentifier!)) {
        applications.set(application.bundleIdentifier!, application);
        knownApplicationPaths.set(application.bundleIdentifier!, applicationPath);
      }
    }
  }

  const result = [...applications.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
  if (!directories) cachedApplications = result;
  return result;
}

export function installedApplicationPath(bundleIdentifier: string): string | undefined {
  return knownApplicationPaths.get(bundleIdentifier);
}

function applicationDirectories(): string[] {
  return [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    join(homedir(), "Applications")
  ];
}

function applicationFromBundle(applicationPath: string): TimelineApplication | undefined {
  try {
    const raw = execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", join(applicationPath, "Contents", "Info.plist")],
      {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 2 * 1_024 * 1_024,
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    const plist = JSON.parse(raw) as ApplicationPlist;
    const bundleIdentifier = stringValue(plist.CFBundleIdentifier);
    if (!bundleIdentifier || !BUNDLE_IDENTIFIER_PATTERN.test(bundleIdentifier)) return undefined;
    const name = stringValue(plist.CFBundleDisplayName)
      ?? stringValue(plist.CFBundleName)
      ?? basename(applicationPath, ".app");
    if (!name || name.length > 100 || /[/\\\0]/.test(name)) return undefined;
    return { bundleIdentifier, name };
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}
