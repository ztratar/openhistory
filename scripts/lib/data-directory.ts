import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function defaultOpenHistoryDataDirectory(): string {
  const configured = process.env.OPENHISTORY_DATA_DIR?.trim()
    || process.env.COMPUTER_HISTORY_DATA_DIR?.trim();
  if (configured) return configured;

  const applicationSupport = resolve(homedir(), "Library", "Application Support");
  const legacy = resolve(applicationSupport, "local-computer-history", "activity-data");
  return existsSync(legacy)
    ? legacy
    : resolve(applicationSupport, "OpenHistory", "activity-data");
}
