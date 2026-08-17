import type { ActivityEvent, CollectionSettings, CollectorState } from "@shared/contracts";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadActivityEvents, parseRawActivityEvent } from "./activity-event-file";
import { ActivityPrivacyFilter } from "./privacy-policy";

const MAX_RECENT_EVENTS = 250;
const ACCESSIBILITY_CHECK_INTERVAL_MS = 1_000;

interface NativeCollectorConfiguration {
  captureWindowTitles: boolean;
  captureFocusedElements: boolean;
  captureTextInput: boolean;
  capturePointerClicks: boolean;
  captureBrowserURLs: boolean;
  captureDocumentContext: boolean;
  captureUISnapshots: boolean;
  captureEmailActivity: boolean;
  captureMessagingActivity: boolean;
  excludedBundleIdentifiers: string[];
  excludedProcessIdentifiers: number[];
}

export interface NativeCollectorBinding {
  startCollector(
    dataDirectory: string,
    configurationJSON: string,
    onEvent: (line: string) => void
  ): boolean;
  stopCollector(): void;
  isTrusted(): boolean;
  requestTrust(): boolean;
}

export class CollectorService extends EventEmitter {
  state: CollectorState = "stopped";
  enabled = true;
  readonly recentEvents: ActivityEvent[] = [];
  accessibilityTrusted = false;
  private active = false;
  private generation = 0;
  private accessibilityTimer?: ReturnType<typeof setInterval>;
  private privacyFilter = new ActivityPrivacyFilter();
  private nativeBinding?: NativeCollectorBinding;

  constructor(
    readonly dataDirectory: string,
    private settings: CollectionSettings,
    nativeBinding?: NativeCollectorBinding
  ) {
    super();
    this.nativeBinding = nativeBinding;
    mkdirSync(dataDirectory, { recursive: true });
    this.recentEvents.push(...loadActivityEvents(dataDirectory, MAX_RECENT_EVENTS, {
      captureEmailActivity: settings.captureEmailActivity,
      captureMessagingActivity: settings.captureMessagingActivity
    }));
    this.accessibilityTrusted = [...this.recentEvents]
      .reverse()
      .find((event) => event.kind === "collector_started")
      ?.accessibilityTrusted ?? false;
  }

  start(): void {
    if (this.active || !this.enabled) return;
    this.state = "starting";
    this.emit("state", this.state);
    const generation = ++this.generation;
    this.privacyFilter = new ActivityPrivacyFilter({
      captureEmailActivity: this.settings.captureEmailActivity,
      captureMessagingActivity: this.settings.captureMessagingActivity
    });

    try {
      const native = this.native();
      this.accessibilityTrusted = native.isTrusted();
      native.startCollector(
        this.dataDirectory,
        JSON.stringify(this.nativeConfiguration()),
        (line) => this.handleNativeEvent(line, generation)
      );
      this.active = true;
      this.startAccessibilityMonitor();
    } catch (error) {
      this.active = false;
      this.state = "failed";
      this.emit("state", this.state);
      console.error("Native collector failed to start", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
    }
  }

  setSettings(settings: CollectionSettings): void {
    this.settings = settings;
    if (this.enabled) this.restart();
  }

  requestAccessibilityPermission(): void {
    try {
      this.native().requestTrust();
      this.startAccessibilityMonitor();
    } catch (error) {
      console.error("Unable to request Accessibility permission", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.start();
    } else {
      this.stop("paused");
    }
  }

  stop(nextState: CollectorState = "stopped"): void {
    ++this.generation;
    this.stopAccessibilityMonitor();
    if (this.active) {
      try {
        this.native().stopCollector();
      } catch (error) {
        console.error("Native collector failed to stop", {
          name: error instanceof Error ? error.name : "UnknownError"
        });
      }
    }
    this.active = false;
    if (nextState === "paused") this.enabled = false;
    this.state = nextState;
    this.emit("state", this.state);
  }

  private restart(): void {
    if (!this.enabled) return;
    ++this.generation;
    if (this.active) {
      try {
        this.native().stopCollector();
      } catch (error) {
        console.error("Native collector restart failed", {
          name: error instanceof Error ? error.name : "UnknownError"
        });
      }
    }
    this.active = false;
    this.stopAccessibilityMonitor();
    this.start();
  }

  private handleNativeEvent(line: string, generation: number): void {
    if (generation !== this.generation) return;
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
  }

  private startAccessibilityMonitor(): void {
    if (this.accessibilityTimer || !this.enabled) return;
    this.accessibilityTimer = setInterval(() => {
      let trusted: boolean;
      try {
        trusted = this.native().isTrusted();
      } catch {
        return;
      }
      if (trusted === this.accessibilityTrusted) return;
      this.accessibilityTrusted = trusted;
      this.restart();
    }, ACCESSIBILITY_CHECK_INTERVAL_MS);
  }

  private stopAccessibilityMonitor(): void {
    if (!this.accessibilityTimer) return;
    clearInterval(this.accessibilityTimer);
    this.accessibilityTimer = undefined;
  }

  private nativeConfiguration(): NativeCollectorConfiguration {
    return {
      captureWindowTitles: this.settings.captureWindowTitles,
      captureFocusedElements: this.settings.captureFocusedElements,
      captureTextInput: this.settings.captureTextInput,
      capturePointerClicks: this.settings.capturePointerClicks,
      captureBrowserURLs: this.settings.captureBrowserURLs,
      captureDocumentContext: this.settings.captureDocumentContext,
      captureUISnapshots: this.settings.captureUISnapshots,
      captureEmailActivity: this.settings.captureEmailActivity,
      captureMessagingActivity: this.settings.captureMessagingActivity,
      excludedBundleIdentifiers: this.settings.excludedBundleIdentifiers,
      excludedProcessIdentifiers: [process.pid]
    };
  }

  private native(): NativeCollectorBinding {
    this.nativeBinding ??= loadNativeCollectorBinding();
    return this.nativeBinding;
  }
}

function loadNativeCollectorBinding(): NativeCollectorBinding {
  const architecture = process.arch === "x64" ? "x64" : "arm64";
  const candidates = [
    resolve(process.resourcesPath, "native", "openhistory-native.node"),
    resolve(process.cwd(), ".todesktop", "native", architecture, "openhistory-native.node"),
    resolve(process.cwd(), ".todesktop", "native", "universal", "openhistory-native.node")
  ];
  const modulePath = candidates.find(existsSync);
  if (!modulePath) {
    throw new Error("Native collector module is missing; run npm run build:native");
  }
  const require = createRequire(import.meta.url);
  return require(modulePath) as NativeCollectorBinding;
}
