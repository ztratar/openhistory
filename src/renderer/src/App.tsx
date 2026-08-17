import type {
  BootstrapState,
  CollectionSettings,
  ActivityEvent,
  HistoryLink,
  HourItem,
  HistoryChatTurn,
  DailyRollupItem,
  TimelineApplication,
  TimelineItem
} from "@shared/contracts";
import {
  CURRENT_INFERENCE_ONBOARDING_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION
} from "@shared/contracts";
import {
  DEFAULT_INFERENCE_MODELS,
  appleInferenceAvailabilityGuidance,
  isCloudInferenceProvider,
  INFERENCE_MODEL_OPTIONS,
  INFERENCE_PROVIDER_LABELS,
  INFERENCE_PROVIDERS,
  type ApiKeySource,
  type AppleInferenceAvailability,
  type CloudInferenceProvider,
  type InferenceProvider,
  type InferenceSettings
} from "@shared/inference";
import { linkifyHistoryText } from "@shared/history-links";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const pages = ["History", "Chat", "Settings"] as const;
type Page = (typeof pages)[number];
type SetAppState = React.Dispatch<React.SetStateAction<BootstrapState | undefined>>;
const PAGE_STORAGE_KEY = "openhistory:page";
const APPLICATION_PREVIEW_LIMIT = 5;
const pageLabels: Record<Page, string> = {
  History: "Timeline",
  Chat: "Chat",
  Settings: "Settings"
};

export function App(): React.JSX.Element {
  const [state, setState] = useState<BootstrapState>();
  const [page, setPage] = useState<Page>(() => {
    const saved = sessionStorage.getItem(PAGE_STORAGE_KEY);
    return pages.find((candidate) => candidate === saved) ?? "History";
  });
  const [apiKeyFocusRequest, setApiKeyFocusRequest] = useState(0);
  const [startupError, setStartupError] = useState<string>();
  const [liveActivityOpen, setLiveActivityOpen] = useState(false);

  function selectPage(nextPage: Page): void {
    sessionStorage.setItem(PAGE_STORAGE_KEY, nextPage);
    setPage(nextPage);
  }

  function openApiKeySettings(): void {
    setApiKeyFocusRequest((current) => current + 1);
    selectPage("Settings");
  }

  useEffect(() => {
    void window.openHistory.getBootstrap().then(setState).catch(() => {
      setStartupError("OpenHistory could not load its local state.");
    });
    const unsubscribe = [
      window.openHistory.onActivityEvent((event) => {
        setState((current) => current ? {
          ...current,
          recentEvents: [...current.recentEvents, event].slice(-250),
          accessibilityTrusted: event.kind === "collector_started"
            ? event.accessibilityTrusted ?? false
            : current.accessibilityTrusted
        } : current);
      }),
      window.openHistory.onCollectorState((collectorState) => {
        setState((current) => current ? { ...current, collectorState } : current);
      }),
      window.openHistory.onTimelineState((timeline) => {
        setState((current) => current ? { ...current, timeline } : current);
      }),
      window.openHistory.onHourState((hour) => {
        setState((current) => current ? { ...current, hour } : current);
      }),
      window.openHistory.onDailyRollupState((dailyRollup) => {
        setState((current) => current ? { ...current, dailyRollup } : current);
      }),
      window.openHistory.onAgentAccessState((agentAccess) => {
        setState((current) => current ? { ...current, agentAccess } : current);
      })
    ];
    return () => unsubscribe.forEach((remove) => remove());
  }, []);

  async function toggleCollection(): Promise<void> {
    if (!state) return;
    setState(await window.openHistory.setCollectionEnabled(!state.collectionEnabled));
  }

  async function updateSettings(settings: CollectionSettings): Promise<void> {
    setState(await window.openHistory.updateCollectionSettings(settings));
  }

  async function acceptPrivacyNotice(): Promise<void> {
    setState(await window.openHistory.acceptPrivacyNotice());
  }

  const privacyAccepted = Boolean(
    state && state.settings.privacyNoticeVersion >= CURRENT_PRIVACY_NOTICE_VERSION
  );
  const inferenceOnboardingComplete = Boolean(
    state && state.settings.inferenceOnboardingVersion >= CURRENT_INFERENCE_ONBOARDING_VERSION
  );

  useEffect(() => {
    if (state && !state.collectionEnabled) setLiveActivityOpen(false);
  }, [state?.collectionEnabled]);

  return (
    <div className="app-shell">
      <header className="app-header">
        {liveActivityOpen ? (
          <div className="header-capture-control">
            <button
              aria-label="Back to OpenHistory"
              className="header-back-button"
              onClick={() => setLiveActivityOpen(false)}
              title="Back"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m9.75 3.25-4.5 4.75 4.5 4.75" /></svg>
              <span>Back</span>
            </button>
          </div>
        ) : state ? (
          <div className="header-capture-control">
            <CapturePill disabled={!privacyAccepted} onToggle={toggleCollection} state={state} />
            {state.collectionEnabled ? (
              <button
                aria-label="Open live activity"
                className="live-activity-button"
                onClick={() => setLiveActivityOpen(true)}
                title="Live activity"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path className="live-activity-feed-rail" d="M3.5 3.5v9" />
                  <path className="live-activity-feed-lines" d="M7 4h6M7 8h5M7 12h4" />
                  <circle className="live-activity-feed-node is-live" cx="3.5" cy="4" r="1.5" />
                  <circle className="live-activity-feed-node" cx="3.5" cy="8" r="1.15" />
                  <circle className="live-activity-feed-node" cx="3.5" cy="12" r="1.15" />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
        {!liveActivityOpen && inferenceOnboardingComplete ? (
          <nav className="top-tabs" aria-label="Main navigation">
            {pages.filter((item) => item !== "Settings").map((item) => (
              <button
                aria-current={page === item ? "page" : undefined}
                className={page === item ? "active" : ""}
                key={item}
                onClick={() => selectPage(item)}
              >
                {pageLabels[item]}
              </button>
            ))}
            <button
              aria-current={page === "Settings" ? "page" : undefined}
              aria-label="Settings"
              className={`settings-tab${page === "Settings" ? " active" : ""}`}
              onClick={() => selectPage("Settings")}
              title="Settings"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M6.8 1.8h2.4l.35 1.45c.32.12.62.3.9.52l1.42-.43 1.2 2.08-1.06 1c.03.2.04.4.04.61s-.01.41-.04.61l1.06 1-1.2 2.08-1.42-.43c-.28.22-.58.4-.9.52L9.2 12.2H6.8l-.35-1.39a4.5 4.5 0 0 1-.9-.52l-1.42.43-1.2-2.08 1.06-1a4.4 4.4 0 0 1 0-1.22l-1.06-1 1.2-2.08 1.42.43c.28-.22.58-.4.9-.52L6.8 1.8Z" />
                <circle cx="8" cy="7.03" r="1.55" />
              </svg>
            </button>
          </nav>
        ) : null}
      </header>

      <main className={liveActivityOpen
        ? "live-activity-main"
        : inferenceOnboardingComplete && page === "Chat"
          ? "chat-main"
          : inferenceOnboardingComplete && page === "Settings" ? "settings-main" : undefined}>
        {startupError ? <ErrorMessage>{startupError}</ErrorMessage> : null}
        {!state ? <LoadingState /> : (
          <>
            {liveActivityOpen ? (
              <LiveActivityPage state={state} />
            ) : !privacyAccepted ? (
              <PrivacyOnboarding onAccept={acceptPrivacyNotice} />
            ) : !inferenceOnboardingComplete ? (
              <InferenceOnboarding
                appleAvailability={state.inference.appleAvailability}
                setState={setState}
              />
            ) : page === "History" ? (
              <HistoryPage
                onAddApiKey={openApiKeySettings}
                state={state}
                setState={setState}
              />
            ) : page === "Chat" ? (
              <ChatPage onOpenSettings={() => selectPage("Settings")} state={state} />
            ) : null}
            {!liveActivityOpen && page === "Settings" ? (
              <SettingsPage
                apiKeyFocusRequest={apiKeyFocusRequest}
                state={state}
                setState={setState}
                updateSettings={updateSettings}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

const CHAT_STARTERS = [
  "Summarize my work yesterday",
  "What have I been doing most recently?",
  "What unfinished work do I have?",
  "What decisions did I make this week?"
] as const;

function ChatPage({
  state,
  onOpenSettings
}: {
  state: BootstrapState;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [turns, setTurns] = useState<HistoryChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const configured = state.inference.configured && state.inference.settings.provider !== "apple";

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (thread && stickToBottomRef.current) thread.scrollTop = thread.scrollHeight;
  }, [turns, sending]);

  async function send(content: string): Promise<void> {
    const message = content.trim();
    if (!message || sending || !configured) return;
    stickToBottomRef.current = true;
    const nextTurns: HistoryChatTurn[] = [...turns, { role: "user", content: message }];
    setTurns(nextTurns);
    setDraft("");
    setError(undefined);
    setSending(true);
    try {
      const response = await window.openHistory.historyChat(nextTurns);
      setTurns((current) => [...current, { role: "assistant", content: response.answer }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chat couldn't answer that right now.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`chat-page${turns.length > 0 ? " has-turns" : ""}`} aria-label="Chat">
      {turns.length > 0 ? (
        <div className="chat-session-actions">
          <button className="chat-clear" onClick={() => {
            stickToBottomRef.current = true;
            setTurns([]);
            setError(undefined);
          }} type="button">
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M3.2 6.2A5 5 0 1 1 3.8 11" />
              <path d="M3.2 2.9v3.3h3.3" />
            </svg>
            <span>Reset chat</span>
          </button>
        </div>
      ) : null}

      <div
        className="chat-thread"
        aria-live="polite"
        onScroll={(event) => {
          const thread = event.currentTarget;
          stickToBottomRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 24;
        }}
        ref={threadRef}
      >
        {turns.length === 0 ? (
          <div className="chat-welcome">
            <div className="chat-welcome-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20"><path d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z" /></svg>
            </div>
            <strong>Ask about what you’ve worked on</strong>
            <p>Chat can search sanitized history and inspect privacy-filtered recent activity from a requested time window. Requests go to your configured cloud model.</p>
            {configured ? (
              <div className="chat-starters">
                {CHAT_STARTERS.map((starter) => (
                  <button key={starter} onClick={() => void send(starter)} type="button">{starter}</button>
                ))}
              </div>
            ) : (
              <div className="chat-model-notice">
                <span>{state.inference.settings.provider === "apple"
                  ? "Chat currently needs a cloud model."
                  : "Set up a model to use Chat."}</span>
                <button onClick={onOpenSettings} type="button">Open Settings</button>
              </div>
            )}
          </div>
        ) : turns.map((turn, index) => (
          <div className={`chat-message ${turn.role}`} key={`${turn.role}-${index}`}>
            <span>{turn.role === "user" ? "You" : "OpenHistory"}</span>
            <p>{turn.content}</p>
          </div>
        ))}
        {sending ? (
          <div className="chat-message assistant is-thinking">
            <span>OpenHistory</span>
            <p><i /><i /><i /></p>
          </div>
        ) : null}
      </div>

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        <textarea
          aria-label="Message OpenHistory"
          autoFocus
          disabled={!configured || sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Ask about your history…"
          rows={1}
          value={draft}
        />
        <button aria-label="Send message" disabled={!draft.trim() || sending || !configured} type="submit">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3 8 9-5-2.5 10-2-3-4.5-2Z" /></svg>
        </button>
      </form>
    </section>
  );
}

function LiveActivityPage({ state }: { state: BootstrapState }): React.JSX.Element {
  const events = [...state.recentEvents].reverse();

  return (
    <section className="live-activity-page" aria-labelledby="live-activity-title">
      <div className="live-activity-heading">
        <div>
          <span className="eyebrow">Incoming activity</span>
          <h2 id="live-activity-title">Live activity</h2>
          <p>Events captured on this Mac appear here as they arrive.</p>
        </div>
        <span className={`live-activity-state ${collectorClass(state)}`}>
          <span aria-hidden="true" />
          {collectorStatusLabel(state)}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="live-activity-empty">
          <span className="live-activity-empty-pulse" aria-hidden="true" />
          <strong>Waiting for activity</strong>
          <span>New collector events will appear automatically.</span>
        </div>
      ) : (
        <div className="live-event-list" aria-live="polite" aria-relevant="additions">
          {events.map((event, index) => (
            <LiveActivityEvent event={event} isNewest={index === 0} key={event.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function LiveActivityEvent({
  event,
  isNewest
}: {
  event: ActivityEvent;
  isNewest: boolean;
}): React.JSX.Element {
  const application = event.application?.localizedName ?? event.application?.bundleIdentifier;
  const details = activityEventDetails(event);

  return (
    <article className={`live-event${isNewest ? " is-newest" : ""}`}>
      <time dateTime={event.timestamp}>{formatLiveEventTime(event.timestamp)}</time>
      <span className="live-event-marker" aria-hidden="true" />
      <div className="live-event-copy">
        <div className="live-event-title-row">
          <strong>{ACTIVITY_EVENT_LABELS[event.kind]}</strong>
          {application ? <span className="live-event-app">{application}</span> : null}
        </div>
        {details.length ? (
          <p className="live-event-details">
            {details.map((detail) => <span key={detail}>{detail}</span>)}
          </p>
        ) : null}
      </div>
    </article>
  );
}

const ACTIVITY_EVENT_LABELS: Record<ActivityEvent["kind"], string> = {
  collector_started: "Collector started",
  application_activated: "Application activated",
  window_changed: "Window changed",
  focused_element_changed: "Focus changed",
  selection_changed: "Selection changed",
  text_input: "Text edited",
  document_changed: "Document changed",
  pointer_click: "Pointer clicked",
  url_changed: "Page changed",
  document_context_changed: "Document context changed",
  ui_snapshot: "Interface observed",
  application_terminated: "Application closed",
  screen_slept: "Display slept",
  screen_woke: "Display woke",
  session_locked: "Session locked",
  session_unlocked: "Session unlocked",
  privacy_boundary: "Private activity excluded"
};

function activityEventDetails(event: ActivityEvent): string[] {
  const details: string[] = [];
  const elementDetails = semanticElementDetails(event.element);
  const windowContext = usefulWindowContext(event);

  if (event.kind === "text_input" || event.kind === "document_changed") {
    const change = textChangeDescription(event);
    if (change) details.push(change);
    details.push(...elementDetails);
    if (windowContext) details.push(windowContext);
    return uniqueDetails(details);
  }

  if (event.kind === "pointer_click") {
    details.push(...elementDetails);
    if (windowContext) details.push(windowContext);
    return uniqueDetails(details);
  }

  if (["focused_element_changed", "selection_changed"].includes(event.kind)) {
    details.push(...elementDetails);
    const selected = event.selectedElements?.[0];
    if (!elementDetails.length && selected) details.push(...semanticElementDetails(selected));
    if (windowContext) details.push(windowContext);
    return uniqueDetails(details);
  }

  if (event.browser) details.push(compactText(event.browser.title ?? event.browser.domain));
  if (event.document) details.push(compactText(event.document.displayPath || event.document.name));
  if (!details.length && windowContext) details.push(windowContext);

  const visibleText = event.visibleText?.[0];
  if (!details.length && visibleText) details.push(compactText(visibleText));
  if (event.kind === "collector_started") {
    details.push(event.accessibilityTrusted
      ? "Accessibility capture is available"
      : "Accessibility access is needed");
  }
  return uniqueDetails(details);
}

function textChangeDescription(event: ActivityEvent): string | undefined {
  if (!event.textChange) return undefined;
  const insertedCharacters = [...event.textChange.insertedText].length;
  const deletedCharacters = event.textChange.deletedCharacterCount;
  if (insertedCharacters && deletedCharacters) {
    return `${insertedCharacters} character${insertedCharacters === 1 ? "" : "s"} inserted, ${deletedCharacters} deleted`;
  }
  if (insertedCharacters) {
    return `${insertedCharacters} character${insertedCharacters === 1 ? "" : "s"} inserted`;
  }
  if (deletedCharacters) {
    return `${deletedCharacters} character${deletedCharacters === 1 ? "" : "s"} deleted`;
  }
  return undefined;
}

function semanticElementDetails(element: ActivityEvent["element"]): string[] {
  if (!element) return [];
  const label = element.label ?? element.title ?? element.identifier ?? element.value;
  const role = humanizeAccessibilityRole(element.role);
  return uniqueDetails([
    ...(label ? [compactText(label)] : []),
    ...(role ? [role] : [])
  ]);
}

function humanizeAccessibilityRole(role: string | undefined): string | undefined {
  if (!role) return undefined;
  const withoutPrefix = role.replace(/^AX/, "");
  const words = withoutPrefix.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (!words) return undefined;
  return `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}`;
}

function usefulWindowContext(event: ActivityEvent): string | undefined {
  if (!event.windowTitle) return undefined;
  const title = compactText(event.windowTitle);
  const application = event.application?.localizedName ?? event.application?.bundleIdentifier;
  return application && title.localeCompare(application, undefined, { sensitivity: "accent" }) === 0
    ? undefined
    : title;
}

function uniqueDetails(details: string[]): string[] {
  return [...new Set(details.filter(Boolean))];
}

function compactText(value: string): string {
  const normalized = redactURLQueryForDisplay(value.replace(/\s+/g, " ").trim());
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

function redactURLQueryForDisplay(value: string): string {
  if (!value.includes("?") || /\s/.test(value)) return value;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (!url.hostname || !url.search) return value;
    return `${hasScheme ? `${url.protocol}//` : ""}${url.host}${url.pathname}?[redacted]`;
  } catch {
    return value;
  }
}

function formatLiveEventTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

function collectorStatusLabel(state: BootstrapState): string {
  if (!state.collectionEnabled) return "Paused";
  if (state.collectorState === "starting") return "Starting";
  if (state.collectorState === "failed") return "Unavailable";
  return state.collectorState === "running" ? "Live" : "Paused";
}

const INFERENCE_ONBOARDING_COPY: Record<InferenceProvider, {
  badge: string;
  description: string;
  drawback: string;
  name: string;
}> = {
  apple: {
    badge: "Maximum privacy",
    description: "Activity evidence and generated summaries stay entirely on this Mac.",
    drawback: "Lower quality. Requires Apple Intelligence on a compatible Mac.",
    name: "Apple On-Device"
  },
  openai: {
    badge: "High quality",
    description: "Strongest overall summaries and interpretation of ambiguous work.",
    drawback: "Requires an API key. Selected activity evidence is sent to OpenAI.",
    name: "OpenAI"
  },
  anthropic: {
    badge: "High quality",
    description: "Strong writing and useful synthesis across longer work sessions.",
    drawback: "Requires an API key. Selected activity evidence is sent to Anthropic.",
    name: "Anthropic"
  },
  kimi: {
    badge: "Cloud alternative",
    description: "A capable alternative cloud provider with one streamlined model choice.",
    drawback: "Requires an API key. Selected activity evidence is sent to Moonshot AI.",
    name: "Kimi"
  }
};

function ProviderLogo({ provider }: { provider: InferenceProvider }): React.JSX.Element {
  if (provider === "apple") {
    return <svg viewBox="0 0 24 24"><path d="M11.932 6.908c.95 0 2.727-1.291 4.595-1.1.782.032 2.976.316 4.388 2.38-.113.069-2.622 1.528-2.593 4.565.034 3.617 3.166 4.828 3.221 4.85-.029.086-.506 1.723-1.658 3.416-1.002 1.463-2.039 2.919-3.675 2.95-1.606.03-2.125-.955-3.96-.955s-2.409.923-3.931.984c-1.581.06-2.78-1.58-3.79-3.037-2.065-2.98-3.64-8.422-1.527-12.087 1.051-1.824 2.93-2.98 4.969-3.009 1.549-.032 3.011 1.043 3.96 1.043zM16.552 0c.153 1.407-.411 2.817-1.251 3.833-.837 1.013-2.214 1.804-3.555 1.7-.185-1.378.495-2.814 1.27-3.712C13.883.805 15.346.05 16.553 0z" /></svg>;
  }
  if (provider === "openai") {
    return <svg viewBox="0 0 24 24"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" /></svg>;
  }
  if (provider === "anthropic") {
    return <svg viewBox="0 0 24 24"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" /></svg>;
  }
  return <svg viewBox="0 0 24 24"><path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0zM11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z" /></svg>;
}

function BadgeIcon({ kind }: { kind: "experimental" | "recommended" }): React.JSX.Element {
  return kind === "recommended"
    ? <svg viewBox="0 0 16 16"><path d="m8 1.8 1.75 3.55 3.92.57-2.84 2.77.67 3.91L8 10.76 4.5 12.6l.67-3.91-2.84-2.77 3.92-.57L8 1.8Z" /></svg>
    : <svg viewBox="0 0 16 16"><path d="M6 2h4M7 2v3l-3.7 6.1A1.3 1.3 0 0 0 4.4 13h7.2a1.3 1.3 0 0 0 1.1-1.9L9 5V2M5.2 9h5.6" /></svg>;
}

function InferenceOnboarding({
  appleAvailability,
  setState
}: {
  appleAvailability: AppleInferenceAvailability;
  setState: SetAppState;
}): React.JSX.Element {
  const [provider, setProvider] = useState<InferenceProvider>();
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState<"model" | "capture">("model");
  const [saving, setSaving] = useState(false);
  const [checkingAppleAvailability, setCheckingAppleAvailability] = useState(false);
  const [error, setError] = useState<string>();
  const cloudProvider = provider && isCloudInferenceProvider(provider) ? provider : undefined;
  const appleUnavailable = provider === "apple" && !appleAvailability.available;

  function chooseProvider(next: InferenceProvider): void {
    setProvider(next);
    setModel(DEFAULT_INFERENCE_MODELS[next]);
    setApiKey("");
    setError(undefined);
  }

  function dismissProviderSelection(): void {
    setProvider(undefined);
    setModel("");
    setApiKey("");
    setError(undefined);
  }

  function continueSetup(): void {
    if (!provider || !model || appleUnavailable || (cloudProvider && !apiKey.trim())) return;
    setError(undefined);
    setStep("capture");
  }

  async function refreshAppleAvailability(): Promise<void> {
    setCheckingAppleAvailability(true);
    setError(undefined);
    try {
      setState(await window.openHistory.refreshAppleAvailability());
    } catch {
      setError("OpenHistory could not check Apple Intelligence. Try again.");
    } finally {
      setCheckingAppleAvailability(false);
    }
  }

  async function completeSetup(
    captureEmailActivity: boolean,
    captureMessagingActivity: boolean
  ): Promise<void> {
    if (!provider || !model || appleUnavailable || (cloudProvider && !apiKey.trim())) return;
    setSaving(true);
    setError(undefined);
    try {
      setState(await window.openHistory.completeInferenceOnboarding({
        provider,
        model,
        captureEmailActivity,
        captureMessagingActivity,
        ...(cloudProvider ? { apiKey } : {})
      }));
    } catch {
      setError("OpenHistory could not finish model setup. Check the selection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (step === "capture" && provider) {
    return (
      <CapturePreferencesOnboarding
        error={error}
        onBack={() => {
          setError(undefined);
          setStep("model");
        }}
        onComplete={completeSetup}
        provider={provider}
        saving={saving}
      />
    );
  }

  return (
    <section className="model-onboarding" aria-labelledby="model-onboarding-title">
      <div className="model-onboarding-heading">
        <h2 id="model-onboarding-title">Choose how your timeline is written.</h2>
        <p>OpenHistory needs a model to turn captured activity into readable history, hour summaries, and daily summaries. You can change this later in Settings.</p>
      </div>

      <div className="provider-choice-list" role="radiogroup" aria-label="Summary provider">
        {INFERENCE_PROVIDERS.map((candidate) => {
          const copy = INFERENCE_ONBOARDING_COPY[candidate];
          const selected = provider === candidate;
          return (
            <button
              aria-checked={selected}
              className={`provider-choice-card${selected ? " selected" : ""}`}
              key={candidate}
              onClick={() => chooseProvider(candidate)}
              role="radio"
              type="button"
            >
              <span className={`provider-choice-logo ${candidate}`} aria-hidden="true">
                <ProviderLogo provider={candidate} />
              </span>
              <span className="provider-choice-content">
                <span className="provider-choice-topline">
                  <strong>{copy.name}</strong>
                  <span className="provider-choice-badges">
                    <span className={`provider-choice-badge ${candidate === "apple" ? "private" : "cloud"}`}>{copy.badge}</span>
                    {candidate === "apple" ? (
                      <span className="provider-choice-badge experimental"><BadgeIcon kind="experimental" />Experimental</span>
                    ) : candidate === "openai" ? (
                      <span className="provider-choice-badge recommended"><BadgeIcon kind="recommended" />Recommended</span>
                    ) : null}
                  </span>
                </span>
                <span className="provider-choice-description">{copy.description}</span>
                <span className="provider-choice-drawback">{copy.drawback}</span>
              </span>
            </button>
          );
        })}
      </div>

      {provider ? (
        <div className="model-config-backdrop" onClick={dismissProviderSelection} role="presentation">
          <div
            aria-labelledby="model-sheet-title"
            aria-modal="true"
            className="model-onboarding-config model-onboarding-sheet card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
          <span className="model-sheet-handle" aria-hidden="true" />
          <div className="model-choice-heading">
            <strong id="model-sheet-title">Choose a model</strong>
            <span>{INFERENCE_ONBOARDING_COPY[provider].name}</span>
          </div>
          <div className="model-choice-list" role="radiogroup" aria-label={`${INFERENCE_ONBOARDING_COPY[provider].name} model`}>
            {INFERENCE_MODEL_OPTIONS[provider].map((option) => (
              <label className={`model-choice-row${model === option.id ? " selected" : ""}`} key={option.id}>
                <input
                  checked={model === option.id}
                  name="onboarding-model"
                  onChange={() => setModel(option.id)}
                  type="radio"
                  value={option.id}
                />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </label>
            ))}
          </div>

          {cloudProvider ? (
            <>
              {cloudProvider === "kimi" ? (
                <div className="onboarding-jurisdiction-warning" role="note">
                  <strong>Kimi data jurisdiction</strong>
                  <p>Moonshot AI is a Chinese company operating under Chinese law. By selecting Kimi, you understand that Moonshot AI data is subject to national intelligence and cybersecurity state oversight.</p>
                </div>
              ) : null}
              <label className="onboarding-key-field">
                <span>{INFERENCE_PROVIDER_LABELS[cloudProvider]} API key</span>
                <input
                  aria-label={`${INFERENCE_PROVIDER_LABELS[cloudProvider]} API key`}
                  autoComplete="new-password"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Enter API key"
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="onboarding-cloud-disclosure">
                <strong>External processing</strong>
                <p>About every 10 minutes, OpenHistory will send evidence from completed work sessions directly to {INFERENCE_PROVIDER_LABELS[cloudProvider]}. This can include app names, window titles, URLs or domains, document context, visible interface text, and text changes according to your capture settings. Raw event files remain local.</p>
              </div>
            </>
          ) : (
            <div className={`onboarding-local-disclosure${appleUnavailable ? " unavailable" : ""}`}>
              {appleUnavailable ? (
                <AppleAvailabilityDetails
                  availability={appleAvailability}
                  checking={checkingAppleAvailability}
                  onCheckAgain={refreshAppleAvailability}
                />
              ) : (
                <>
                  <strong>Private, but experimental & low quality</strong>
                  <p>No key is needed and no evidence leaves this Mac. Summary quality is currently lower and availability depends on this Mac’s Apple Intelligence support.</p>
                </>
              )}
            </div>
          )}

          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          <button
            className="primary-button model-onboarding-continue"
            disabled={saving || !model || appleUnavailable || Boolean(cloudProvider && !apiKey.trim())}
            onClick={continueSetup}
            type="button"
          >
            {cloudProvider
              ? `Allow ${INFERENCE_PROVIDER_LABELS[cloudProvider]} and continue`
              : "Continue"}
          </button>
          {cloudProvider ? <p className="onboarding-key-note">Your key is encrypted on this Mac and is never shown again.</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AppleAvailabilityDetails({
  availability,
  checking,
  onCheckAgain
}: {
  availability: AppleInferenceAvailability;
  checking: boolean;
  onCheckAgain: () => void | Promise<void>;
}): React.JSX.Element {
  const guidance = appleInferenceAvailabilityGuidance(availability);
  return (
    <>
      <strong>{guidance.title}</strong>
      <p>{guidance.description}</p>
      <div className="apple-availability-actions">
        {guidance.helpUrl ? (
          <a href={guidance.helpUrl} rel="noreferrer" target="_blank">{guidance.helpLabel}</a>
        ) : null}
        <button disabled={checking} onClick={() => void onCheckAgain()} type="button">
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </>
  );
}

function CapturePreferencesOnboarding({
  error,
  onBack,
  onComplete,
  provider,
  saving
}: {
  error?: string;
  onBack: () => void;
  onComplete: (captureEmailActivity: boolean, captureMessagingActivity: boolean) => Promise<void>;
  provider: InferenceProvider;
  saving: boolean;
}): React.JSX.Element {
  const [captureEmailActivity, setCaptureEmailActivity] = useState(true);
  const [captureMessagingActivity, setCaptureMessagingActivity] = useState(true);
  const cloudProvider = isCloudInferenceProvider(provider) ? provider : undefined;
  const hasSelection = captureEmailActivity || captureMessagingActivity;

  return (
    <section className="model-onboarding capture-onboarding" aria-labelledby="capture-onboarding-title">
      <button className="onboarding-back-button" disabled={saving} onClick={onBack} type="button">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m9.75 3.25-4.5 4.75 4.5 4.75" /></svg>
        Back to model
      </button>
      <div className="model-onboarding-heading">
        <span className="eyebrow">Optional capture</span>
        <h2 id="capture-onboarding-title">Capture more of your work?</h2>
        <p>Email and conversations often contain useful decisions and follow-ups. Both categories are selected by default; turn off either one to keep it excluded.</p>
      </div>

      <div className="capture-onboarding-card card">
        <div className="capture-onboarding-options">
          <label className={`capture-onboarding-option${captureEmailActivity ? " selected" : ""}`}>
            <span>
              <strong>Email activity</strong>
              <small>Include recognized mail apps and webmail. Email addresses may be captured instead of automatically redacted.</small>
            </span>
            <input
              checked={captureEmailActivity}
              onChange={(event) => setCaptureEmailActivity(event.target.checked)}
              type="checkbox"
            />
          </label>
          <label className={`capture-onboarding-option${captureMessagingActivity ? " selected" : ""}`}>
            <span>
              <strong>Messages and chat activity</strong>
              <small>Include Messages and iMessage, recognized chat apps and websites, and direct-message routes.</small>
            </span>
            <input
              checked={captureMessagingActivity}
              onChange={(event) => setCaptureMessagingActivity(event.target.checked)}
              type="checkbox"
            />
          </label>
        </div>

        {cloudProvider ? (
          <div className="onboarding-cloud-disclosure">
            <strong>{`What ${INFERENCE_PROVIDER_LABELS[cloudProvider]} receives`}</strong>
            <p>{`When enabled activity is selected for a summary, its evidence may be sent directly to ${INFERENCE_PROVIDER_LABELS[cloudProvider]}. Raw event files remain local.`}</p>
          </div>
        ) : null}

        <p className="capture-onboarding-protection">Password fields, private browser windows, recognized adult websites, notifications, and password apps remain excluded.</p>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <div className="capture-onboarding-actions">
          <button
            className="secondary-button"
            disabled={saving}
            onClick={() => void onComplete(false, false)}
            type="button"
          >
            {saving ? "Finishing setup…" : "Keep excluded"}
          </button>
          <button
            className="primary-button"
            disabled={saving || !hasSelection}
            onClick={() => void onComplete(captureEmailActivity, captureMessagingActivity)}
            type="button"
          >
            {saving ? "Finishing setup…" : "Include selected"}
          </button>
        </div>
        <p className="onboarding-key-note capture-onboarding-note">You can change either category later in Settings.</p>
      </div>
    </section>
  );
}

function CapturePill({
  disabled,
  onToggle,
  state
}: {
  disabled?: boolean;
  onToggle: () => Promise<void>;
  state: BootstrapState;
}): React.JSX.Element {
  return (
    <button
      aria-label={state.collectionEnabled ? "Pause activity capture" : "Resume activity capture"}
      className={`capture-pill ${collectorClass(state)}`}
      disabled={disabled}
      onClick={onToggle}
      title={state.collectionEnabled ? "Pause capture" : "Resume capture"}
    >
      <span className="capture-pill-label">
        <span className="capture-pill-status" aria-hidden="true" />
        <span className="capture-pill-text" aria-hidden="true">
          <span className="capture-pill-text-on">On</span>
          <span className="capture-pill-text-off">Off</span>
        </span>
      </span>
      <span className="capture-pill-icon" aria-hidden="true">
        <svg className="capture-pill-pause-icon" viewBox="0 0 16 16"><path d="M4 3h3v10H4zm5 0h3v10H9z" /></svg>
        <svg className="capture-pill-play-icon" viewBox="0 0 16 16"><path d="M4 2.5v11L13 8z" /></svg>
      </span>
    </button>
  );
}

function PrivacyOnboarding({ onAccept }: { onAccept: () => Promise<void> }): React.JSX.Element {
  const [accepting, setAccepting] = useState(false);
  return (
    <section className="privacy-onboarding card" aria-labelledby="privacy-onboarding-title">
      <div className="privacy-onboarding-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
      </div>
      <div>
        <span className="eyebrow">Before capture begins</span>
        <h2 id="privacy-onboarding-title">Your work history stays under your control.</h2>
        <p>OpenHistory observes the apps, clicks, and text changes you permit.<br />It never takes screenshots or tracks your camera or microphone.</p>
      </div>
      <ul>
        <li><strong>Stored locally.</strong> Raw activity and generated history live in OpenHistory’s private data directory on this Mac.</li>
        <li><strong>On-device is distinct from cloud.</strong> Apple’s experimental model stays on this Mac. OpenAI, Anthropic, and Kimi receive selected activity evidence only after a separate confirmation.</li>
        <li><strong>Visible and reversible.</strong> Pause capture in the header, exclude apps in Settings, inspect the data folder, or permanently delete all local data.</li>
      </ul>
      <button
        className="primary-button privacy-accept-button"
        disabled={accepting}
        onClick={() => {
          setAccepting(true);
          void onAccept().finally(() => setAccepting(false));
        }}
      >
        {accepting ? "Continuing…" : "Allow and continue"}
      </button>
      <p className="privacy-fine-print">You can change every capture category in Settings at any time.</p>
    </section>
  );
}

function HistoryPage({
  onAddApiKey,
  state,
  setState
}: {
  onAddApiKey: () => void;
  state: BootstrapState;
  setState: SetAppState;
}): React.JSX.Element {
  const [dayOverrides, setDayOverrides] = useState<Record<string, boolean>>({});
  const [hourOverrides, setHourOverrides] = useState<Record<string, boolean>>({});
  const days = useMemo(
    () => buildDayGroups(state.timeline.items, state.hour.items, state.dailyRollup.items),
    [state.timeline.items, state.hour.items, state.dailyRollup.items]
  );
  const today = localDateKey(new Date());
  const updating = state.timeline.summarizing || state.hour.consolidating || state.dailyRollup.consolidating;
  const updateError = state.timeline.lastError ?? state.hour.lastError ?? state.dailyRollup.lastError;
  const appleGuidance = appleInferenceAvailabilityGuidance(state.inference.appleAvailability);

  async function buildHistory(): Promise<void> {
    setState(await window.openHistory.buildHistory());
  }

  function setDayExpanded(date: string, expanded: boolean): void {
    updateExpansionWithAnchor(`day-${date}`, () => {
      setDayOverrides((current) => ({ ...current, [date]: expanded }));
    });
  }

  function setHourExpanded(id: string, expanded: boolean): void {
    updateExpansionWithAnchor(`hour-${id}`, () => {
      setHourOverrides((current) => ({ ...current, [id]: expanded }));
    });
  }

  return (
    <section className="page-stack history-page">
      {state.inference.settings.enabled && !state.inference.configured ? (
        <div className="api-key-callout">
          <span className="api-key-callout-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="8" cy="12" r="4" />
              <path d="M12 12h9m-3 0v3m-3-3v3" />
            </svg>
          </span>
          <span className="api-key-callout-copy">
            <strong>{state.inference.settings.provider === "apple"
              ? appleGuidance.title
              : "Automatic timeline updates need an API key"}</strong>
            <span>{state.inference.settings.provider === "apple"
              ? appleGuidance.description
              : `Add a key for ${INFERENCE_PROVIDER_LABELS[state.inference.settings.provider]} in Settings.`}</span>
          </span>
          <button className="api-key-callout-action" onClick={onAddApiKey} type="button">
            {state.inference.settings.provider === "apple" ? "Review" : "Add now"} <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
      {updateError ? (
        <div className="history-error-row">
          <ErrorMessage>{updateError}</ErrorMessage>
          {state.inference.configured ? (
            <button className="secondary-button" onClick={buildHistory} disabled={updating}>
              {updating ? "Retrying…" : "Retry update"}
            </button>
          ) : null}
        </div>
      ) : null}

      {days.length === 0 ? (
        <EmptyState title="No timeline yet">
          {state.inference.settings.enabled
            ? "Use your Mac for a few minutes. History updates automatically."
            : "Activity remains local. Turn on automatic summaries in Settings to build the timeline."}
        </EmptyState>
      ) : (
        <div className="timeline-list rollup-list">
          {days.map((day, index) => {
            const expanded = dayOverrides[day.date] ?? day.date === today;
            return (
              <DayTimelineNode
                day={day}
                expanded={expanded}
                hasFollowingDay={index < days.length - 1}
                hourOverrides={hourOverrides}
                key={day.date}
                onHourExpanded={setHourExpanded}
                onToggle={() => setDayExpanded(day.date, !expanded)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

interface HourGroup {
  id: string;
  startTime: string;
  endTime: string;
  items: TimelineItem[];
  rollup?: HourItem;
}

interface DayGroup {
  date: string;
  items: TimelineItem[];
  hours: HourGroup[];
  dailyRollup?: DailyRollupItem;
}

function DayTimelineNode({
  day,
  expanded,
  hasFollowingDay,
  hourOverrides,
  onHourExpanded,
  onToggle
}: {
  day: DayGroup;
  expanded: boolean;
  hasFollowingDay: boolean;
  hourOverrides: Record<string, boolean>;
  onHourExpanded: (id: string, expanded: boolean) => void;
  onToggle: () => void;
}): React.JSX.Element {
  const dailyRollup = day.dailyRollup;
  return (
    <section className={`day-timeline-node ${expanded ? "is-expanded" : "is-collapsed"}`} id={`day-${day.date}`}>
      <div className="timeline-entry timeline-rail-segment day-toggle-entry">
        <div className="timeline-summary day-toggle">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${formatDayHeading(day.date)}`}
            className="timeline-toggle-hit-area"
            onClick={onToggle}
            type="button"
          />
          <span className={`timeline-day-caret ${expanded ? "is-expanded" : ""}`} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
          </span>
          <div className="timeline-summary-content">
            <span className="day-heading">
              <strong>{formatDayHeading(day.date)}</strong>
              <time>{formatDaySubheading(day.date)}</time>
            </span>
            {!expanded ? (
              <span className="day-summary-copy">
                <span className="day-summary-title">{dailyRollup?.title ?? `${formatDayHeading(day.date)}’s activity`}</span>
                <SummaryBulletList
                  className="day-summary-description"
                  links={dailyRollup?.links}
                  summary={dailyRollup?.summary ?? `Activity from ${day.hours.length} clock ${day.hours.length === 1 ? "hour" : "hours"}.`}
                />
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {expanded ? (
        <TimelineBranch className="day-children" returnsToParent={hasFollowingDay}>
          {day.hours.map((hour) => {
            const hourExpanded = hourOverrides[hour.id] ?? !hour.rollup;
            return hour.rollup ? (
              <HourTimelineNode
                expanded={hourExpanded}
                hour={hour}
                key={hour.id}
                onToggle={() => onHourExpanded(hour.id, !hourExpanded)}
              />
            ) : (
              <div className="timeline-list hour-history unrolled-hour-group" key={hour.id}>
                {hour.items.map((item) => <TimelineCard item={item} key={item.id} />)}
              </div>
            );
          })}
        </TimelineBranch>
      ) : null}
    </section>
  );
}

function HourTimelineNode({
  expanded,
  hour,
  onToggle
}: {
  expanded: boolean;
  hour: HourGroup;
  onToggle: () => void;
}): React.JSX.Element {
  const rollup = hour.rollup!;
  return (
    <section className={`hour-timeline-node ${expanded ? "is-expanded" : "is-collapsed"}`} id={`hour-${hour.id}`}>
      <article className="timeline-entry timeline-rail-segment rollup-entry hour-rollup">
        <div className="timeline-summary rollup-summary hour-toggle">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${rollup.title}`}
            className="timeline-toggle-hit-area"
            onClick={onToggle}
            type="button"
          />
          <div className="timeline-summary-content">
            <span className="card-meta"><time>{formatHourRange(hour.startTime, hour.endTime)}</time></span>
            <h2>
              <span className="timeline-marker-label" aria-hidden="true">{formatHourMarker(hour.startTime)}</span>
              {rollup.title}
            </h2>
            {!expanded ? (
              <span className="hour-summary-copy">
                <SummaryBulletList className="rollup-summary-bullets" links={rollup.links} summary={rollup.summary} />
                {rollup.applications.length ? (
                  <span className="pill-row rollup-apps">
                    {rollup.applications.slice(0, 3).map((application) => (
                      <ApplicationBadge application={application} key={application.bundleIdentifier ?? application.name} />
                    ))}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </article>
      {expanded ? (
        <TimelineBranch className="hour-history hour-children" returnsToParent>
          {hour.items.map((item) => <TimelineCard item={item} key={item.id} />)}
        </TimelineBranch>
      ) : null}
    </section>
  );
}

function TimelineBranch({
  children,
  className,
  returnsToParent
}: {
  children: React.ReactNode;
  className: string;
  returnsToParent: boolean;
}): React.JSX.Element {
  return (
    <div className={`timeline-branch ${className}`}>
      <TimelineBend />
      <div className="timeline-list timeline-branch-children">{children}</div>
      {returnsToParent ? <TimelineBend returning /> : null}
    </div>
  );
}

function TimelineBend({ returning = false }: { returning?: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={`timeline-bend ${returning ? "is-returning" : ""}`}
      preserveAspectRatio="none"
      viewBox="0 0 24 48"
    >
      <path d={returning ? "M24 0C24 29 0 19 0 48" : "M0 0C0 29 24 19 24 48"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SummaryBulletList({
  className,
  links,
  summary
}: {
  className: string;
  links?: HistoryLink[];
  summary: string;
}): React.JSX.Element {
  return (
    <span className={`summary-bullets ${className}`} role="list">
      {summaryToBullets(summary).map((bullet, index) => (
        <span className="summary-bullet" key={`${index}-${bullet}`} role="listitem">
          <span className="summary-bullet-copy">
            {linkifyHistoryText(bullet, links).map((segment, segmentIndex) => "url" in segment ? (
              <a
                className="history-inline-link"
                href={segment.url}
                key={`${segmentIndex}-${segment.url}`}
                rel="noreferrer"
                target="_blank"
              >
                {segment.text}
              </a>
            ) : <span key={`${segmentIndex}-${segment.text}`}>{segment.text}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

function summaryToBullets(summary: string): string[] {
  const trimmed = summary.trim();
  if (!trimmed) return [];
  const bulletPrefix = /^\s*(?:[-*•]|\d+[.)])\s+/;
  const lines = trimmed
    .split(/\r?\n+/)
    .map((line) => line.replace(bulletPrefix, "").trim())
    .filter(Boolean);
  if (lines.length > 1 || bulletPrefix.test(trimmed)) return lines;
  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function TimelineCard({ item }: { item: TimelineItem }): React.JSX.Element {
  const sections = [
    ["Workstreams", item.workThreads],
    ["Decisions", item.decisions],
    ["Outcomes", item.outcomes],
    ["Blockers", item.blockers],
    ["Surfaces", item.surfaces]
  ] as const;
  const populatedSections = sections.filter(([, entries]) => entries.length > 0);

  return (
    <details className="timeline-entry timeline-rail-segment timeline-history-card">
      <summary className="timeline-summary">
        <span className="timeline-dot" aria-hidden="true" />
        <div className="card-meta">
          <time>{formatTime(item.startTime)}–{formatTime(item.endTime)}</time>
          <div className="pill-row">
            {item.applications.slice(0, 3).map((application) => (
              <ApplicationBadge application={application} iconOnly key={application.bundleIdentifier ?? application.name} />
            ))}
          </div>
        </div>
        <h2>{item.title}</h2>
        <p>
          <span className="timeline-description-collapsed">{truncateDescription(item.description)}</span>
          <span className="timeline-description-expanded">{item.description}</span>
        </p>
      </summary>
      {populatedSections.length || item.suggestion ? (
        <div className="card-details">
          <div className="detail-grid">
            {populatedSections.map(([label, entries]) => (
              <div key={label}>
                <strong>{label}</strong>
                <ul>{entries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </div>
            ))}
          </div>
          {item.suggestion ? (
            <div className="suggestion">
              <strong>{item.suggestion.name}</strong>
              <span>{item.suggestion.description}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function useApplicationIcon(application: TimelineApplication): string | undefined {
  const [icon, setIcon] = useState<string>();
  useEffect(() => {
    let active = true;
    setIcon(undefined);
    void window.openHistory.getApplicationIcon(application).then((value) => {
      if (active && value) setIcon(value);
    });
    return () => { active = false; };
  }, [application.bundleIdentifier, application.name]);
  return icon;
}

function ApplicationBadge({ application, iconOnly = false }: { application: TimelineApplication; iconOnly?: boolean }): React.JSX.Element {
  const icon = useApplicationIcon(application);
  const displayName = applicationDisplayName(application.name);

  return (
    <span
      aria-label={iconOnly ? displayName : undefined}
      className={`timeline-app-badge ${iconOnly ? "is-icon-only" : ""}`}
      title={iconOnly ? displayName : displayName === application.name ? undefined : application.name}
    >
      {icon ? (
        <img alt="" aria-hidden="true" src={icon} />
      ) : (
        <span className="timeline-app-fallback" aria-hidden="true">{initials(displayName).slice(0, 1)}</span>
      )}
      {iconOnly ? null : displayName}
    </span>
  );
}

function SettingsApplicationIcon({ application }: { application: TimelineApplication }): React.JSX.Element {
  const icon = useApplicationIcon(application);
  return icon ? (
    <img alt="" aria-hidden="true" className="app-icon" src={icon} />
  ) : (
    <span aria-hidden="true" className="app-icon fallback">{initials(application.name)}</span>
  );
}

function truncateDescription(description: string): string {
  if (description.length <= 116) return description;
  return `${description.slice(0, 116).trimEnd()}…`;
}

function AgentSettings({ state, setState }: { state: BootstrapState; setState: SetAppState }): React.JSX.Element {
  const [message, setMessage] = useState<string>();
  const activeConnections = state.agentAccess.connections.filter((connection) => !connection.revokedAt);

  async function copySetup(): Promise<void> {
    try {
      const agentAccess = await window.openHistory.copyAgentSetup();
      setState((current) => current ? { ...current, agentAccess } : current);
      setMessage("Prompt copied. Initial MCP configuration takes about 2 minutes.");
    } catch {
      setMessage("Could not create a connection prompt");
    }
  }

  async function revoke(id: string): Promise<void> {
    const agentAccess = await window.openHistory.revokeAgentConnection(id);
    setState((current) => current ? { ...current, agentAccess } : current);
  }

  const running = state.agentAccess.status === "running";
  return (
    <div className="card mcp-settings">
      <div className="agent-connect">
        <div>
          <div className="status-line">
            <span className={`status-light ${state.agentAccess.status}`} />
            {running ? "Local MCP is ready" : "Local MCP is unavailable"}
          </div>
          <p>Give a local agent read-only access to your timeline.</p>
          {state.agentAccess.endpoint ? <code>{state.agentAccess.endpoint}</code> : null}
        </div>
        <button className="primary-button" disabled={!running} onClick={copySetup}>Copy prompt</button>
      </div>

      {message ? <Notice>{message}</Notice> : null}
      {state.agentAccess.lastError ? <ErrorMessage>{state.agentAccess.lastError}</ErrorMessage> : null}

      <div className="mcp-connections">
        <div className="section-heading compact">
          <div>
            <h2>Connections</h2>
            <p>
              {state.agentAccess.projection.timelineCount} timeline entries · {state.agentAccess.projection.dailyRollupCount} daily rollups
            </p>
          </div>
          <span className="quiet-status">{activeConnections.length} active</span>
        </div>
        {activeConnections.length === 0 ? (
          <EmptyState title="No agents connected">Copy the prompt into a local coding agent.</EmptyState>
        ) : (
          <div className="connection-list">
            {activeConnections.map((connection) => (
              <div className="connection-row" key={connection.id}>
                <strong className="connection-name">{connection.clientName ?? connection.name}</strong>
                <span className="connection-activity">
                  <span
                    aria-describedby={`connection-tooltip-${connection.id}`}
                    className="connection-activity-badge"
                    tabIndex={0}
                  >
                    <span aria-hidden="true" className="connection-activity-dot" />
                    {connection.accessCount === 0 ? "Connected" : "Active"}
                  </span>
                  <span className="connection-tooltip" id={`connection-tooltip-${connection.id}`} role="tooltip">
                    <span>{connection.accessCount} request{connection.accessCount === 1 ? "" : "s"}</span>
                    <span>Last active {connection.lastUsedAt ? formatTimestamp(connection.lastUsedAt) : "never"}</span>
                  </span>
                </span>
                <button className="danger-button connection-revoke" onClick={() => revoke(connection.id)}>Revoke</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionsPage({
  state,
  setState,
  updateSettings
}: {
  state: BootstrapState;
  setState: SetAppState;
  updateSettings: (settings: CollectionSettings) => Promise<void>;
}): React.JSX.Element {
  const [installedApplications, setInstalledApplications] = useState<TimelineApplication[]>([]);
  const [showAllApplications, setShowAllApplications] = useState(false);
  const [applicationSearch, setApplicationSearch] = useState("");

  useEffect(() => {
    let active = true;
    void window.openHistory.listInstalledApplications().then((values) => {
      if (active) setInstalledApplications(values);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const applications = useMemo(() => {
    const values = new Map<string, TimelineApplication>();
    for (const event of [...state.recentEvents].reverse()) {
      const bundleIdentifier = event.application?.bundleIdentifier;
      if (bundleIdentifier && !values.has(bundleIdentifier)) {
        values.set(bundleIdentifier, {
          bundleIdentifier,
          name: event.application?.localizedName ?? bundleIdentifier
        });
      }
    }
    const installedByIdentifier = new Map(installedApplications.map(
      (application) => [application.bundleIdentifier, application]
    ));
    for (const bundleIdentifier of state.settings.excludedBundleIdentifiers) {
      const installed = installedByIdentifier.get(bundleIdentifier);
      if (!values.has(bundleIdentifier) && installed) values.set(bundleIdentifier, installed);
    }
    for (const application of installedApplications) {
      const bundleIdentifier = application.bundleIdentifier;
      if (!bundleIdentifier) continue;
      const existing = values.get(bundleIdentifier);
      if (!existing || existing.name === bundleIdentifier) values.set(bundleIdentifier, application);
    }
    return [...values.values()];
  }, [installedApplications, state.recentEvents, state.settings.excludedBundleIdentifiers]);
  const normalizedApplicationSearch = applicationSearch.trim().toLocaleLowerCase();
  const filteredApplications = normalizedApplicationSearch
    ? applications.filter((application) => application.name.toLocaleLowerCase().includes(normalizedApplicationSearch))
    : applications;
  const visibleApplications = normalizedApplicationSearch || showAllApplications
    ? filteredApplications
    : filteredApplications.slice(0, APPLICATION_PREVIEW_LIMIT);

  async function requestAccessibility(): Promise<void> {
    setState(await window.openHistory.requestAccessibilityPermission());
  }

  async function toggleExclusion(bundleIdentifier: string): Promise<void> {
    const excluded = new Set(state.settings.excludedBundleIdentifiers);
    excluded.has(bundleIdentifier) ? excluded.delete(bundleIdentifier) : excluded.add(bundleIdentifier);
    await updateSettings({ ...state.settings, excludedBundleIdentifiers: [...excluded] });
  }

  const captureSettings = [
    ["Window titles", "captureWindowTitles"],
    ["Focused controls", "captureFocusedElements"],
    ["Text edits", "captureTextInput"],
    ["Click targets", "capturePointerClicks"],
    ["Browser URLs", "captureBrowserURLs"],
    ["Documents and folders", "captureDocumentContext"],
    ["Visible interface text", "captureUISnapshots"],
    ["Email activity", "captureEmailActivity"],
    ["Messages and chat activity", "captureMessagingActivity"]
  ] as const;

  return (
    <section className="page-stack">
      <div className="card application-permissions">
        <div className="application-permissions-heading">
          <div>
            <strong>App permissions</strong>
            <span>Turn off an app to exclude it from capture and summaries.</span>
          </div>
          <small>{state.settings.excludedBundleIdentifiers.length} excluded</small>
        </div>
        <div className="application-list">
          <label className="application-search">
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              aria-label="Search app permissions"
              onChange={(event) => setApplicationSearch(event.target.value)}
              placeholder="Search apps"
              type="search"
              value={applicationSearch}
            />
          </label>
          {applications.length === 0 ? (
            <p className="muted">Installed applications will appear here.</p>
          ) : filteredApplications.length === 0 ? (
            <p className="application-search-empty">No apps match “{applicationSearch.trim()}”.</p>
          ) : visibleApplications.map((application) => {
            const bundleIdentifier = application.bundleIdentifier!;
            const excluded = state.settings.excludedBundleIdentifiers.includes(bundleIdentifier);
            return (
              <div className={`application-row${excluded ? " is-excluded" : ""}`} key={bundleIdentifier}>
                <SettingsApplicationIcon application={application} />
                <strong className="grow">{application.name}</strong>
                <button
                  aria-checked={!excluded}
                  aria-label={`${application.name} activity access`}
                  className="application-toggle"
                  onClick={() => toggleExclusion(bundleIdentifier)}
                  role="switch"
                  type="button"
                />
              </div>
            );
          })}
          {!normalizedApplicationSearch && applications.length > APPLICATION_PREVIEW_LIMIT ? (
            <button
              className="application-show-more"
              onClick={() => setShowAllApplications((current) => !current)}
              type="button"
            >
              {showAllApplications ? "Show less" : `Show more (${applications.length - APPLICATION_PREVIEW_LIMIT})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="card permission-row">
        <div className="grow">
          <div className="status-line">
            <span className={`status-light ${state.accessibilityTrusted ? "running" : "failed"}`} />
            Accessibility {state.accessibilityTrusted ? "enabled" : "needed"}
          </div>
          <p>
            {state.accessibilityTrusted
              ? "Rich activity capture is active."
              : "Required for controls, text edits, URLs, and document context."}
          </p>
        </div>
        {!state.accessibilityTrusted ? (
          <button className="primary-button" onClick={requestAccessibility}>Grant access</button>
        ) : null}
      </div>

      <details className="settings-group card">
        <summary><span>Capture details</span><small>9 settings</small></summary>
        <div className="settings-body">
          {captureSettings.map(([label, key]) => (
            <label className="switch-row" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={state.settings[key]}
                onChange={(event) => updateSettings({ ...state.settings, [key]: event.target.checked })}
              />
            </label>
          ))}
          <p className="protected-note">
            {state.settings.captureEmailActivity
              ? "Email apps and webmail can be included. "
              : "Email apps and webmail are excluded. "}
            {state.settings.captureMessagingActivity
              ? "Messages, including iMessage, and recognized chat apps and websites can be included. "
              : "Messages, including iMessage, and recognized chat apps and websites are excluded. "}
            {state.settings.captureEmailActivity || state.settings.captureMessagingActivity
              ? "Enabled activity can contribute to local summaries and, when using a cloud model, selected evidence may be sent to that provider. "
              : null}
            Password fields, private browser windows, recognized adult websites, and password apps are always excluded.
          </p>
        </div>
      </details>

    </section>
  );
}

function SettingsPage({
  apiKeyFocusRequest,
  state,
  setState,
  updateSettings
}: {
  apiKeyFocusRequest: number;
  state: BootstrapState;
  setState: SetAppState;
  updateSettings: (settings: CollectionSettings) => Promise<void>;
}): React.JSX.Element {
  const [apiKey, setApiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [checkingAppleAvailability, setCheckingAppleAvailability] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState<string>();
  const [pendingCloudSettings, setPendingCloudSettings] = useState<InferenceSettings>();
  const [dataMessage, setDataMessage] = useState<string>();
  const inferenceProvider = state.inference.settings.provider;
  const inferenceModel = state.inference.settings.models[inferenceProvider];
  const apiKeySource = state.inference.keySources[inferenceProvider];

  useEffect(() => {
    if (apiKeyFocusRequest === 0) return;
    const form = document.getElementById("api-key-settings");
    const input = form?.querySelector<HTMLInputElement>("input");
    form?.scrollIntoView({ block: "center" });
    input?.focus({ preventScroll: true });
  }, [apiKeyFocusRequest]);

  useEffect(() => {
    setApiKey("");
    setApiKeyMessage(undefined);
  }, [inferenceProvider]);

  async function saveApiKey(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setSavingApiKey(true);
    setApiKeyMessage(undefined);
    try {
      setState(await window.openHistory.setInferenceApiKey(inferenceProvider, apiKey));
      setApiKey("");
      setApiKeyMessage(`${INFERENCE_PROVIDER_LABELS[inferenceProvider]} API key saved securely.`);
    } catch {
      setApiKeyMessage("The API key could not be saved securely.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function useEnvironmentFallback(): Promise<void> {
    setSavingApiKey(true);
    setApiKeyMessage(undefined);
    try {
      const nextState = await window.openHistory.clearInferenceApiKey(inferenceProvider);
      setState(nextState);
      const nextSource = nextState.inference.keySources[inferenceProvider];
      setApiKeyMessage(nextSource === "environment"
        ? `Using ${apiKeyEnvironmentName(inferenceProvider)} from the local environment.`
        : "Saved API key removed. Add a new key to configure this provider.");
    } catch {
      setApiKeyMessage("The saved API key could not be removed.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function refreshAppleAvailability(): Promise<void> {
    setCheckingAppleAvailability(true);
    setApiKeyMessage(undefined);
    try {
      setState(await window.openHistory.refreshAppleAvailability());
    } catch {
      setApiKeyMessage("OpenHistory could not check Apple Intelligence. Try again.");
    } finally {
      setCheckingAppleAvailability(false);
    }
  }

  async function updateInference(next: InferenceSettings): Promise<void> {
    if (
      next.enabled &&
      isCloudInferenceProvider(next.provider) &&
      (
        !state.settings.cloudInferenceConsents.includes(next.provider) ||
        state.inference.keySources[next.provider] === "none"
      )
    ) {
      setApiKeyMessage(undefined);
      setPendingCloudSettings(next);
      return;
    }
    setSavingApiKey(true);
    setApiKeyMessage(undefined);
    try {
      setState(await window.openHistory.updateInferenceSettings(next));
    } catch {
      setApiKeyMessage("Inference settings could not be saved.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function confirmCloudInference(provider: CloudInferenceProvider, apiKey: string): Promise<void> {
    if (!pendingCloudSettings) return;
    const needsApiKey = state.inference.keySources[provider] === "none";
    const normalizedApiKey = apiKey.trim();
    if (needsApiKey && !normalizedApiKey) return;
    setSavingApiKey(true);
    setApiKeyMessage(undefined);
    try {
      if (needsApiKey) {
        setState(await window.openHistory.setInferenceApiKey(provider, normalizedApiKey));
      }
      if (!state.settings.cloudInferenceConsents.includes(provider)) {
        setState(await window.openHistory.authorizeCloudInference(provider));
      }
      const updated = await window.openHistory.updateInferenceSettings(pendingCloudSettings);
      setState(updated);
      setPendingCloudSettings(undefined);
    } catch {
      setApiKeyMessage(`${INFERENCE_PROVIDER_LABELS[provider]} could not be enabled. Check the API key and try again.`);
    } finally {
      setSavingApiKey(false);
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setDataMessage(undefined);
    try {
      const exported = await window.openHistory.exportDiagnostics();
      if (exported) setDataMessage("Privacy-safe diagnostics exported without activity content or credentials.");
    } catch {
      setDataMessage("Diagnostics could not be exported.");
    }
  }

  async function deleteAllData(): Promise<void> {
    setDataMessage(undefined);
    try {
      const deleting = await window.openHistory.deleteAllData();
      if (deleting) setDataMessage("Deleting local data and restarting OpenHistory…");
    } catch {
      setDataMessage("Local data could not be deleted. Nothing outside OpenHistory’s data directory was changed.");
    }
  }

  function selectProvider(provider: InferenceProvider): void {
    void updateInference({ ...state.inference.settings, provider });
  }

  function selectModel(model: string): void {
    void updateInference({
      ...state.inference.settings,
      models: { ...state.inference.settings.models, [inferenceProvider]: model }
    });
  }

  return (
    <section className="page-stack">
      <div className="card inference-settings">
        <label className="switch-row inference-toggle">
          <span>
            <strong>Automatic summaries</strong>
            <small>{inferenceProvider === "apple"
              ? "Summarize activity privately on this Mac about every 10 minutes."
              : "Send activity evidence to your selected provider about every 10 minutes."}</small>
          </span>
          <input
            checked={state.inference.settings.enabled}
            disabled={savingApiKey}
            onChange={(event) => void updateInference({
              ...state.inference.settings,
              enabled: event.target.checked
            })}
            type="checkbox"
          />
        </label>
        <div className="inference-selectors">
          <label>
            <span>Provider</span>
            <select
              disabled={savingApiKey}
              onChange={(event) => selectProvider(event.target.value as InferenceProvider)}
              value={inferenceProvider}
            >
              {INFERENCE_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{INFERENCE_PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select
              disabled={savingApiKey || !state.inference.settings.enabled}
              onChange={(event) => selectModel(event.target.value)}
              value={inferenceModel}
            >
              {!INFERENCE_MODEL_OPTIONS[inferenceProvider].some(({ id }) => id === inferenceModel) ? (
                <option value={inferenceModel}>{inferenceModel}</option>
              ) : null}
              {INFERENCE_MODEL_OPTIONS[inferenceProvider].map((model) => (
                <option key={model.id} value={model.id}>{model.label} — {model.description}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <PermissionsPage state={state} setState={setState} updateSettings={updateSettings} />
      <AgentSettings state={state} setState={setState} />
      <div className="card appearance-settings">
        <div>
          <strong>Appearance</strong>
          <span>Glass stays on in every mode.</span>
        </div>
        <div className="appearance-options" aria-label="Appearance" role="group">
          {(["system", "light", "dark"] as const).map((mode) => (
            <button
              aria-pressed={state.settings.appearanceMode === mode}
              className={state.settings.appearanceMode === mode ? "active" : ""}
              key={mode}
              onClick={() => updateSettings({ ...state.settings, appearanceMode: mode })}
              type="button"
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {inferenceProvider === "apple" ? (
        <div className="card api-key-settings" id="api-key-settings">
          <div className="api-key-heading">
            <div>
              <strong>On-device requirements</strong>
              <span>{state.inference.appleAvailability.available ? "Ready" : "Needs attention"}</span>
            </div>
          </div>
          {state.inference.appleAvailability.available ? (
            <p>No API key is needed and activity evidence stays on this Mac. This path is experimental: output quality varies, so review summaries before relying on them.</p>
          ) : (
            <div className="settings-apple-availability">
              <AppleAvailabilityDetails
                availability={state.inference.appleAvailability}
                checking={checkingAppleAvailability}
                onCheckAgain={refreshAppleAvailability}
              />
            </div>
          )}
          {apiKeyMessage ? <span className="api-key-message">{apiKeyMessage}</span> : null}
        </div>
      ) : <form className="card api-key-settings" id="api-key-settings" onSubmit={saveApiKey}>
        <div className="api-key-heading">
          <div>
            <strong>{INFERENCE_PROVIDER_LABELS[inferenceProvider]} API key</strong>
            <span>{apiKeySourceLabel(apiKeySource)}</span>
          </div>
          {apiKeySource === "saved" ? (
            <button className="secondary-button" disabled={savingApiKey} onClick={useEnvironmentFallback} type="button">
              Remove saved key
            </button>
          ) : null}
        </div>
        <div className="api-key-form">
          <input
            aria-label={`${INFERENCE_PROVIDER_LABELS[inferenceProvider]} API key`}
            autoComplete="new-password"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={apiKeySource !== "none" ? "Enter a replacement key" : "Enter API key"}
            type="password"
            value={apiKey}
          />
          <button className="primary-button" disabled={!apiKey.trim() || savingApiKey} type="submit">
            {savingApiKey ? "Saving…" : "Save"}
          </button>
        </div>
        <p>Saved keys are encrypted on this Mac, override <code>{apiKeyEnvironmentName(inferenceProvider)}</code>, and are never shown again. Activity evidence is sent directly to {INFERENCE_PROVIDER_LABELS[inferenceProvider]}.</p>
        {apiKeyMessage ? <span className="api-key-message">{apiKeyMessage}</span> : null}
      </form>}
      <div className="card system-list">
        <div className="system-row">
          <span>{state.inference.settings.enabled ? INFERENCE_PROVIDER_LABELS[inferenceProvider] : "Inference"}</span>
          <strong>{state.inference.settings.enabled
            ? state.inference.configured ? inferenceModel : inferenceProvider === "apple" ? "Unavailable" : "API key missing"
            : "Off"}</strong>
        </div>
        <div className="system-row data-row">
          <div><span>Local data</span><code>{state.dataDirectory}</code></div>
          <button className="secondary-button" onClick={() => window.openHistory.revealDataDirectory()}>
            Show in Finder
          </button>
        </div>
      </div>
      <div className="card privacy-data-settings">
        <div className="privacy-data-heading">
          <div>
            <strong>Data &amp; privacy</strong>
            <span>Inspect, troubleshoot, or permanently remove data stored by OpenHistory.</span>
          </div>
        </div>
        <div className="privacy-data-actions">
          <button className="secondary-button" onClick={() => void exportDiagnostics()}>
            Export safe diagnostics
          </button>
          <button className="danger-button" onClick={() => void deleteAllData()}>
            Delete all local data
          </button>
        </div>
        <p>Diagnostics contain versions, status, settings, and counts only—never activity text, file paths, API keys, or agent credentials. Deletion requires a second native confirmation and restarts the app.</p>
        {dataMessage ? <span className="api-key-message" role="status">{dataMessage}</span> : null}
      </div>
      {pendingCloudSettings && isCloudInferenceProvider(pendingCloudSettings.provider) ? (
        <CloudInferenceDialog
          busy={savingApiKey}
          errorMessage={apiKeyMessage}
          needsApiKey={state.inference.keySources[pendingCloudSettings.provider] === "none"}
          onCancel={() => setPendingCloudSettings(undefined)}
          onConfirm={(key) => void confirmCloudInference(
            pendingCloudSettings.provider as CloudInferenceProvider,
            key
          )}
          provider={pendingCloudSettings.provider}
        />
      ) : null}
    </section>
  );
}

function CloudInferenceDialog({
  busy,
  errorMessage,
  needsApiKey,
  onCancel,
  onConfirm,
  provider
}: {
  busy: boolean;
  errorMessage?: string;
  needsApiKey: boolean;
  onCancel: () => void;
  onConfirm: (apiKey: string) => void;
  provider: CloudInferenceProvider;
}): React.JSX.Element {
  const [apiKey, setApiKey] = useState("");
  const providerLabel = INFERENCE_PROVIDER_LABELS[provider];

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-describedby="cloud-dialog-description"
        aria-labelledby="cloud-dialog-title"
        aria-modal="true"
        className="consent-dialog card"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(apiKey);
        }}
        role="dialog"
      >
        <span className="eyebrow">Cloud inference confirmation</span>
        <h2 id="cloud-dialog-title">Allow {providerLabel} to summarize activity?</h2>
        <p id="cloud-dialog-description">OpenHistory will send evidence from completed work sessions directly to {providerLabel} about every 10 minutes. Chat requests may also send relevant sanitized history and privacy-filtered activity from a requested recent time window, whether or not it has already been summarized. Evidence may include app names, window titles, URLs or domains, document context, visible interface text, and text changes—according to your capture settings.</p>
        <p>Your raw event files remain local. The provider receives only the evidence assembled for summaries and handles it under its own terms and privacy policy.</p>
        {needsApiKey ? (
          <label className="consent-api-key">
            <span>{providerLabel} API key</span>
            <input
              aria-label={`${providerLabel} API key`}
              autoComplete="new-password"
              autoFocus
              disabled={busy}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Enter API key"
              type="password"
              value={apiKey}
            />
            <small>This provider needs its own key. It will be encrypted on this Mac and never shown again.</small>
          </label>
        ) : null}
        {errorMessage ? <span className="api-key-message" role="alert">{errorMessage}</span> : null}
        <div className="consent-dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">Keep cloud off</button>
          <button className="primary-button" disabled={busy || (needsApiKey && !apiKey.trim())} type="submit">
            {busy ? "Saving…" : `Allow ${providerLabel}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="empty-state"><h2>{title}</h2><p>{children}</p></div>;
}

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="notice">{children}</div>;
}

function ErrorMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="error-message" role="alert">{children}</div>;
}

function LoadingState(): React.JSX.Element {
  return (
    <section className="page-stack">
      <EmptyState title="Starting OpenHistory">Loading local state…</EmptyState>
    </section>
  );
}

function collectorClass(state: BootstrapState | undefined): string {
  if (!state) return "is-starting";
  if (!state.collectionEnabled) return "is-paused";
  if (state.collectorState === "starting") return "is-starting";
  return state.collectorState === "running" ? "is-active" : "is-failed";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatHourRange(startTime: string, endTime: string): string {
  return `${formatTime(startTime)}–${formatTime(endTime)}`;
}

function formatHourMarker(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" })
    .format(new Date(value))
    .replace(/[\s.]/g, "")
    .toLowerCase();
}

function formatDayHeading(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return value === localDateKey(new Date())
    ? "Today"
    : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

function formatDaySubheading(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  const day = date.getDate();
  const suffix = day >= 11 && day <= 13
    ? "th"
    : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  const month = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
  return `${month} ${day}${suffix}`;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hourStartKey(timestamp: string): string {
  const date = new Date(timestamp);
  const elapsedMs = date.getMinutes() * 60 * 1_000 + date.getSeconds() * 1_000 + date.getMilliseconds();
  return new Date(date.getTime() - elapsedMs).toISOString();
}

function buildDayGroups(
  timelineItems: TimelineItem[],
  hourItems: HourItem[],
  dailyRollups: DailyRollupItem[]
): DayGroup[] {
  const rollups = new Map(hourItems.map((item) => [item.id, item]));
  const dailyRollupByDate = new Map(dailyRollups.map((item) => [item.date, item]));
  const days = new Map<string, { date: string; items: TimelineItem[]; hours: Map<string, HourGroup> }>();

  for (const item of timelineItems) {
    const timestamp = new Date(item.startTime);
    const date = localDateKey(timestamp);
    const day = days.get(date) ?? { date, items: [], hours: new Map<string, HourGroup>() };
    const id = hourStartKey(item.startTime);
    const hour = day.hours.get(id) ?? {
      id,
      startTime: id,
      endTime: new Date(Date.parse(id) + 60 * 60 * 1_000).toISOString(),
      items: [],
      ...(rollups.get(id) ? { rollup: rollups.get(id) } : {})
    };
    hour.items.push(item);
    day.items.push(item);
    day.hours.set(id, hour);
    days.set(date, day);
  }

  return [...days.values()]
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((day) => ({
      date: day.date,
      items: day.items.sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime)),
      hours: [...day.hours.values()]
        .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime))
        .map((hour) => ({
          ...hour,
          items: hour.items.sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime))
        })),
      ...(dailyRollupByDate.get(day.date) ? { dailyRollup: dailyRollupByDate.get(day.date) } : {})
    }));
}

function updateExpansionWithAnchor(id: string, update: () => void): void {
  const before = document.getElementById(id);
  const top = before?.getBoundingClientRect().top;
  const scroller = before?.closest("main");
  update();
  if (top === undefined || !(scroller instanceof HTMLElement)) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const after = document.getElementById(id);
      if (!after) return;
      scroller.scrollBy({ top: after.getBoundingClientRect().top - top });
    });
  });
}

function initials(value: string): string {
  return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function applicationDisplayName(value: string): string {
  const normalized = value === "Google Chrome" ? "Chrome" : value;
  return normalized.length > 10 ? `${normalized.slice(0, 8)}...` : normalized;
}

function apiKeySourceLabel(source: ApiKeySource): string {
  if (source === "saved") return "Saved securely on this Mac";
  if (source === "environment") return "Using the local environment fallback";
  return "Not configured";
}

function apiKeyEnvironmentName(provider: InferenceProvider): string {
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "kimi") return "MOONSHOT_API_KEY";
  return "OPENAI_API_KEY";
}
