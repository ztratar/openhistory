import type { CodexAccountState } from "@shared/inference";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { codexEnvironment, type CodexRuntime } from "./codex-runtime";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESTART_DELAY_MS = 30_000;

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AccountReadResult {
  account: null | {
    type: string;
    email?: string | null;
    planType?: string;
  };
}

interface LoginStartResult {
  type: string;
  loginId?: string;
  authUrl?: string;
}

export class CodexAuthService extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private initialized = false;
  private loginId?: string;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private reader?: ReadlineInterface;
  private restartAttempts = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private startPromise?: Promise<void>;
  private stopping = false;
  private state: CodexAccountState = { status: "starting" };

  constructor(readonly runtime: CodexRuntime, private readonly clientVersion = "unknown") {
    super();
  }

  getState(): CodexAccountState {
    return structuredClone(this.state);
  }

  async start(): Promise<void> {
    this.stopping = false;
    try {
      await this.ensureProcess();
    } catch {
      this.setState({
        status: "unavailable",
        lastError: "ChatGPT sign-in is unavailable because the bundled Codex service could not start."
      });
      this.scheduleRestart();
    }
  }

  async signIn(): Promise<string> {
    await this.ensureProcess();
    if (this.loginId) await this.cancelSignIn();
    this.setState({ status: "signingIn" });
    try {
      const result = await this.request<LoginStartResult>("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt"
      });
      if (result.type !== "chatgpt" || !result.loginId || !result.authUrl) {
        throw new Error("Codex returned an unsupported login response");
      }
      this.loginId = result.loginId;
      return result.authUrl;
    } catch (error) {
      if (this.state.status !== "unavailable") {
        this.setState({ status: "signedOut", lastError: "ChatGPT sign-in could not start." });
      }
      throw error;
    }
  }

  async cancelSignIn(): Promise<void> {
    const loginId = this.loginId;
    this.loginId = undefined;
    if (loginId && this.child && this.initialized) {
      await this.request("account/login/cancel", { loginId }).catch(() => undefined);
    }
    this.setState({ status: "signedOut" });
  }

  async logout(): Promise<void> {
    await this.ensureProcess();
    if (this.loginId) await this.cancelSignIn();
    await this.request("account/logout");
    this.setState({ status: "signedOut" });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    this.child = undefined;
    this.initialized = false;
    this.reader?.close();
    this.reader = undefined;
    this.rejectPending(new Error("Codex app-server stopped"));
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const forceTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 1_500);
      child.once("exit", () => {
        clearTimeout(forceTimer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private ensureProcess(): Promise<void> {
    if (this.child && this.initialized) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.launch().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  private async launch(): Promise<void> {
    if (this.stopping) throw new Error("Codex app-server is stopping");
    const child = spawn(this.runtime.executablePath, [
      "app-server",
      "--stdio",
      "--config",
      'forced_login_method="chatgpt"',
      "--config",
      'cli_auth_credentials_store="file"',
      "--config",
      "check_for_update_on_startup=false"
    ], {
      env: codexEnvironment(this.runtime.codexHome),
      stdio: "pipe"
    });
    this.child = child;
    this.initialized = false;
    this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.reader.on("line", (line) => this.handleLine(line));
    child.stderr.resume();
    child.once("error", () => this.handleProcessExit(child));
    child.once("exit", () => this.handleProcessExit(child));

    try {
      await this.request("initialize", {
        clientInfo: { name: "openhistory", title: "OpenHistory", version: this.clientVersion },
        capabilities: null
      });
      this.notify("initialized");
      this.initialized = true;
      this.restartAttempts = 0;
      await this.refreshAccount(false);
    } catch (error) {
      if (this.child === child) child.kill("SIGTERM");
      throw error;
    }
  }

  private request<Result = unknown>(method: string, params?: unknown): Promise<Result> {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextRequestId++;
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout
      });
      child.stdin.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`);
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      console.warn("Codex app-server emitted an invalid protocol message");
      return;
    }

    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error && typeof message.error === "object") {
        pending.reject(new Error("Codex app-server rejected a request"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ((typeof message.id === "number" || typeof message.id === "string")
      && typeof message.method === "string") {
      this.child?.stdin.write(`${JSON.stringify({
        id: message.id,
        error: { code: -32601, message: "OpenHistory does not support server-initiated requests" }
      })}\n`);
      return;
    }
    if (message.method === "account/login/completed") {
      void this.handleLoginCompleted(message.params);
    } else if (message.method === "account/updated" && !this.loginId) {
      void this.refreshAccount(false);
    }
  }

  private async handleLoginCompleted(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const notification = value as { loginId?: unknown; success?: unknown };
    if (this.loginId && notification.loginId !== this.loginId) return;
    this.loginId = undefined;
    if (notification.success !== true) {
      this.setState({ status: "signedOut", lastError: "ChatGPT sign-in did not complete." });
      return;
    }
    await this.refreshAccount(true);
  }

  private async refreshAccount(refreshToken: boolean): Promise<void> {
    try {
      const result = await this.request<AccountReadResult>("account/read", { refreshToken });
      if (result.account?.type === "chatgpt") {
        this.setState({
          status: "signedIn",
          ...(result.account.email ? { email: result.account.email } : {}),
          ...(result.account.planType ? { planType: result.account.planType } : {})
        });
      } else {
        this.setState({ status: "signedOut" });
      }
    } catch {
      this.setState({
        status: "unavailable",
        lastError: "OpenHistory could not read the isolated Codex account."
      });
    }
  }

  private handleProcessExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.initialized = false;
    this.reader?.close();
    this.reader = undefined;
    this.rejectPending(new Error("Codex app-server exited"));
    if (this.stopping) return;
    this.setState({
      status: "unavailable",
      lastError: "The isolated Codex service stopped unexpectedly. OpenHistory will retry."
    });
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    const delay = Math.min(1_000 * (2 ** this.restartAttempts), MAX_RESTART_DELAY_MS);
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.start();
    }, delay);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private setState(state: CodexAccountState): void {
    this.state = structuredClone(state);
    this.emit("state", this.getState());
  }
}

export function safeOpenAIAuthUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === "openai.com" || url.hostname.endsWith(".openai.com") ||
      url.hostname === "chatgpt.com" || url.hostname.endsWith(".chatgpt.com");
    if (url.protocol !== "https:" || url.username || url.password || !allowedHost) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
