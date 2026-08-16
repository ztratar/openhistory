import type { ActivityEvent, CollectionSettings, CollectorState } from "@shared/contracts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadActivityEvents, parseRawActivityEvent } from "./activity-event-file";
import { ActivityPrivacyFilter } from "./privacy-policy";

const MAX_RECENT_EVENTS = 250;
const HEARTBEAT_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEARTBEAT_LINE = "__OPENHISTORY_HEARTBEAT__";

export class CollectorProcess extends EventEmitter {
  state: CollectorState = "stopped";
  enabled = true;
  readonly recentEvents: ActivityEvent[] = [];
  private child?: ChildProcessWithoutNullStreams;
  private restartAfterExit = false;
  private promptForAccessibilityOnNextStart = false;
  private healthTimer?: ReturnType<typeof setInterval>;
  private lastNativeSignalAt = 0;
  private privacyFilter = new ActivityPrivacyFilter();
  accessibilityTrusted = false;

  constructor(readonly dataDirectory: string, private settings: CollectionSettings) {
    super();
    mkdirSync(dataDirectory, { recursive: true });
    this.recentEvents.push(...loadActivityEvents(dataDirectory, MAX_RECENT_EVENTS, {
      captureEmailActivity: settings.captureEmailActivity
    }));
    this.accessibilityTrusted = [...this.recentEvents]
      .reverse()
      .find((event) => event.kind === "collector_started")
      ?.accessibilityTrusted ?? false;
  }

  start(): void {
    if (this.child || !this.enabled) return;

    const executable = findCollectorExecutable();
    if (!executable) {
      this.state = "failed";
      this.emit("state", this.state);
      console.error("Native collector not found. Run npm run build:native.");
      return;
    }

    this.state = "starting";
    this.emit("state", this.state);
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        OPENHISTORY_DATA_DIR: this.dataDirectory,
        OPENHISTORY_CAPTURE_WINDOW_TITLES: String(this.settings.captureWindowTitles),
        OPENHISTORY_CAPTURE_FOCUSED_ELEMENTS: String(this.settings.captureFocusedElements),
        OPENHISTORY_CAPTURE_TEXT_INPUT: String(this.settings.captureTextInput),
        OPENHISTORY_CAPTURE_POINTER_CLICKS: String(this.settings.capturePointerClicks),
        OPENHISTORY_CAPTURE_BROWSER_URLS: String(this.settings.captureBrowserURLs),
        OPENHISTORY_CAPTURE_DOCUMENT_CONTEXT: String(this.settings.captureDocumentContext),
        OPENHISTORY_CAPTURE_UI_SNAPSHOTS: String(this.settings.captureUISnapshots),
        OPENHISTORY_CAPTURE_EMAIL_ACTIVITY: String(this.settings.captureEmailActivity),
        OPENHISTORY_PROMPT_ACCESSIBILITY: String(this.promptForAccessibilityOnNextStart),
        OPENHISTORY_EXCLUDED_BUNDLE_IDENTIFIERS: this.settings.excludedBundleIdentifiers.join(","),
        OPENHISTORY_EXCLUDED_PROCESS_IDENTIFIERS: String(process.pid)
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.promptForAccessibilityOnNextStart = false;
    this.child = child;
    this.lastNativeSignalAt = Date.now();
    this.startHealthMonitor();
    this.privacyFilter = new ActivityPrivacyFilter({
      captureEmailActivity: this.settings.captureEmailActivity
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (this.child !== child) return;
      this.lastNativeSignalAt = Date.now();
      if (line === HEARTBEAT_LINE) return;
      const rawEvent = parseRawActivityEvent(line);
      if (!rawEvent) return;
      for (const event of this.privacyFilter.filter([rawEvent])) {
        if (event.kind === "collector_started") {
          this.accessibilityTrusted = event.accessibilityTrusted ?? false;
        }
        this.recentEvents.push(event);
        if (this.recentEvents.length > MAX_RECENT_EVENTS) this.recentEvents.shift();
        this.state = "running";
        this.emit("state", this.state);
        this.emit("event", event);
      }
    });

    child.stderr.on("data", (chunk) => {
      console.error(`[collector] ${chunk.toString().trimEnd()}`);
    });

    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.restartAfterExit && this.enabled) {
        this.restartAfterExit = false;
        this.start();
        return;
      }
      if (!this.enabled) {
        this.state = "paused";
      } else if (code === 0 || signal === "SIGTERM") {
        this.state = "stopped";
      } else {
        this.state = "failed";
      }
      this.stopHealthMonitor();
      this.emit("state", this.state);
    });
  }

  setSettings(settings: CollectionSettings): void {
    this.settings = settings;
    if (!this.enabled) return;
    if (this.child) {
      this.restartAfterExit = true;
      this.state = "starting";
      this.emit("state", this.state);
      this.child.kill("SIGTERM");
    } else {
      this.start();
    }
  }

  requestAccessibilityPermission(): void {
    this.promptForAccessibilityOnNextStart = true;
    this.setSettings(this.settings);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (this.child) {
        this.restartAfterExit = true;
        this.state = "starting";
        this.emit("state", this.state);
      } else {
        this.start();
      }
    } else {
      this.stop("paused");
    }
  }

  stop(nextState: CollectorState = "stopped"): void {
    this.restartAfterExit = false;
    this.enabled = nextState !== "paused" ? this.enabled : false;
    this.state = nextState;
    this.emit("state", this.state);
    this.stopHealthMonitor();
    this.child?.kill("SIGTERM");
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      if (!this.child || Date.now() - this.lastNativeSignalAt <= HEARTBEAT_TIMEOUT_MS) return;
      this.restartAfterExit = true;
      this.state = "starting";
      this.emit("state", this.state);
      this.child.kill("SIGTERM");
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthMonitor(): void {
    if (!this.healthTimer) return;
    clearInterval(this.healthTimer);
    this.healthTimer = undefined;
  }
}

function findCollectorExecutable(): string | undefined {
  const executableName = "activity-collector";
  const candidates = [
    resolve(
      process.cwd(),
      "native/collector/.build/debug/OpenHistory Collector.app/Contents/MacOS",
      executableName
    ),
    resolve(
      process.cwd(),
      "native/collector/.build/debug/Computer History Collector.app/Contents/MacOS",
      executableName
    ),
    resolve(process.cwd(), "native/collector/.build/debug", executableName),
    resolve(process.cwd(), "native/collector/.build/arm64-apple-macosx/debug", executableName),
    resolve(
      process.resourcesPath,
      "native/OpenHistory Collector.app/Contents/MacOS",
      executableName
    ),
    resolve(process.resourcesPath, "native", executableName)
  ];
  return candidates.find(existsSync);
}
