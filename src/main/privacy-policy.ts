import type { ActivityEvent, SemanticElement } from "@shared/contracts";
import privacyPolicyData from "@shared/privacy-policy-data.json";
import { createHash } from "node:crypto";

export const MAIL_BUNDLE_IDENTIFIERS = new Set([
  "com.apple.mail",
  "com.microsoft.Outlook"
]);

const MAIL_WEB_DOMAINS = new Set([
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "mail.yahoo.com",
  "mail.proton.me",
  "mail.icloud.com",
  "app.fastmail.com"
]);

export const ALWAYS_PROTECTED_BUNDLE_IDENTIFIERS = new Set([
  "com.apple.MobileSMS",
  "com.apple.UserNotificationCenter",
  "com.apple.notificationcenterui",
  "com.tinyspeck.slackmacgap",
  "com.microsoft.teams",
  "com.microsoft.teams2",
  "com.hnc.Discord",
  "net.whatsapp.WhatsApp",
  "org.whispersystems.signal-desktop",
  "ru.keepcoder.Telegram",
  "org.telegram.desktop",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.apple.Passwords",
  "com.apple.keychainaccess",
  "com.bitwarden.desktop",
  "com.dashlane.Dashlane",
  "com.lastpass.LastPass"
]);

const BROWSER_BUNDLE_IDENTIFIERS = new Set([
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.canary",
  "com.apple.Safari",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "org.chromium.Chromium",
  "company.thebrowser.Browser",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera"
]);

const ADULT_WEB_DOMAINS = new Set(privacyPolicyData.adultWebDomains.map(normalizeDomain));
const SENSITIVE_FIELD_PHRASES = [
  "password",
  "passwd",
  "pwd",
  "passcode",
  "current-password",
  "new-password",
  "password-field",
  "pin code",
  "pin number",
  "secret",
  "api key",
  "access token",
  "auth token",
  "private key",
  "seed phrase",
  "recovery phrase",
  "security code",
  "verification code",
  "one-time code",
  "one time code",
  "otp",
  "cvv"
];
const SENSITIVE_FOCUS_EVENT_KINDS = new Set<ActivityEvent["kind"]>([
  "focused_element_changed",
  "selection_changed",
  "text_input",
  "document_changed",
  "pointer_click",
  "ui_snapshot"
]);

export function isProtectedAdultWebDomain(value: string): boolean {
  const domain = normalizeDomain(value);
  return [...ADULT_WEB_DOMAINS].some(
    (protectedDomain) => domain === protectedDomain || domain.endsWith(`.${protectedDomain}`)
  );
}

export function isSensitiveTextField(element: SemanticElement | undefined): boolean {
  if (!element) return false;
  const role = element.role?.toLowerCase() ?? "";
  const subrole = element.subrole?.toLowerCase() ?? "";
  if (role.includes("secure") || subrole.includes("secure")) return true;
  const metadata = [element.title, element.label, element.identifier]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return SENSITIVE_FIELD_PHRASES.some((phrase) => metadata.includes(phrase));
}

export const PROTECTED_BUNDLE_IDENTIFIERS = new Set([
  ...ALWAYS_PROTECTED_BUNDLE_IDENTIFIERS,
  ...MAIL_BUNDLE_IDENTIFIERS
]);

export interface ActivityPrivacyOptions {
  captureEmailActivity?: boolean;
}

export function isProtectedActivityEvent(
  event: Pick<ActivityEvent, "application" | "browser" | "element" | "kind" | "windowTitle">,
  options: ActivityPrivacyOptions = {}
): boolean {
  const bundleIdentifier = event.application?.bundleIdentifier;
  if (bundleIdentifier && ALWAYS_PROTECTED_BUNDLE_IDENTIFIERS.has(bundleIdentifier)) return true;
  if (!options.captureEmailActivity && (
    (bundleIdentifier && MAIL_BUNDLE_IDENTIFIERS.has(bundleIdentifier)) ||
    (event.browser?.domain && isMailDomain(event.browser.domain)) ||
    isMailWindowTitle(event.windowTitle)
  )) return true;
  return ["focused_element_changed", "text_input", "document_changed"].includes(event.kind) &&
    isSensitiveTextField(event.element);
}

export function filterProtectedActivityEvents(
  input: ActivityEvent[],
  options: ActivityPrivacyOptions = {}
): ActivityEvent[] {
  return new ActivityPrivacyFilter(options).filter([...input].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
  ));
}

export class ActivityPrivacyFilter {
  private readonly protectedBrowsers = new Set<string>();
  private readonly sensitiveBrowserFields = new Set<string>();

  constructor(private readonly options: ActivityPrivacyOptions = {}) {}

  filter(events: ActivityEvent[]): ActivityEvent[] {
    const output: ActivityEvent[] = [];

    for (const event of events) {
      if (event.kind === "privacy_boundary") {
        output.push(event);
        continue;
      }
      if (isProtectedActivityEvent(event, this.options)) {
        const key = browserKey(event);
        if (key && isBrowserEvent(event) && isSensitiveTextField(event.element)) {
          if (!this.sensitiveBrowserFields.has(key)) output.push(privacyBoundaryFrom(event));
          this.sensitiveBrowserFields.add(key);
        }
        continue;
      }

      const key = browserKey(event);
      if (!key || !isBrowserEvent(event)) {
        output.push(event);
        continue;
      }

      if (event.browser && isProtectedAdultWebDomain(event.browser.domain)) {
        if (!this.protectedBrowsers.has(key)) output.push(privacyBoundaryFrom(event));
        this.protectedBrowsers.add(key);
        continue;
      }
      if (event.kind === "url_changed" && this.protectedBrowsers.delete(key)) {
        output.push(privacyBoundaryFrom(event));
      }
      if (this.protectedBrowsers.has(key)) continue;

      if (event.kind === "focused_element_changed") {
        if (isSensitiveTextField(event.element)) {
          if (!this.sensitiveBrowserFields.has(key)) output.push(privacyBoundaryFrom(event));
          this.sensitiveBrowserFields.add(key);
          continue;
        }
        if (this.sensitiveBrowserFields.delete(key)) output.push(privacyBoundaryFrom(event));
      }
      if (this.sensitiveBrowserFields.has(key) && SENSITIVE_FOCUS_EVENT_KINDS.has(event.kind)) continue;
      output.push(event);
    }

    return output;
  }
}

function isBrowserEvent(event: Pick<ActivityEvent, "application">): boolean {
  const bundleIdentifier = event.application?.bundleIdentifier;
  return Boolean(bundleIdentifier && BROWSER_BUNDLE_IDENTIFIERS.has(bundleIdentifier));
}

function browserKey(event: Pick<ActivityEvent, "application">): string | undefined {
  if (!event.application) return undefined;
  return event.application.bundleIdentifier ?? `pid:${event.application.processIdentifier}`;
}

function privacyBoundaryFrom(event: ActivityEvent): ActivityEvent {
  return {
    version: 1,
    id: `privacy-${createHash("sha256")
      .update(`${event.id}\n${event.timestamp}`)
      .digest("hex")
      .slice(0, 24)}`,
    timestamp: event.timestamp,
    kind: "privacy_boundary"
  };
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function isMailDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return [...MAIL_WEB_DOMAINS].some(
    (candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`)
  );
}

function isMailWindowTitle(title: string | undefined): boolean {
  if (!title) return false;
  return /(?:^|\s[-–—]\s)(?:gmail|outlook|yahoo mail|proton mail|icloud mail|fastmail)(?:\s[-–—]|$)/i
    .test(title);
}
