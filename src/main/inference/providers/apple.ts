import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { InferenceProviderAdapter, StructuredGenerationRequest } from "../contracts";

export interface AppleWorkerResponse {
  ok: boolean;
  available?: boolean;
  reason?: string;
  output?: string;
  durationMilliseconds?: number;
}

export interface AppleModelAvailability {
  available: boolean;
  reason?: string;
  executable?: string;
}

export type AppleWorkerRunner = (executable: string, request: object) => Promise<AppleWorkerResponse>;

export function probeAppleFoundationModel(
  executable = findFoundationModelExecutable()
): AppleModelAvailability {
  if (process.platform !== "darwin") {
    return { available: false, reason: "Apple's on-device model is available only on macOS." };
  }
  if (!executable) {
    return {
      available: false,
      reason: "The on-device model helper is missing. Rebuild OpenHistory with Xcode 26 or later."
    };
  }
  const result = spawnSync(executable, [], {
    input: JSON.stringify({ operation: "availability" }),
    encoding: "utf8",
    timeout: 5_000
  });
  if (result.error) return { available: false, reason: result.error.message, executable };
  try {
    const response = JSON.parse(result.stdout.trim()) as AppleWorkerResponse;
    return {
      available: response.ok && response.available === true,
      ...(response.reason ? { reason: response.reason } : {}),
      executable
    };
  } catch {
    return { available: false, reason: "The on-device model helper returned an invalid status.", executable };
  }
}

export function findFoundationModelExecutable(): string | undefined {
  const name = "foundation-model-worker";
  const candidates = [
    process.env.OPENHISTORY_FOUNDATION_MODEL_WORKER?.trim(),
    resolve(process.cwd(), "native/collector/.build/debug/OpenHistory Collector.app/Contents/MacOS", name),
    resolve(process.cwd(), "native/collector/.build/debug", name),
    resolve(process.cwd(), "native/collector/.build/arm64-apple-macosx/debug", name),
    typeof process.resourcesPath === "string"
      ? resolve(process.resourcesPath, "native/OpenHistory Collector.app/Contents/MacOS", name)
      : undefined,
    typeof process.resourcesPath === "string" ? resolve(process.resourcesPath, "native", name) : undefined
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

export class AppleFoundationModelProvider implements InferenceProviderAdapter {
  readonly provider = "apple" as const;

  constructor(
    readonly model: string,
    private readonly executable = findFoundationModelExecutable(),
    private readonly runner: AppleWorkerRunner = runAppleWorker,
    private readonly adapterPath = process.env.OPENHISTORY_FOUNDATION_MODEL_ADAPTER?.trim() || undefined
  ) {}

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    if (!this.executable) throw new Error(probeAppleFoundationModel().reason);
    let response = await this.runner(this.executable, workerRequest(request, request.input, this.adapterPath));
    if (!response.ok && /refusal|sensitive|unsupportedLanguageOrLocale|unsupported language/i.test(response.reason ?? "")) {
      response = await this.runner(
        this.executable,
        workerRequest(request, reducedAppleInput(request.input), this.adapterPath)
      );
    }
    if (!response.ok && /refusal|sensitive|guardrailViolation/i.test(response.reason ?? "")) {
      response = await this.runner(
        this.executable,
        workerRequest(request, minimalAppleInput(request.input), this.adapterPath)
      );
    }
    if (!response.ok || !response.output) {
      throw new Error(response.reason ?? "Apple's on-device model did not return output.");
    }
    return request.schema.parse(normalizeAppleOutput(request.schemaName, JSON.parse(response.output)));
  }
}

function workerRequest<T>(
  request: StructuredGenerationRequest<T>,
  input: string,
  adapterPath?: string
): object {
  return {
    operation: request.schemaName,
    instructions: request.instructions,
    input,
    maximumResponseTokens: request.maxOutputTokens,
    ...(adapterPath ? { adapterPath } : {})
  };
}

export function minimalAppleInput(input: string): string {
  const lines = input.split("\n")
    .filter((line) => !/entered|inserted|replaced|deleted|content changes|value “|private|password|token/i.test(line))
    .slice(0, 28)
    .map((line) => line
      .replace(/“[^”]{12,}”/g, "[redacted surface]")
      .slice(0, 180));
  return `Metadata-only evidence follows because detailed evidence was unavailable. Respond conservatively in English. Leave unsupported fields empty.\n${lines.join("\n")}`;
}

export function reducedAppleInput(input: string): string {
  const jsonStart = input.indexOf("{");
  try {
    const value = JSON.parse(jsonStart >= 0 ? input.slice(jsonStart) : input) as unknown;
    return `Reduced evidence JSON follows. Respond in English.\n${JSON.stringify(reduce(value))}`;
  } catch {
    const safeLines = input.split("\n")
      .filter((line) => !/entered|value “|private|password|token/i.test(line))
      .slice(0, 24)
      .map((line) => line.slice(0, 180));
    return `Reduced evidence follows. Respond conservatively in English.\n${safeLines.join("\n")}`;
  }
}

function reduce(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 120);
  if (Array.isArray(value)) return value.slice(0, 4).map(reduce);
  if (!value || typeof value !== "object") return value;
  const omitted = new Set(["insertedText", "resultingValue", "visibleText", "selectedElements"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !omitted.has(key))
    .map(([key, entry]) => [key, reduce(entry)]));
}

export function normalizeAppleOutput(schemaName: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const maxLengths: Record<string, number> = schemaName.startsWith("daily_rollup")
    ? { title: 120, summary: 1_200, themes: 120, accomplishments: 240, decisions: 240, unfinishedWork: 240, recurringPatterns: 240 }
    : schemaName.startsWith("hour_rollup")
      ? { title: 120, summary: 1_000, workThreads: 240, decisions: 240, outcomes: 240, blockers: 240, surfaces: 240 }
      : { title: 120, description: 800, workThreads: 240, decisions: 240, outcomes: 240, blockers: 240, surfaces: 240 };
  const normalized = Object.fromEntries(Object.entries(record).map(([key, entry]) => {
    const maximum = maxLengths[key];
    if (!maximum) return [key, entry];
    if (typeof entry === "string") return [key, truncate(entry, maximum)];
    if (Array.isArray(entry)) return [key, entry.map((item) => typeof item === "string" ? truncate(item, maximum) : item)];
    return [key, entry];
  }));
  if (["hour_rollup", "hour_rollup_compact", "daily_rollup", "daily_rollup_compact"].includes(schemaName)
    && typeof normalized.summary === "string") {
    normalized.summary = truncate(normalized.summary.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.startsWith("- ") ? line : `- ${line.replace(/^[-•]\s*/, "")}`)
      .join("\n"), maxLengths.summary ?? 1_200);
  }
  if (["timeline_entry", "timeline_entry_compact", "timeline_entry_compact_parts"].includes(schemaName)) {
    normalized.suggestion = null;
  }
  return normalized;
}

function truncate(value: string, maximum: number): string {
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

export function runAppleWorker(executable: string, request: object): Promise<AppleWorkerResponse> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Apple's on-device model timed out after 90 seconds."));
    }, 90_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8").trim();
      try {
        resolvePromise(JSON.parse(text) as AppleWorkerResponse);
      } catch {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || "The on-device model helper returned invalid output."));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
