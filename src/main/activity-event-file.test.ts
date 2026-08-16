import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadActivityEvents,
  parseActivityEvent,
  scrubProtectedActivityEvents
} from "./activity-event-file";

test("rejects unknown kinds, invalid timestamps, and oversized records", () => {
  assert.equal(parseActivityEvent(JSON.stringify(event("one", "2026-08-14T09:00:00Z", "unknown"))), undefined);
  assert.equal(parseActivityEvent(JSON.stringify(event("one", "not-a-date", "pointer_click"))), undefined);
  assert.equal(parseActivityEvent(JSON.stringify(event("one", "2026-08-14", "pointer_click"))), undefined);
  assert.equal(parseActivityEvent("x".repeat(256 * 1_024 + 1)), undefined);
  assert.equal(parseActivityEvent(JSON.stringify({
    ...event("bad-nested", "2026-08-14T09:00:00Z", "ui_snapshot"),
    visibleText: ["valid", 42]
  })), undefined);
  assert.equal(parseActivityEvent(JSON.stringify({
    ...event("too-many-items", "2026-08-14T09:00:00Z", "ui_snapshot"),
    visibleText: Array.from({ length: 101 }, () => "bounded")
  })), undefined);
  assert.equal(parseActivityEvent(JSON.stringify({
    ...event("notification", "2026-08-14T09:00:00Z", "ui_snapshot"),
    application: {
      bundleIdentifier: "com.apple.UserNotificationCenter",
      localizedName: "UserNotificationCenter",
      processIdentifier: 9
    },
    visibleText: ["private notification"]
  })), undefined);
});

test("keeps mail activity excluded by default and allows it only when enabled", () => {
  const mailEvent = JSON.stringify({
    ...event("mail", "2026-08-14T09:00:00Z", "window_changed"),
    application: {
      bundleIdentifier: "com.apple.mail",
      localizedName: "Mail",
      processIdentifier: 42
    },
    windowTitle: "Inbox"
  });
  assert.equal(parseActivityEvent(mailEvent), undefined);
  assert.equal(parseActivityEvent(mailEvent, { captureEmailActivity: true })?.id, "mail");

  const gmailEvent = JSON.stringify({
    ...event("gmail", "2026-08-14T09:00:01Z", "window_changed"),
    application: {
      bundleIdentifier: "com.google.Chrome",
      localizedName: "Google Chrome",
      processIdentifier: 43
    },
    windowTitle: "Inbox (3) – person@example.com – Gmail – Google Chrome"
  });
  assert.equal(parseActivityEvent(gmailEvent), undefined);
  assert.equal(parseActivityEvent(gmailEvent, { captureEmailActivity: true })?.id, "gmail");
});

test("bounded loading returns the newest valid unique events across daily files", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-loader-"));
  try {
    writeFileSync(join(directory, "events-2026-08-13.jsonl"), [
      JSON.stringify(event("old", "2026-08-13T23:59:00Z", "pointer_click")),
      "not-json"
    ].join("\n"));
    writeFileSync(join(directory, "events-2026-08-14.jsonl"), [
      JSON.stringify(event("middle", "2026-08-14T00:00:00Z", "text_input")),
      JSON.stringify(event("new", "2026-08-14T00:01:00Z", "url_changed")),
      JSON.stringify(event("new", "2026-08-14T00:01:00Z", "url_changed"))
    ].join("\n"));

    assert.deepEqual(loadActivityEvents(directory, 2).map(({ id }) => id), ["middle", "new"]);
    assert.equal(loadActivityEvents(directory).length, 3);
    assert.deepEqual(loadActivityEvents(directory, 0), []);
    appendFileSync(
      join(directory, "events-2026-08-14.jsonl"),
      `\n${JSON.stringify(event("newest", "2026-08-14T00:02:00Z", "pointer_click"))}`
    );
    assert.deepEqual(loadActivityEvents(directory, 1).map(({ id }) => id), ["newest"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recovers an event appended across two partial writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-partial-loader-"));
  try {
    const path = join(directory, "events-2026-08-14.jsonl");
    const complete = Buffer.from(JSON.stringify({
      ...event("partial", "2026-08-14T12:00:00.000Z", "text_input"),
      windowTitle: "Unicode 🧠 test"
    }));
    const split = complete.indexOf(Buffer.from("🧠")) + 2;
    writeFileSync(path, complete.subarray(0, split));
    assert.deepEqual(loadActivityEvents(directory), []);

    appendFileSync(path, Buffer.concat([complete.subarray(split), Buffer.from("\n")]));
    assert.deepEqual(loadActivityEvents(directory).map(({ id }) => id), ["partial"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomically scrubs protected-app records while retaining ordinary and malformed evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-scrub-"));
  try {
    const path = join(directory, "events-2026-08-14.jsonl");
    writeFileSync(path, [
      JSON.stringify(event("ordinary", "2026-08-14T00:00:00Z", "pointer_click")),
      JSON.stringify({
        ...event("private", "2026-08-14T00:00:01Z", "ui_snapshot"),
        application: { bundleIdentifier: "com.apple.UserNotificationCenter", processIdentifier: 9 }
      }),
      "malformed-but-preserved"
    ].join("\n"));

    assert.equal(scrubProtectedActivityEvents(directory), 1);
    const scrubbed = readFileSync(path, "utf8");
    assert(scrubbed.includes("ordinary"));
    assert(scrubbed.includes("malformed-but-preserved"));
    assert(!scrubbed.includes("private"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loaded history removes adult browsing and password-field content", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-private-browser-loader-"));
  try {
    const path = join(directory, "events-2026-08-15.jsonl");
    writeFileSync(path, [
      JSON.stringify({
        ...event("adult", "2026-08-15T00:00:00Z", "url_changed"),
        application: { bundleIdentifier: "com.google.Chrome", processIdentifier: 42 },
        browser: { url: "https://pornhub.com/private", domain: "pornhub.com" }
      }),
      JSON.stringify({
        ...event("adult-text", "2026-08-15T00:00:01Z", "text_input"),
        application: { bundleIdentifier: "com.google.Chrome", processIdentifier: 42 },
        element: { role: "AXTextField", label: "private adult action" },
        textChange: { insertedText: "private adult text", deletedCharacterCount: 0, resultingValue: "private adult text" }
      }),
      JSON.stringify({
        ...event("safe", "2026-08-15T00:00:02Z", "url_changed"),
        application: { bundleIdentifier: "com.google.Chrome", processIdentifier: 42 },
        browser: { url: "https://example.com", domain: "example.com" }
      }),
      JSON.stringify({
        ...event("password", "2026-08-15T00:00:03Z", "text_input"),
        application: { bundleIdentifier: "com.google.Chrome", processIdentifier: 42 },
        element: { role: "AXTextField", identifier: "current-password" },
        textChange: { insertedText: "arbitrary-canary-password", deletedCharacterCount: 0, resultingValue: "arbitrary-canary-password" }
      })
    ].join("\n"));

    const serialized = JSON.stringify(loadActivityEvents(directory));
    assert.doesNotMatch(serialized, /pornhub|private adult|arbitrary-canary-password|current-password/);
    assert.match(serialized, /example\.com/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function event(id: string, timestamp: string, kind: string): object {
  return { version: 1, id, timestamp, kind };
}
