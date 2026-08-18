import {
  CURRENT_INFERENCE_ONBOARDING_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
  IPC_CHANNELS,
  type AgentAccessState,
  type AppPresentationMode,
  type BootstrapState,
  type CollectionSettings,
  type HistoryChatTurn,
  type HourState,
  type InferenceOnboardingSelection,
  type DailyRollupState,
  type TimelineApplication,
  type TimelineState
} from "@shared/contracts";
import {
  INFERENCE_PROVIDERS,
  isCloudInferenceProvider,
  isInferenceProvider,
  type AppleInferenceAvailability,
  type CloudInferenceProvider,
  type ApiKeySource,
  type InferenceProvider,
  type InferenceSettings
} from "@shared/inference";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from "electron";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentAccessStore } from "./agent-access-store";
import { AgentMcpService } from "./agent-mcp-service";
import { AgentProjectionStore } from "./agent-projection";
import { ApiKeyStore } from "./api-key-store";
import { loadApplicationIcon } from "./application-icon";
import { CollectorService } from "./collector-service";
import { getRuntimeConfig } from "./config";
import { deleteOwnedDataDirectory, ensureOwnedDataDirectory } from "./data-directory";
import { sanitizedDiagnostics } from "./diagnostics";
import { HourCoordinator } from "./hour-coordinator";
import { HourStore } from "./hour-store";
import { HistoryChatService } from "./history-chat-service";
import {
  AUTOMATIC_HISTORY_INTERVAL_MS,
  HISTORY_CATCH_UP_DELAY_MS,
  type PendingHistoryCounts,
  shouldScheduleHistoryCatchUp
} from "./history-scheduling";
import { InferenceSettingsStore } from "./inference-settings-store";
import { listInstalledApplications } from "./installed-applications";
import {
  anchoredMenuBarWindowPosition,
  menuBarToggleAction,
  menuBarTransitionShowDelay,
  usableTrayBounds
} from "./menu-bar-position";
import {
  assertInferenceOnboardingAvailability,
  normalizeInferenceOnboardingSelection
} from "./inference-onboarding";
import { probeAppleFoundationModel } from "./inference-provider";
import { DailyRollupCoordinator } from "./daily-rollup-coordinator";
import { DailyRollupStore } from "./daily-rollup-store";
import { InferenceService } from "./openai-service";
import { inferenceErrorMetadata, publicInferenceErrorMessage } from "./openai-error";
import { writePrivateFile } from "./private-storage";
import { cloudInferenceNeedsApiKey, cloudInferenceNeedsConsent } from "./privacy-consent";
import { ALWAYS_PROTECTED_BUNDLE_IDENTIFIERS } from "./privacy-policy";
import { reconcileProtectedHistory } from "./privacy-reconciler";
import { isTrustedRendererUrl, safeExternalHttpsUrl } from "./renderer-security";
import { SettingsStore } from "./settings-store";
import { TimelineCoordinator } from "./timeline-coordinator";
import { TimelineStore } from "./timeline-store";
import { RecentActivityReader } from "./unsummarized-activity";
import todesktop from "@todesktop/runtime";

todesktop.init();

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let appPresentationMode: AppPresentationMode = "dock";
let isQuitting = false;
let menuBarPositionTimer: ReturnType<typeof setTimeout> | undefined;
let menuBarBlurTimer: ReturnType<typeof setTimeout> | undefined;
let menuBarWindowShowRequested = false;
let appPresentationModeTimer: ReturnType<typeof setTimeout> | undefined;
let collector: CollectorService;
let inference: InferenceService;
let timeline: TimelineCoordinator;
let settingsStore: SettingsStore;
let inferenceSettingsStore: InferenceSettingsStore;
let inferenceSettings: InferenceSettings;
let appleAvailability: AppleInferenceAvailability;
let apiKeyStores: Record<InferenceProvider, ApiKeyStore>;
let apiKeySources: Record<InferenceProvider, ApiKeySource> = {
  apple: "none",
  openai: "none",
  anthropic: "none",
  kimi: "none"
};
let environmentApiKeys: Record<InferenceProvider, string | undefined>;
let hour: HourCoordinator;
let dailyRollup: DailyRollupCoordinator;
let agentMcp: AgentMcpService;
let historyChat: HistoryChatService;
let derivedStateTimer: ReturnType<typeof setInterval> | undefined;
let automaticHistoryTimer: ReturnType<typeof setInterval> | undefined;
let initialHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let catchUpHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let historyBuildPromise: Promise<void> | undefined;
const applicationIconCache = new Map<string, Promise<string | undefined>>();

function rendererUrlIsTrusted(value: string): boolean {
  return isTrustedRendererUrl(
    value,
    pathToFileURL(join(__dirname, "../renderer/index.html")).href,
    process.env.ELECTRON_RENDERER_URL
  );
}

function handleTrustedIpc<Arguments extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Arguments) => Result
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame || !rendererUrlIsTrusted(event.senderFrame.url)) {
      throw new Error("Rejected IPC request from an untrusted renderer");
    }
    return listener(event, ...(args as Arguments));
  });
}

function openHistoryIconPath(): string | undefined {
  const candidates = [
    join(process.resourcesPath, "openhistory-icon.png"),
    join(process.resourcesPath, "resources", "openhistory-icon.png"),
    resolve(process.cwd(), "resources", "openhistory-icon.png"),
    resolve(__dirname, "../../resources/openhistory-icon.png")
  ];
  return candidates.find(existsSync);
}

function createWindow(
  mode: AppPresentationMode,
  showWhenReady = mode === "dock",
  showDelayMilliseconds = 0
): void {
  const useNativeVibrancy = process.platform === "darwin";
  const icon = openHistoryIconPath();
  const menuBarMode = mode === "menuBar";
  const window = new BrowserWindow({
    width: menuBarMode ? 440 : 480,
    height: menuBarMode ? 660 : 694,
    minWidth: menuBarMode ? 440 : 400,
    minHeight: menuBarMode ? 660 : 560,
    show: false,
    ...(menuBarMode ? {
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      roundedCorners: true
    } : {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 16, y: 16 }
    }),
    transparent: useNativeVibrancy,
    backgroundColor: useNativeVibrancy ? "#00000000" : "#f6f5f1",
    ...(icon ? { icon } : {}),
    ...(useNativeVibrancy ? {
      vibrancy: "under-window" as const,
      visualEffectState: "active" as const
    } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = safeExternalHttpsUrl(url);
    if (externalUrl) void shell.openExternal(externalUrl);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (rendererUrlIsTrusted(url)) return;
    event.preventDefault();
    const externalUrl = safeExternalHttpsUrl(url);
    if (externalUrl) void shell.openExternal(externalUrl);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (rendererUrlIsTrusted(url)) return;
    event.preventDefault();
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (menuBarMode && input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      hideMenuBarWindow(window);
    }
  });
  window.on("blur", () => {
    if (!menuBarMode || isQuitting) return;
    clearMenuBarBlurTimer();
    menuBarBlurTimer = setTimeout(() => {
      menuBarBlurTimer = undefined;
      hideMenuBarWindow(window);
    }, 75);
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      menuBarWindowShowRequested = false;
      clearMenuBarPositionTimer();
      clearMenuBarBlurTimer();
      mainWindow = undefined;
    }
  });
  window.once("ready-to-show", () => {
    if (!showWhenReady) return;
    if (menuBarMode) {
      menuBarWindowShowRequested = true;
      if (showDelayMilliseconds > 0) {
        clearMenuBarPositionTimer();
        menuBarPositionTimer = setTimeout(() => {
          menuBarPositionTimer = undefined;
          showMenuBarWindowWhenAnchored();
        }, showDelayMilliseconds);
      } else {
        showMenuBarWindowWhenAnchored();
      }
    } else {
      window.show();
      window.focus();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

type TrayState = "capturing" | "paused" | "attention";

const TRAY_IMAGE_DATA: Record<TrayState, string> = {
  capturing: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACPTkDJAAAB90lEQVRYCe2WPU4DMRSEw0/2CAREjThDrsAFUJo0iBQUHIcKOAIlZSKl4RCINvy0UCEFmA/tIGPsbDYiWpAy0sjP9nvj59/dVmuFhldgbcHxNxS3XRKJh5JTKstCW8J98Up8Ft8j0kYfPvj+KnpSuxPjQXN1fImpRNUWFFI4E48CpUfZ1+KNeF+276jsigdip2yjuBBPxFcqdcHgI9GznMgeiJtiDvThg6/jhrILsTbOFWGRseytGgr4EuN4tGqB/XMwQovMgJgwibnOBFlygn3gWMo6Myc+BLFoMBk057odXCPPfiA7h3V17JfEzgEN66FdCe4yATwuuQN3qD5ug4WxaUsBDbTwRXsmcPYjc5nxZCAPHJe5JNDCF21e0Sx21WPR44QXSx3O3L4u6UttB1r2YYwvxM6874YfGdcp98RZh5I+fGKEWuEYyWzj4KXW4xXgsBg8rzFu1fAUNwZ1+vCJEWqFY/xYAfbwpYzuxiqqv4mniXY30YdPDGuh/S2B2JF6o9eQBPqiT2wjD1FbCTT6FLMKvWAVxrILGmuCGGK9mmjWQqOfYzJlBiPRM5jIHoi574O6PvvwwddxQ9mFmMSf/iULM2b/fDA9s1klvrX3PBwwZXM7uKK8E/5ihkks9FtetQWpRGjjHHREf1h43eBUXOF/rcAHyJy5hT/qObAAAAAASUVORK5CYII=",
  paused: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACPTkDJAAACAElEQVRYCe2WO05CQRiF8UVl7WMpLMDGHdBYaELhZuysdAvGisZEDI2tG7BFrbUyEj0fzrkZxnuBgWug4CSHefz/f/4Z5nUbjTWW/A9szJl/S3EHgUi8Bg5p/Bd2JHwi3ojv4ndC+rDhg2+taEvtWUyTVrXxJWYqpi1BUwqX4lmk9KZ6V3wUX0L/ocqWeCzuhz6Ka/Fc/KSRC5L3RM9yoHpH3BargA0ffB13r3pTzMaVIizSV30vQwFfYhyPVhZYPwcjNM8MiIkHMdOeYJTsYG84/sqcmRMfg1g0mAyaM50OjpFn31E9xYU6eiKlUdZnGxrWQ3sqOMsEcLmUbTiSY6c0yvpsQwMtYtAew+ZY6zfhUejrqvxK7PM00UALoM0tWiAdAGd4N1g553XBWmhzhRdIBxAbfckUzgtUYq04RyMdwAI55gtNB8BmMbhe60KsFef48w9wz3+ErK26skvHWmhPHAA79i4k5mEpO4bBPHOBBloA7eGoFn7SJaD7Ntg4EaehHhdPajyIlEZZn21o+IW0tm2l5dKvYkbVFrm5YF9sirkghljroJkFnlAHI5TzKOEbJ0crG8ygJ3oQA9U74qSNiQ0ffB038YNkpT/JNIkCrJ+/ETyzSSW+2WteZKuocDp4z2v9LJ+2BBVjGe0DzrYfFm43OHbJVAWv+1fqH/gBwU6fXzDlm+0AAAAASUVORK5CYII=",
  attention: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACPTkDJAAAB60lEQVRYCe2WvU7DMBSFw18nJDZ+noK5ExMLb9CFAaQMPBATvAJi6kikLjwFa4EZJkQF5wPfyDF1EqdB7dAjHeXGvvdcO7avk2VrLPkLbHTMv6W4Q0ckXhxnvPwXdiR8Lt6Jb+JXQNrowwffXjGS2pMYJo2940tMI5qWYCCFa/HSU3qVPRYfxWfXfqTnUDwTD1wbj1vxSvzgJRUkL0Sb5VR2Lm6LMdCHD74W9yB7ICbjRhEmMpG9n6CALzEWj1YSWD8LRqjLDIjxB9FqTzBKdrBtOD5lysyJ90EsGkwGzVang2Nks89lx7CnjhNH7BjQMD20G8FZJoDiUrfhSG7C2DGggRa+aFewWXn7TXjq2sZ6fgb9XV7RQAugTRUtEQ6AM7zrejnnfcG00KaElwgH4HdakSmdFzB8LT9HFg5ggRzdQsMBsFkMlNe+4Gv5Of58Aer8u8s67Cu7dEwL7coA5uVoewyPFVw4YseQdAwRuXdKnIgLZy/yQMNuSNOu1Wtbiik+FBeIPQ+dSjFCI9HEJ7IHNAZoWgJiiDUdNJOw1OuYkTKDQrQZTGXnYt39QB8++Fpc7Q/JSv+SaRIlWD/7R7CZ1T3xTV7zMlvE4HRwn1Mnevstb1qCyFh+9gFn2y4WqhucxQLW7Sv7Bb4Bg2icXJc3aZ8AAAAASUVORK5CYII="
};

function trayState(): TrayState {
  if (!collector.enabled) return "paused";
  if (!collector.accessibilityTrusted || collector.state === "failed") return "attention";
  return "capturing";
}

function trayStateLabel(state: TrayState): string {
  if (state === "capturing") return "Capturing activity";
  if (state === "paused") return "Capture paused";
  return "Capture needs attention";
}

function trayImage(state: TrayState): Electron.NativeImage {
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_IMAGE_DATA[state]}`)
    .resize({ width: 20, height: 20 });
  image.setTemplateImage(true);
  return image;
}

function positionMenuBarWindow(): boolean {
  if (!tray || !mainWindow || mainWindow.isDestroyed()) return false;
  const trayBounds = tray.getBounds();
  if (!usableTrayBounds(trayBounds)) return false;
  const windowBounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(trayBounds).workArea;
  const position = anchoredMenuBarWindowPosition(trayBounds, windowBounds, workArea);
  if (!position) return false;
  mainWindow.setPosition(position.x, position.y, false);
  return true;
}

function clearMenuBarPositionTimer(): void {
  if (!menuBarPositionTimer) return;
  clearTimeout(menuBarPositionTimer);
  menuBarPositionTimer = undefined;
}

function clearMenuBarBlurTimer(): void {
  if (!menuBarBlurTimer) return;
  clearTimeout(menuBarBlurTimer);
  menuBarBlurTimer = undefined;
}

function showMenuBarWindowWhenAnchored(attempt = 0): void {
  clearMenuBarPositionTimer();
  if (!menuBarWindowShowRequested) return;
  if (appPresentationMode !== "menuBar" || !mainWindow || mainWindow.isDestroyed()) {
    menuBarWindowShowRequested = false;
    return;
  }
  if (positionMenuBarWindow()) {
    menuBarWindowShowRequested = false;
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (attempt >= 40) {
    menuBarWindowShowRequested = false;
    return;
  }
  menuBarPositionTimer = setTimeout(() => {
    menuBarPositionTimer = undefined;
    showMenuBarWindowWhenAnchored(attempt + 1);
  }, 50);
}

function showMenuBarWindow(): void {
  menuBarWindowShowRequested = true;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow("menuBar", true);
  else showMenuBarWindowWhenAnchored();
}

function hideMenuBarWindow(window = mainWindow): void {
  menuBarWindowShowRequested = false;
  clearMenuBarPositionTimer();
  clearMenuBarBlurTimer();
  if (window && !window.isDestroyed()) window.hide();
}

function toggleMenuBarWindow(): void {
  clearMenuBarBlurTimer();
  const action = menuBarToggleAction(Boolean(mainWindow?.isVisible()), menuBarWindowShowRequested);
  if (action === "hide") hideMenuBarWindow();
  else showMenuBarWindow();
}

function sendBootstrapState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.bootstrapState, bootstrapState());
}

function toggleCollectionFromTray(): void {
  const current = settingsStore.load();
  if (!collector.enabled && current.privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) {
    showMenuBarWindow();
    return;
  }
  collector.setEnabled(!collector.enabled);
  refreshTray();
  sendBootstrapState();
}

function openSettingsFromTray(): void {
  showMenuBarWindow();
  if (!mainWindow) return;
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send(IPC_CHANNELS.openSettings);
    });
  } else {
    mainWindow.webContents.send(IPC_CHANNELS.openSettings);
  }
}

function refreshTray(): void {
  if (!tray) return;
  const state = trayState();
  tray.setImage(trayImage(state));
  tray.setPressedImage(trayImage(state));
  tray.setToolTip(`OpenHistory — ${trayStateLabel(state)}`);
}

function showTrayContextMenu(): void {
  if (!tray) return;
  const state = trayState();
  tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: trayStateLabel(state), enabled: false },
    { type: "separator" },
    { label: mainWindow?.isVisible() ? "Hide OpenHistory" : "Show OpenHistory", click: toggleMenuBarWindow },
    { label: collector.enabled ? "Pause Capture" : "Resume Capture", click: toggleCollectionFromTray },
    { label: "Settings…", click: openSettingsFromTray },
    { type: "separator" },
    { label: "Quit OpenHistory", role: "quit" }
  ]));
}

function ensureTray(): void {
  if (tray) return;
  tray = new Tray(trayImage(trayState()));
  if (process.platform === "darwin") tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", toggleMenuBarWindow);
  tray.on("right-click", showTrayContextMenu);
  refreshTray();
}

function destroyTray(): void {
  clearMenuBarPositionTimer();
  tray?.destroy();
  tray = undefined;
}

function recreateWindow(
  mode: AppPresentationMode,
  showWhenReady: boolean,
  showDelayMilliseconds = 0
): void {
  const previous = mainWindow;
  mainWindow = undefined;
  previous?.destroy();
  createWindow(mode, showWhenReady, showDelayMilliseconds);
}

function applyAppPresentationMode(mode: AppPresentationMode, showWhenReady = false): void {
  if (appPresentationModeTimer) {
    clearTimeout(appPresentationModeTimer);
    appPresentationModeTimer = undefined;
  }
  menuBarWindowShowRequested = false;
  clearMenuBarPositionTimer();
  clearMenuBarBlurTimer();
  const showDelayMilliseconds = menuBarTransitionShowDelay(appPresentationMode, mode);
  appPresentationMode = mode;
  if (mode === "menuBar") {
    ensureTray();
    app.dock?.hide();
  } else {
    destroyTray();
    void app.dock?.show();
  }
  recreateWindow(mode, showWhenReady || mode === "dock", showDelayMilliseconds);
}

function scheduleAppPresentationMode(mode: AppPresentationMode, showWhenReady = false): void {
  if (appPresentationModeTimer) clearTimeout(appPresentationModeTimer);
  appPresentationModeTimer = setTimeout(() => {
    appPresentationModeTimer = undefined;
    applyAppPresentationMode(mode, showWhenReady);
  }, 100);
}

function bootstrapState(): BootstrapState {
  return {
    collectorState: collector.state,
    collectionEnabled: collector.enabled,
    dataDirectory: collector.dataDirectory,
    inference: {
      settings: structuredClone(inferenceSettings),
      configured: inference.configured,
      appleAvailability: { ...appleAvailability },
      keySources: { ...apiKeySources }
    },
    recentEvents: collector.recentEvents,
    timeline: timeline.getState(),
    hour: hour.getState(),
    settings: settingsStore.load(),
    accessibilityTrusted: collector.accessibilityTrusted,
    dailyRollup: dailyRollup.getState(),
    agentAccess: agentMcp.getState()
  };
}

function sendTimelineState(state: TimelineState = timeline.getState()): void {
  mainWindow?.webContents.send(IPC_CHANNELS.timelineState, state);
}

function sendHourState(state: HourState = hour.getState()): void {
  mainWindow?.webContents.send(IPC_CHANNELS.hourState, state);
}

function sendDailyRollupState(state: DailyRollupState = dailyRollup.getState()): void {
  mainWindow?.webContents.send(IPC_CHANNELS.dailyRollupState, state);
}

function sendAgentAccessState(state: AgentAccessState = agentMcp.getState()): void {
  mainWindow?.webContents.send(IPC_CHANNELS.agentAccessState, state);
}

function sendDerivedState(): void {
  sendTimelineState();
  sendHourState();
  sendDailyRollupState();
  sendAgentAccessState();
}

function buildHistory(): Promise<void> {
  if (historyBuildPromise) return historyBuildPromise;
  historyBuildPromise = (async () => {
    const pendingBefore = pendingHistoryCounts();
    await timeline.summarizePending(sendTimelineState);
    await hour.consolidatePending(sendHourState);
    await dailyRollup.consolidatePending(sendDailyRollupState);
    sendDerivedState();
    if (shouldScheduleHistoryCatchUp(pendingBefore, pendingHistoryCounts())) {
      scheduleHistoryCatchUp();
    }
  })().finally(() => { historyBuildPromise = undefined; });
  return historyBuildPromise;
}

function pendingHistoryCounts(): PendingHistoryCounts {
  return {
    timeline: timeline.getState().pendingEpisodeCount,
    hour: hour.getState().pendingHourCount,
    day: dailyRollup.getState().pendingDayCount
  };
}

function scheduleHistoryCatchUp(): void {
  if (catchUpHistoryTimer) return;
  catchUpHistoryTimer = setTimeout(() => {
    catchUpHistoryTimer = undefined;
    buildHistoryIfNeeded();
  }, HISTORY_CATCH_UP_DELAY_MS);
}

function buildHistoryIfNeeded(): void {
  if (!inference.configured) return;
  const hasPendingWork = timeline.getState().pendingEpisodeCount > 0 ||
    hour.getState().pendingHourCount > 0 || dailyRollup.getState().pendingDayCount > 0;
  if (hasPendingWork) {
    void buildHistory().catch((error: unknown) => {
      console.error("Automatic history generation failed", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
    });
  }
}

function applicationIcon(application: TimelineApplication): Promise<string | undefined> {
  const name = application.name.trim();
  if (!name || name.length > 100 || /[/\\\0]/.test(name)) return Promise.resolve(undefined);
  const cacheKey = application.bundleIdentifier ?? name;
  const cached = applicationIconCache.get(cacheKey);
  if (cached) return cached;
  const result = loadApplicationIcon(application, join(app.getPath("userData"), "Cache", "application-icons"));
  applicationIconCache.set(cacheKey, result);
  return result;
}

async function initialize(): Promise<void> {
  const icon = openHistoryIconPath();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);

  const config = getRuntimeConfig();
  ensureOwnedDataDirectory(config.dataDirectory, {
    adoptExistingUnmarked: config.adoptExistingDataDirectory
  });
  environmentApiKeys = config.inferenceApiKeys;
  appleAvailability = publicAppleAvailability(probeAppleFoundationModel());
  apiKeyStores = Object.fromEntries(INFERENCE_PROVIDERS.map((provider) => [
    provider,
    new ApiKeyStore(config.dataDirectory, safeStorage, provider)
  ])) as Record<InferenceProvider, ApiKeyStore>;
  apiKeySources = Object.fromEntries(INFERENCE_PROVIDERS.map((provider) => [
    provider,
    apiKeyStores[provider].load() ? "saved" : environmentApiKeys[provider] ? "environment" : "none"
  ])) as Record<InferenceProvider, ApiKeySource>;
  inferenceSettingsStore = new InferenceSettingsStore(config.dataDirectory, config.inferenceModels);
  inferenceSettings = inferenceSettingsStore.load();
  settingsStore = new SettingsStore(config.dataDirectory);
  const settings = settingsStore.load();
  appPresentationMode = settings.appPresentationMode;
  if (cloudInferenceNeedsConsent(inferenceSettings, settings)) {
    inferenceSettings = inferenceSettingsStore.save({ ...inferenceSettings, enabled: false });
  }
  nativeTheme.themeSource = settings.appearanceMode;
  collector = new CollectorService(config.dataDirectory, settings);
  if (settings.privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) collector.setEnabled(false);
  inference = new InferenceService({
    settings: inferenceSettings,
    apiKey: activeApiKey(inferenceSettings.provider)
  });
  const timelineStore = new TimelineStore(join(config.dataDirectory, "timeline"));
  const hourStore = new HourStore(join(config.dataDirectory, "hours"));
  const dailyRollupStore = new DailyRollupStore(
    join(config.dataDirectory, "daily-rollups"),
    join(config.dataDirectory, "memory")
  );
  const privacyReconciliation = reconcileProtectedHistory(
    config.dataDirectory,
    timelineStore,
    hourStore,
    dailyRollupStore,
    {
      captureEmailActivity: settings.captureEmailActivity,
      captureMessagingActivity: settings.captureMessagingActivity
    }
  );
  if (Object.values(privacyReconciliation).some((count) => count > 0)) {
    console.info("Removed protected activity from local history", privacyReconciliation);
  }
  timeline = new TimelineCoordinator(
    config.dataDirectory,
    timelineStore,
    inference,
    () => {
      const current = settingsStore.load();
      return {
        captureEmailActivity: current.captureEmailActivity,
        captureMessagingActivity: current.captureMessagingActivity
      };
    }
  );
  hour = new HourCoordinator(timelineStore, hourStore, inference);
  dailyRollup = new DailyRollupCoordinator(timelineStore, dailyRollupStore, inference, hourStore);
  const agentAccessStore = new AgentAccessStore(join(config.dataDirectory, "agent-access.json"));
  const agentProjection = new AgentProjectionStore(
    join(config.dataDirectory, "agent-projection"),
    timelineStore,
    dailyRollupStore
  );
  agentMcp = new AgentMcpService(agentProjection, agentAccessStore, { port: config.mcpPort });
  historyChat = new HistoryChatService(
    agentProjection,
    inference,
    new RecentActivityReader(
      config.dataDirectory,
      () => {
        const current = settingsStore.load();
        return {
          captureEmailActivity: current.captureEmailActivity,
          captureMessagingActivity: current.captureMessagingActivity
        };
      }
    )
  );
  agentMcp.on("state", sendAgentAccessState);
  await agentMcp.start();

  handleTrustedIpc(IPC_CHANNELS.getBootstrap, () => bootstrapState());
  handleTrustedIpc(IPC_CHANNELS.refreshAppleAvailability, () => {
    appleAvailability = publicAppleAvailability(probeAppleFoundationModel());
    if (inferenceSettings.provider === "apple") {
      inference.configure(inferenceSettings, activeApiKey("apple"));
    }
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.setCollectionEnabled, (_event, enabled: boolean) => {
    if (enabled && settingsStore.load().privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) {
      throw new Error("Accept the privacy notice before starting activity capture");
    }
    collector.setEnabled(Boolean(enabled));
    refreshTray();
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.updateCollectionSettings, async (_event, settings: CollectionSettings) => {
    const current = settingsStore.load();
    const saved = settingsStore.save({
      ...settings,
      privacyNoticeVersion: current.privacyNoticeVersion,
      inferenceOnboardingVersion: current.inferenceOnboardingVersion,
      cloudInferenceConsents: current.cloudInferenceConsents
    });
    nativeTheme.themeSource = saved.appearanceMode;
    collector.setSettings(saved);
    const presentationModeChanged = current.appPresentationMode !== saved.appPresentationMode;
    const privacyBecameMoreRestrictive =
      (current.captureEmailActivity && !saved.captureEmailActivity) ||
      (current.captureMessagingActivity && !saved.captureMessagingActivity);
    if (privacyBecameMoreRestrictive) {
      if (historyBuildPromise) await historyBuildPromise;
      const privacyReconciliation = reconcileProtectedHistory(
        config.dataDirectory,
        timelineStore,
        hourStore,
        dailyRollupStore,
        {
          captureEmailActivity: saved.captureEmailActivity,
          captureMessagingActivity: saved.captureMessagingActivity
        }
      );
      if (Object.values(privacyReconciliation).some((count) => count > 0)) {
        console.info("Removed newly protected activity from local history", privacyReconciliation);
      }
      sendDerivedState();
      buildHistoryIfNeeded();
    }
    const nextState = bootstrapState();
    if (presentationModeChanged) {
      scheduleAppPresentationMode(saved.appPresentationMode, true);
    }
    return nextState;
  });
  handleTrustedIpc(IPC_CHANNELS.updateInferenceSettings, async (_event, next: InferenceSettings) => {
    if (next.enabled && settingsStore.load().privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) {
      throw new Error("Accept the privacy notice before enabling automatic summaries");
    }
    if (cloudInferenceNeedsConsent(next, settingsStore.load())) {
      throw new Error(`Cloud inference with ${next.provider} requires explicit confirmation`);
    }
    if (cloudInferenceNeedsApiKey(next, activeApiKey(next.provider))) {
      throw new Error(`${next.provider} requires an API key`);
    }
    if (historyBuildPromise) await historyBuildPromise;
    inferenceSettings = inferenceSettingsStore.save(next);
    inference.configure(inferenceSettings, activeApiKey(inferenceSettings.provider));
    buildHistoryIfNeeded();
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.setInferenceApiKey, async (
    _event,
    provider: InferenceProvider,
    apiKey: string
  ) => {
    if (!isInferenceProvider(provider) || typeof apiKey !== "string") throw new Error("Invalid API key");
    const normalized = apiKey.trim();
    if (!normalized) throw new Error("Invalid API key");
    if (historyBuildPromise) await historyBuildPromise;
    apiKeyStores[provider].save(normalized);
    apiKeySources[provider] = "saved";
    if (provider === inferenceSettings.provider) inference.configure(inferenceSettings, normalized);
    buildHistoryIfNeeded();
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.clearInferenceApiKey, async (_event, provider: InferenceProvider) => {
    if (!isInferenceProvider(provider)) throw new Error("Invalid inference provider");
    if (historyBuildPromise) await historyBuildPromise;
    apiKeyStores[provider].clear();
    apiKeySources[provider] = environmentApiKeys[provider] ? "environment" : "none";
    if (provider === inferenceSettings.provider) {
      inference.configure(inferenceSettings, environmentApiKeys[provider]);
    }
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.acceptPrivacyNotice, () => {
    const current = settingsStore.load();
    const saved = settingsStore.save({
      ...current,
      privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION
    });
    collector.setSettings(saved);
    collector.setEnabled(true);
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.completeInferenceOnboarding, async (
    _event,
    requestedSelection: InferenceOnboardingSelection
  ) => {
    const current = settingsStore.load();
    if (current.privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) {
      throw new Error("Accept the privacy notice before choosing a summary model");
    }
    const selection = normalizeInferenceOnboardingSelection(requestedSelection);
    if (selection.provider === "apple") {
      appleAvailability = publicAppleAvailability(probeAppleFoundationModel());
      assertInferenceOnboardingAvailability(selection, appleAvailability);
    }
    if (historyBuildPromise) await historyBuildPromise;

    let settings = current;
    if (isCloudInferenceProvider(selection.provider)) {
      apiKeyStores[selection.provider].save(selection.apiKey!);
      apiKeySources[selection.provider] = "saved";
      settings = settingsStore.save({
        ...settings,
        cloudInferenceConsents: [
          ...new Set([...settings.cloudInferenceConsents, selection.provider])
        ]
      });
    }

    inferenceSettings = inferenceSettingsStore.save({
      ...inferenceSettings,
      enabled: true,
      provider: selection.provider,
      models: {
        ...inferenceSettings.models,
        [selection.provider]: selection.model
      }
    });
    inference.configure(inferenceSettings, activeApiKey(selection.provider));
    const savedSettings = settingsStore.save({
      ...settings,
      inferenceOnboardingVersion: CURRENT_INFERENCE_ONBOARDING_VERSION,
      captureEmailActivity: selection.captureEmailActivity === true,
      captureMessagingActivity: selection.captureMessagingActivity === true,
      appPresentationMode: selection.appPresentationMode ?? "dock"
    });
    collector.setSettings(savedSettings);
    buildHistoryIfNeeded();
    const nextState = bootstrapState();
    if (current.appPresentationMode !== savedSettings.appPresentationMode) {
      scheduleAppPresentationMode(savedSettings.appPresentationMode, true);
    }
    return nextState;
  });
  handleTrustedIpc(IPC_CHANNELS.authorizeCloudInference, (
    _event,
    provider: CloudInferenceProvider
  ) => {
    if (!isCloudInferenceProvider(provider)) throw new Error("Invalid cloud inference provider");
    const current = settingsStore.load();
    if (current.privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) {
      throw new Error("Accept the privacy notice before authorizing cloud inference");
    }
    settingsStore.save({
      ...current,
      cloudInferenceConsents: [...new Set([...current.cloudInferenceConsents, provider])]
    });
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.requestAccessibility, () => {
    if (settingsStore.load().privacyNoticeVersion < CURRENT_PRIVACY_NOTICE_VERSION) {
      throw new Error("Accept the privacy notice before requesting activity access");
    }
    collector.requestAccessibilityPermission();
    refreshTray();
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.refreshAccessibility, () => {
    collector.refreshAccessibilityPermission();
    refreshTray();
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.openAccessibilitySettings, async () => {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    );
  });
  handleTrustedIpc(IPC_CHANNELS.revealDataDirectory, async () => {
    await shell.openPath(config.dataDirectory);
  });
  handleTrustedIpc(IPC_CHANNELS.exportDiagnostics, async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export privacy-safe diagnostics",
      defaultPath: join(app.getPath("documents"), "OpenHistory Diagnostics.json"),
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return false;
    const diagnostics = sanitizedDiagnostics(bootstrapState(), {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      osRelease: release()
    });
    writePrivateFile(result.filePath, `${JSON.stringify(diagnostics, null, 2)}\n`);
    return true;
  });
  handleTrustedIpc(IPC_CHANNELS.deleteAllData, async () => {
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      title: "Delete all OpenHistory data?",
      message: "Permanently delete your local activity, summaries, settings, keys, and agent connections?",
      detail: `This cannot be undone. OpenHistory will restart.\n\nData directory:\n${config.dataDirectory}`,
      buttons: ["Cancel", "Delete and restart"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return false;
    if (historyBuildPromise) await historyBuildPromise.catch(() => undefined);
    collector.stop();
    await agentMcp.stop();
    if (derivedStateTimer) clearInterval(derivedStateTimer);
    if (automaticHistoryTimer) clearInterval(automaticHistoryTimer);
    if (initialHistoryTimer) clearTimeout(initialHistoryTimer);
    if (catchUpHistoryTimer) clearTimeout(catchUpHistoryTimer);
    deleteOwnedDataDirectory(config.dataDirectory);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return true;
  });
  handleTrustedIpc(IPC_CHANNELS.buildHistory, async () => {
    await buildHistory();
    return bootstrapState();
  });
  handleTrustedIpc(IPC_CHANNELS.copyAgentSetup, () => {
    const { prompt, state } = agentMcp.createSetup();
    clipboard.writeText(prompt);
    sendAgentAccessState(state);
    return state;
  });
  handleTrustedIpc(IPC_CHANNELS.revokeAgentConnection, (_event, id: string) => {
    if (typeof id !== "string" || id.length > 100) throw new Error("Invalid connection identifier");
    agentAccessStore.revoke(id);
    const state = agentMcp.getState();
    sendAgentAccessState(state);
    return state;
  });
  handleTrustedIpc(IPC_CHANNELS.listInstalledApplications, () => listInstalledApplications().filter(
    (application) => !application.bundleIdentifier ||
      !ALWAYS_PROTECTED_BUNDLE_IDENTIFIERS.has(application.bundleIdentifier)
  ));
  handleTrustedIpc(IPC_CHANNELS.getApplicationIcon, (_event, application: TimelineApplication) => {
    if (!application || typeof application.name !== "string") return undefined;
    return applicationIcon(application);
  });
  handleTrustedIpc(IPC_CHANNELS.historyChat, async (_event, turns: HistoryChatTurn[]) => {
    try {
      return await historyChat.reply(turns);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Chat currently needs")) throw error;
      console.error("History chat failed", inferenceErrorMetadata(error, inference.provider));
      throw new Error(publicInferenceErrorMessage(error, "History chat", inference.provider));
    }
  });

  collector.on("event", (event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.activityEvent, event);
    if (event.kind === "collector_started") refreshTray();
  });
  collector.on("state", (state) => {
    mainWindow?.webContents.send(IPC_CHANNELS.collectorState, state);
    refreshTray();
  });

  if (appPresentationMode === "menuBar") {
    ensureTray();
    app.dock?.hide();
    createWindow("menuBar", false);
  } else {
    createWindow("dock", true);
  }
  if (settings.privacyNoticeVersion >= CURRENT_PRIVACY_NOTICE_VERSION) collector.start();
  derivedStateTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) sendDerivedState();
  }, 60_000);
  initialHistoryTimer = setTimeout(buildHistoryIfNeeded, 15_000);
  automaticHistoryTimer = setInterval(buildHistoryIfNeeded, AUTOMATIC_HISTORY_INTERVAL_MS);

  app.on("activate", () => {
    if (appPresentationMode === "menuBar") showMenuBarWindow();
    else if (BrowserWindow.getAllWindows().length === 0) createWindow("dock", true);
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function activeApiKey(provider: InferenceProvider): string | undefined {
  return apiKeyStores[provider].load() ?? environmentApiKeys[provider];
}

function publicAppleAvailability(
  availability: AppleInferenceAvailability
): AppleInferenceAvailability {
  return {
    available: availability.available,
    ...(availability.reason ? { reason: availability.reason } : {}),
    ...(availability.reasonCode ? { reasonCode: availability.reasonCode } : {})
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (appPresentationMode === "menuBar") {
      showMenuBarWindow();
      return;
    }
    if (!mainWindow) createWindow("dock", true);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  void app.whenReady().then(initialize).catch((error: unknown) => {
    console.error("OpenHistory failed to start", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    app.quit();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  if (derivedStateTimer) clearInterval(derivedStateTimer);
  if (automaticHistoryTimer) clearInterval(automaticHistoryTimer);
  if (initialHistoryTimer) clearTimeout(initialHistoryTimer);
  if (catchUpHistoryTimer) clearTimeout(catchUpHistoryTimer);
  if (appPresentationModeTimer) clearTimeout(appPresentationModeTimer);
  if (menuBarBlurTimer) clearTimeout(menuBarBlurTimer);
  collector?.stop();
  void agentMcp?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
