import { app } from "electron";
import { config as loadDotEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { InferenceProvider } from "@shared/inference";

export interface RuntimeConfig {
  dataDirectory: string;
  adoptExistingDataDirectory: boolean;
  inferenceApiKeys: Record<InferenceProvider, string | undefined>;
  inferenceModels: Record<InferenceProvider, string>;
  mcpPort: number;
}

function loadLocalEnvironment(): void {
  const candidates = [
    resolve(process.cwd(), ".env.local"),
    resolve(app.getAppPath(), ".env.local")
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotEnv({ path, override: false });
      return;
    }
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  loadLocalEnvironment();
  const customDataDirectory = process.env.OPENHISTORY_DATA_DIR?.trim()
    || process.env.COMPUTER_HISTORY_DATA_DIR?.trim();
  const legacyDataDirectory = resolve(
    app.getPath("appData"),
    "local-computer-history",
    "activity-data"
  );
  const defaultDataDirectory = existsSync(legacyDataDirectory)
    ? legacyDataDirectory
    : resolve(app.getPath("userData"), "activity-data");

  return {
    dataDirectory: customDataDirectory || defaultDataDirectory,
    adoptExistingDataDirectory: customDataDirectory
      ? process.env.OPENHISTORY_ADOPT_DATA_DIR?.trim() === "1"
      : true,
    inferenceApiKeys: {
      apple: undefined,
      openai: process.env.OPENAI_API_KEY?.trim() || undefined,
      anthropic: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
      kimi: process.env.MOONSHOT_API_KEY?.trim() || undefined
    },
    inferenceModels: {
      apple: "system-default",
      openai: process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna",
      anthropic: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
      kimi: process.env.MOONSHOT_MODEL?.trim() || "kimi-k3"
    },
    mcpPort: localPort(process.env.OPENHISTORY_MCP_PORT)
  };
}

function localPort(value: string | undefined): number {
  if (!value?.trim()) return 47_831;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_024 && parsed <= 65_535 ? parsed : 47_831;
}
