import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, relative, resolve } from "node:path";

const toolkitDirectory = resolve(requiredArgument(2, "Apple adapter toolkit directory"));
const pilotDirectory = resolve(process.argv[3] ?? "reports/private/apple-adapter-pilot");
const trainingDirectory = resolve(process.argv[4] ?? resolve(pilotDirectory, "training"));
const python = process.env.OPENHISTORY_ADAPTER_PYTHON?.trim() || "/opt/homebrew/bin/python3.11";
const epochs = positiveInteger(process.env.OPENHISTORY_ADAPTER_EPOCHS, 5);
const learningRate = process.env.OPENHISTORY_ADAPTER_LEARNING_RATE?.trim() || "1e-3";
const batchSize = positiveInteger(process.env.OPENHISTORY_ADAPTER_BATCH_SIZE, 4);
const trainPath = resolve(pilotDirectory, "train.jsonl");
const evalPath = resolve(pilotDirectory, "eval.jsonl");
const checkpointsDirectory = resolve(trainingDirectory, "checkpoints");
const exportsDirectory = resolve(trainingDirectory, "exports");
const environmentDirectory = resolve(trainingDirectory, "venv");
const environmentPython = resolve(environmentDirectory, "bin/python");
const requirementsPath = resolve(toolkitDirectory, "requirements.txt");

for (const [label, path] of [
  ["toolkit requirements", requirementsPath],
  ["training dataset", trainPath],
  ["evaluation dataset", evalPath]
] as const) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}
for (const directory of [trainingDirectory, checkpointsDirectory, exportsDirectory]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

const startedAt = new Date();
await run("create-environment", python, ["-m", "venv", environmentDirectory], process.cwd());
await run("install-requirements", environmentPython, ["-m", "pip", "install", "-r", requirementsPath], toolkitDirectory);
await run("train", environmentPython, [
  "-m", "examples.train_adapter",
  "--train-data", trainPath,
  "--eval-data", evalPath,
  "--epochs", String(epochs),
  "--learning-rate", learningRate,
  "--batch-size", String(batchSize),
  "--checkpoint-dir", checkpointsDirectory
], toolkitDirectory);

const checkpoint = finalCheckpoint(checkpointsDirectory);
await run("export", environmentPython, [
  "-m", "export.export_fmadapter",
  "--adapter-name", "openhistory_timeline_pilot",
  "--checkpoint", checkpoint,
  "--output-dir", exportsDirectory
], toolkitDirectory);
const adapter = exportedAdapter(exportsDirectory);
const completedAt = new Date();
const summary = {
  version: 1,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationSeconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1_000),
  toolkitDirectory: basename(toolkitDirectory),
  python,
  hyperparameters: { epochs, learningRate, batchSize },
  datasets: {
    train: { path: basename(trainPath), lines: lineCount(trainPath), sha256: sha256(trainPath) },
    eval: { path: basename(evalPath), lines: lineCount(evalPath), sha256: sha256(evalPath) }
  },
  checkpoint: { name: basename(checkpoint), bytes: statSync(checkpoint).size },
  adapter: { path: adapter, name: basename(adapter), bytes: artifactBytes(adapter), sha256: artifactSha256(adapter) },
  logs: ["create-environment.log", "install-requirements.log", "train.log", "export.log"]
};
const summaryPath = resolve(trainingDirectory, "training-summary.json");
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
chmodSync(summaryPath, 0o600);
process.stdout.write(`${adapter}\n${summaryPath}\n`);

async function run(label: string, command: string, args: string[], cwd: string): Promise<void> {
  const logPath = resolve(trainingDirectory, `${label}.log`);
  const log = createWriteStream(logPath, { flags: "w", mode: 0o600 });
  process.stderr.write(`${label}: ${command} ${args.map(shellDisplay).join(" ")}\n`);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      log.end();
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${label} failed with exit code ${code ?? "unknown"}. See ${logPath}`));
    });
  });
}

function finalCheckpoint(directory: string): string {
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith(".pt"))
    .map((name) => resolve(directory, name));
  const preferred = candidates.find((path) => /adapter-final\.pt$/i.test(path))
    ?? candidates.find((path) => /final\.pt$/i.test(path));
  if (preferred) return preferred;
  const newest = candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  if (!newest) throw new Error(`Training completed without a .pt checkpoint in ${directory}.`);
  return newest;
}

function exportedAdapter(directory: string): string {
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith(".fmadapter"))
    .map((name) => resolve(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!candidates[0]) throw new Error(`Export completed without a .fmadapter package in ${directory}.`);
  return candidates[0];
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function artifactBytes(path: string): number {
  return artifactFiles(path).reduce((total, file) => total + statSync(file).size, 0);
}

function artifactSha256(path: string): string {
  const hash = createHash("sha256");
  for (const file of artifactFiles(path)) {
    hash.update(relative(path, file) || basename(file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function artifactFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) return artifactFiles(child);
      if (entry.isFile()) return [child];
      throw new Error(`Unsupported artifact entry: ${child}`);
    });
}

function lineCount(path: string): number {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).length;
}

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index]?.trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${value} is not a positive integer.`);
  return parsed;
}

function shellDisplay(value: string): string {
  return /^[a-zA-Z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
