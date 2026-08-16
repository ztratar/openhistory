import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(process.argv[2]?.trim() || process.cwd());
const files = repositoryFiles(root);
const failures: string[] = [];
const forbiddenNames = new Set([".env.local", ".DS_Store"]);
const approvedReports = new Set([
  "reports/README.md",
  "reports/inference-hill-climb-summary.md"
]);
const approvedBinaryFiles = new Set([
  "design/open-history-logo-concepts/chrono-aperture.png",
  "design/open-history-logo-concepts/chrono-astrolabe.png",
  "design/open-history-logo-concepts/chrono-celestial-clock.png",
  "design/open-history-logo-concepts/chrono-lunar-cycle.png",
  "design/open-history-logo-concepts/chrono-sundial.png",
  "design/open-history-logo-concepts/history-portal.png",
  "design/open-history-logo-concepts/timeline-monogram.png",
  "resources/OpenHistory.icns",
  "resources/openhistory-icon.png",
  "website/public/og.png",
  "website/public/openhistory-hero.png",
  "website/public/openhistory-icon-32.png",
  "website/public/openhistory-icon.png",
  "website/public/openhistory-timeline.png"
]);
const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const binaryExtension = /\.(?:png|icns|jpe?g|gif|webp|woff2?|pdf|zip|mp4|mov)$/i;
const privateModelExtension = /\.(?:pt|pth)$/i;
const privateAdapterNames = new Set(["adapter_weights.bin", "draft_weights.bin"]);

for (const file of files) {
  const absolutePath = resolve(root, file);
  if (!existsSync(absolutePath)) continue;
  const segments = file.split("/");
  const name = segments.at(-1) ?? file;
  if (segments.some((segment) => /^adapter_training_toolkit/i.test(segment))) {
    failures.push(`${file}: Apple's separately licensed adapter toolkit must not be published`);
    continue;
  }
  if (segments.some((segment) => segment.endsWith(".fmadapter"))
    || privateModelExtension.test(name)
    || privateAdapterNames.has(name)
    || (segments.includes("training") && (segments.includes("venv") || name.endsWith(".log")))) {
    failures.push(`${file}: private adapter training artifact must not be tracked`);
    continue;
  }
  if (file.startsWith("reports/") && !approvedReports.has(file)) {
    failures.push(`${file}: detailed evaluation reports must remain private`);
    continue;
  }
  if (forbiddenNames.has(name)
    || (name.startsWith(".env.") && name !== ".env.example")
    || name === ".env"
    || name.endsWith(".jsonl")) {
    failures.push(`${file}: private/local artifact must not be tracked`);
    continue;
  }
  const stats = statSync(absolutePath);
  if (stats.size > 20 * 1024 * 1024) {
    failures.push(`${file}: file exceeds the 20 MiB public-repository limit`);
    continue;
  }
  if (binaryExtension.test(name) || stats.size > 2 * 1024 * 1024) {
    if (!approvedBinaryFiles.has(file)) failures.push(`${file}: binary or large file is not on the reviewed public-asset allowlist`);
    continue;
  }

  const content = readFileSync(absolutePath, "utf8");
  const syntheticFile = /(test|fixture)/i.test(file);
  if (content.includes(privateKeyMarker)) failures.push(`${file}: contains a private-key marker`);
  if (/\/Users\/(?!example(?:\/|$))[^/\s]+\//.test(content)) {
    failures.push(`${file}: contains a machine-specific macOS home path`);
  }
  content.split("\n").forEach((line, index) => {
    if (/sk-[A-Za-z0-9_-]{24,}/.test(line) && !syntheticFile && !/(test|synthetic|example|redacted)/i.test(line)) {
      failures.push(`${file}:${index + 1}: contains a credential-shaped value outside a synthetic test`);
    }
  });
  if (file.startsWith("reports/") && /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content)) {
    failures.push(`${file}: privacy-reviewed reports must not contain email addresses`);
  }
}

if (failures.length) {
  process.stderr.write(`Public repository check failed:\n${failures.map((value) => `- ${value}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Public repository check passed for ${files.length} files.\n`);

function repositoryFiles(directory: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).split("\0").filter(Boolean);
  } catch {
    return walk(directory);
  }
}

function walk(directory: string): string[] {
  const excludedDirectories = new Set([".git", "node_modules", "out", "dist", "release", ".swift-cache", ".build", ".swiftpm"]);
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(relative(directory, absolutePath));
    }
  };
  visit(directory);
  return files.sort();
}
