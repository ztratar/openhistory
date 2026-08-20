import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { ensurePrivateDirectory } from "./private-storage";

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@openai/codex-darwin-arm64",
  "darwin-x64": "@openai/codex-darwin-x64",
  "linux-arm64": "@openai/codex-linux-arm64",
  "linux-x64": "@openai/codex-linux-x64",
  "win32-arm64": "@openai/codex-win32-arm64",
  "win32-x64": "@openai/codex-win32-x64"
};

const TARGET_TRIPLES: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc"
};

const PASSTHROUGH_ENVIRONMENT = [
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TMP",
  "TMPDIR",
  "TEMP",
  "USER",
  "WINDIR",
  "https_proxy",
  "http_proxy",
  "no_proxy"
] as const;

export interface CodexRuntime {
  codexHome: string;
  executablePath: string;
  workingDirectory: string;
}

export function createCodexRuntime(dataDirectory: string): CodexRuntime {
  const codexHome = resolve(dataDirectory, "codex");
  const workingDirectory = resolve(codexHome, "workspace");
  ensurePrivateDirectory(codexHome);
  ensurePrivateDirectory(workingDirectory);
  return {
    codexHome,
    executablePath: findCodexExecutable(),
    workingDirectory
  };
}

export function codexEnvironment(
  codexHome: string,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const environment: Record<string, string> = { CODEX_HOME: codexHome, NO_COLOR: "1" };
  for (const name of PASSTHROUGH_ENVIRONMENT) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

export function findCodexExecutable(
  platform = process.platform,
  architecture = process.arch
): string {
  const platformKey = `${platform}-${architecture}`;
  const platformPackage = PLATFORM_PACKAGES[platformKey];
  const targetTriple = TARGET_TRIPLES[platformKey];
  if (!platformPackage || !targetTriple) {
    throw new Error(`Codex does not support ${platform} (${architecture})`);
  }

  const require = createRequire(import.meta.url);
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(`${platformPackage}/package.json`);
  } catch {
    throw new Error(`The bundled Codex runtime for ${platform} (${architecture}) is missing`);
  }
  const executableName = platform === "win32" ? "codex.exe" : "codex";
  const archivedPath = resolve(dirname(packageJsonPath), "vendor", targetTriple, "bin", executableName);
  const unpackedPath = archivedPath.replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`
  );
  const executablePath = existsSync(unpackedPath) ? unpackedPath : archivedPath;
  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
    throw new Error(`The bundled Codex executable for ${platform} (${architecture}) is missing`);
  }
  return executablePath;
}
