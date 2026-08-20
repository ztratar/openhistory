import type {
  CloudInferenceProvider,
  InferenceProvider,
  InferenceSettings,
  InferenceState
} from "./inference";

export const CURRENT_PRIVACY_NOTICE_VERSION = 1;
export const CURRENT_INFERENCE_ONBOARDING_VERSION = 1;

export type CollectorState = "starting" | "running" | "paused" | "stopped" | "failed";
export const APP_PRESENTATION_MODES = ["dock", "menuBar"] as const;
export type AppPresentationMode = (typeof APP_PRESENTATION_MODES)[number];

export const IPC_CHANNELS = {
  getBootstrap: "openhistory:get-bootstrap",
  setCollectionEnabled: "openhistory:set-collection-enabled",
  updateCollectionSettings: "openhistory:update-collection-settings",
  updateInferenceSettings: "openhistory:update-inference-settings",
  setInferenceApiKey: "openhistory:set-inference-api-key",
  clearInferenceApiKey: "openhistory:clear-inference-api-key",
  acceptPrivacyNotice: "openhistory:accept-privacy-notice",
  completeInferenceOnboarding: "openhistory:complete-inference-onboarding",
  refreshAppleAvailability: "openhistory:refresh-apple-availability",
  authorizeCloudInference: "openhistory:authorize-cloud-inference",
  requestAccessibility: "openhistory:request-accessibility",
  refreshAccessibility: "openhistory:refresh-accessibility",
  openAccessibilitySettings: "openhistory:open-accessibility-settings",
  revealDataDirectory: "openhistory:reveal-data-directory",
  deleteAllData: "openhistory:delete-all-data",
  exportDiagnostics: "openhistory:export-diagnostics",
  quitApp: "openhistory:quit-app",
  buildHistory: "openhistory:build-history",
  copyAgentSetup: "openhistory:copy-agent-setup",
  revokeAgentConnection: "openhistory:revoke-agent-connection",
  listInstalledApplications: "openhistory:list-installed-applications",
  getApplicationIcon: "openhistory:get-application-icon",
  historyChat: "openhistory:history-chat",
  activityEvent: "openhistory:activity-event",
  collectorState: "openhistory:collector-state",
  timelineState: "openhistory:timeline-state",
  hourState: "openhistory:hour-state",
  dailyRollupState: "openhistory:daily-rollup-state",
  agentAccessState: "openhistory:agent-access-state",
  bootstrapState: "openhistory:bootstrap-state",
  openSettings: "openhistory:open-settings"
} as const;

export interface ApplicationDescriptor {
  bundleIdentifier: string | null;
  localizedName: string | null;
  processIdentifier: number;
}

export interface SemanticElement {
  role?: string;
  subrole?: string;
  title?: string;
  label?: string;
  identifier?: string;
  value?: string;
}

export interface TextChange {
  insertedText: string;
  deletedCharacterCount: number;
  resultingValue: string;
}

export interface BrowserObservation {
  url: string;
  domain: string;
  title?: string;
}

export interface DocumentObservation {
  displayPath: string;
  name: string;
  fileExtension?: string;
}

export interface ActivityEvent {
  version: 1;
  id: string;
  timestamp: string;
  kind:
    | "collector_started"
    | "application_activated"
    | "window_changed"
    | "focused_element_changed"
    | "selection_changed"
    | "text_input"
    | "document_changed"
    | "pointer_click"
    | "url_changed"
    | "document_context_changed"
    | "ui_snapshot"
    | "application_terminated"
    | "screen_slept"
    | "screen_woke"
    | "session_locked"
    | "session_unlocked"
    | "privacy_boundary";
  application?: ApplicationDescriptor;
  windowTitle?: string;
  accessibilityTrusted?: boolean;
  pointerCaptureAvailable?: boolean;
  element?: SemanticElement;
  selectedElements?: SemanticElement[];
  textChange?: TextChange;
  browser?: BrowserObservation;
  document?: DocumentObservation;
  visibleText?: string[];
}

export interface ActivityEpisode {
  id: string;
  startTime: string;
  endTime: string;
  events: ActivityEvent[];
  applications: ApplicationDescriptor[];
}

export interface TimelineApplication {
  bundleIdentifier: string | null;
  name: string;
}

export interface TimelineSuggestion {
  type: "skill" | "automation";
  name: string;
  description: string;
}

export interface HistoryLink {
  label: string;
  url: string;
}

export interface TimelineItem {
  version: 1;
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  applications: TimelineApplication[];
  workThreads: string[];
  decisions: string[];
  outcomes: string[];
  blockers: string[];
  surfaces: string[];
  links?: HistoryLink[];
  suggestion: TimelineSuggestion | null;
  sourceEventIds?: string[];
}

export interface TimelineState {
  items: TimelineItem[];
  pendingEpisodeCount: number;
  summarizing: boolean;
  lastError?: string;
}

export interface HourItem {
  version: 1;
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  summary: string;
  applications: TimelineApplication[];
  workThreads: string[];
  decisions: string[];
  outcomes: string[];
  blockers: string[];
  surfaces: string[];
  links?: HistoryLink[];
  sourceTimelineIds: string[];
  sourceTimelineRevisions: string[];
  updatedAt: string;
}

export interface HourState {
  items: HourItem[];
  pendingHourCount: number;
  consolidating: boolean;
  lastError?: string;
}

export interface CollectionSettings {
  version: 1;
  privacyNoticeVersion: number;
  inferenceOnboardingVersion: number;
  cloudInferenceConsents: CloudInferenceProvider[];
  appearanceMode: "system" | "light" | "dark";
  appPresentationMode: AppPresentationMode;
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
}

export interface DailyRollupItem {
  version: 2;
  id: string;
  date: string;
  title: string;
  summary: string;
  themes: string[];
  accomplishments: string[];
  decisions: string[];
  unfinishedWork: string[];
  recurringPatterns: string[];
  links?: HistoryLink[];
  sourceTimelineIds: string[];
  sourceTimelineRevisions?: string[];
  updatedAt: string;
}

export interface DailyRollupState {
  items: DailyRollupItem[];
  pendingDayCount: number;
  consolidating: boolean;
  lastError?: string;
}

export type AgentServerStatus = "starting" | "running" | "failed" | "stopped";

export interface AgentConnection {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  accessCount: number;
  lastTool?: string;
  clientName?: string;
  clientVersion?: string;
  revokedAt?: string;
}

export interface AgentAccessState {
  status: AgentServerStatus;
  endpoint?: string;
  lastError?: string;
  connections: AgentConnection[];
  projection: {
    generatedAt?: string;
    timelineCount: number;
    dailyRollupCount: number;
  };
}

export interface HistoryChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface HistoryChatResponse {
  answer: string;
  toolsUsed: Array<
    "search_history" | "get_day" | "get_timeline_item" | "find_surfaces" | "get_unfinished_work" |
    "get_recent_activity"
  >;
}

export interface BootstrapState {
  collectorState: CollectorState;
  collectionEnabled: boolean;
  dataDirectory: string;
  inference: InferenceState;
  recentEvents: ActivityEvent[];
  timeline: TimelineState;
  hour: HourState;
  settings: CollectionSettings;
  accessibilityTrusted: boolean;
  dailyRollup: DailyRollupState;
  agentAccess: AgentAccessState;
}

export interface OpenHistoryBridge {
  getBootstrap(): Promise<BootstrapState>;
  setCollectionEnabled(enabled: boolean): Promise<BootstrapState>;
  updateCollectionSettings(settings: CollectionSettings): Promise<BootstrapState>;
  updateInferenceSettings(settings: InferenceSettings): Promise<BootstrapState>;
  setInferenceApiKey(provider: InferenceProvider, apiKey: string): Promise<BootstrapState>;
  clearInferenceApiKey(provider: InferenceProvider): Promise<BootstrapState>;
  acceptPrivacyNotice(): Promise<BootstrapState>;
  completeInferenceOnboarding(selection: InferenceOnboardingSelection): Promise<BootstrapState>;
  refreshAppleAvailability(): Promise<BootstrapState>;
  authorizeCloudInference(provider: CloudInferenceProvider): Promise<BootstrapState>;
  requestAccessibilityPermission(): Promise<BootstrapState>;
  refreshAccessibilityPermission(): Promise<BootstrapState>;
  openAccessibilitySettings(): Promise<void>;
  revealDataDirectory(): Promise<void>;
  deleteAllData(): Promise<boolean>;
  exportDiagnostics(): Promise<boolean>;
  quitApp(): Promise<void>;
  buildHistory(): Promise<BootstrapState>;
  copyAgentSetup(): Promise<AgentAccessState>;
  revokeAgentConnection(id: string): Promise<AgentAccessState>;
  listInstalledApplications(): Promise<TimelineApplication[]>;
  getApplicationIcon(application: TimelineApplication): Promise<string | undefined>;
  historyChat(turns: HistoryChatTurn[]): Promise<HistoryChatResponse>;
  onActivityEvent(listener: (event: ActivityEvent) => void): () => void;
  onCollectorState(listener: (state: CollectorState) => void): () => void;
  onTimelineState(listener: (state: TimelineState) => void): () => void;
  onHourState(listener: (state: HourState) => void): () => void;
  onDailyRollupState(listener: (state: DailyRollupState) => void): () => void;
  onAgentAccessState(listener: (state: AgentAccessState) => void): () => void;
  onBootstrapState(listener: (state: BootstrapState) => void): () => void;
  onOpenSettings(listener: () => void): () => void;
}

export interface InferenceOnboardingSelection {
  provider: InferenceProvider;
  model: string;
  apiKey?: string;
  captureEmailActivity?: boolean;
  captureMessagingActivity?: boolean;
  appPresentationMode?: AppPresentationMode;
}
