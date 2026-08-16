import type { ActivityEvent } from "../shared/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { segmentActivityEvents } from "./episode-segmenter";

test("groups related activity inside a ten-minute episode", () => {
  const episodes = segmentActivityEvents([
    semanticAppEvent("one", "2026-08-14T09:00:00Z", "com.example.Editor"),
    semanticAppEvent("two", "2026-08-14T09:00:30Z", "com.apple.Terminal"),
    semanticAppEvent("three", "2026-08-14T09:01:00Z", "com.example.Editor")
  ]);

  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]?.events.length, 3);
  assert.deepEqual(
    episodes[0]?.applications.map((application) => application.bundleIdentifier),
    ["com.example.Editor", "com.apple.Terminal"]
  );
});

test("splits episodes at idle gaps and maximum duration", () => {
  const episodes = segmentActivityEvents([
    semanticAppEvent("one", "2026-08-14T09:00:00Z", "com.example.Editor"),
    semanticAppEvent("two", "2026-08-14T09:06:00Z", "com.apple.Terminal"),
    semanticAppEvent("three", "2026-08-14T09:15:59Z", "com.example.Browser")
  ]);

  assert.equal(episodes.length, 3);
});

test("uses screen sleep and wake as hard task boundaries", () => {
  const episodes = segmentActivityEvents([
    semanticAppEvent("one", "2026-08-14T09:00:00Z", "com.example.Editor"),
    systemEvent("sleep", "2026-08-14T09:01:00Z", "screen_slept"),
    systemEvent("wake", "2026-08-14T09:02:00Z", "screen_woke"),
    semanticAppEvent("two", "2026-08-14T09:02:01Z", "com.example.Browser")
  ]);

  assert.equal(episodes.length, 2);
  assert.equal(episodes[0]?.applications[0]?.bundleIdentifier, "com.example.Editor");
  assert.equal(episodes[1]?.applications[0]?.bundleIdentifier, "com.example.Browser");
});

test("episode identifiers are stable for the same source events", () => {
  const input = [semanticAppEvent("one", "2026-08-14T09:00:00Z", "com.example.Editor")];
  assert.equal(segmentActivityEvents(input)[0]?.id, segmentActivityEvents(input)[0]?.id);
});

test("episode identifiers stay stable while the active episode grows", () => {
  const first = semanticAppEvent("one", "2026-08-14T09:00:00Z", "com.example.Editor");
  const original = segmentActivityEvents([first])[0]?.id;
  const extended = segmentActivityEvents([
    first,
    semanticAppEvent("two", "2026-08-14T09:01:00Z", "com.example.Browser")
  ])[0]?.id;
  assert.equal(original, extended);
});

test("keeps native focused-window changes as work evidence", () => {
  const event = appEvent("window", "2026-08-14T09:00:00Z", "com.example.Browser");
  event.kind = "window_changed";
  event.windowTitle = "Project research";
  const focus = semanticAppEvent("focus", "2026-08-14T09:00:01Z", "com.example.Browser");
  assert.equal(segmentActivityEvents([event, focus])[0]?.events[0]?.windowTitle, "Project research");
});

test("keeps semantic text edits as work evidence", () => {
  const event = appEvent("typing", "2026-08-14T09:00:00Z", "com.apple.Notes");
  event.kind = "text_input";
  event.textChange = {
    insertedText: "prototype observation",
    deletedCharacterCount: 0,
    resultingValue: "prototype observation"
  };
  assert.equal(segmentActivityEvents([event])[0]?.events[0]?.kind, "text_input");
});

test("does not summarize a background application termination by itself", () => {
  const event = appEvent("closed", "2026-08-14T09:00:00Z", "com.example.BackgroundHelper");
  event.kind = "application_terminated";
  assert.equal(segmentActivityEvents([event]).length, 0);
});

test("keeps sanitized document context as work evidence", () => {
  const event = appEvent("document", "2026-08-14T09:00:00Z", "com.apple.finder");
  event.kind = "document_context_changed";
  event.document = {
    displayPath: "Projects/OpenHistory/README.md",
    name: "README.md",
    fileExtension: "md"
  };
  assert.equal(segmentActivityEvents([event])[0]?.events[0]?.document?.name, "README.md");
});

test("drops current and legacy self-observation from the development host", () => {
  for (const title of ["OpenHistory", "Computer History"]) {
    const event = appEvent(`self-${title}`, "2026-08-14T09:00:00Z", "com.github.Electron");
    event.windowTitle = title;
    assert.equal(segmentActivityEvents([event]).length, 0);
  }
});

test("does not create a timeline episode from activation and title context alone", () => {
  const activation = appEvent("activation", "2026-08-14T09:00:00Z", "com.example.Browser");
  const window = appEvent("window", "2026-08-14T09:00:01Z", "com.example.Browser");
  window.kind = "window_changed";
  window.windowTitle = "A tab title without semantic evidence";
  assert.equal(segmentActivityEvents([activation, window]).length, 0);
});

test("keeps list selections as substantive action evidence", () => {
  const event = appEvent("selection", "2026-08-14T09:00:00Z", "com.apple.finder");
  event.kind = "selection_changed";
  event.selectedElements = [{ role: "AXRow", label: "Project brief.pdf" }];
  assert.equal(segmentActivityEvents([event])[0]?.events[0]?.selectedElements?.[0]?.label, "Project brief.pdf");
});

test("splits a task when a different app becomes active after meaningful quiet", () => {
  const episodes = segmentActivityEvents([
    semanticAppEvent("editor", "2026-08-14T09:00:00Z", "com.example.Editor"),
    appEvent("browser-activation", "2026-08-14T09:02:30Z", "com.example.Browser"),
    semanticAppEvent("browser-work", "2026-08-14T09:02:31Z", "com.example.Browser")
  ]);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[1]?.events[0]?.id, "browser-activation");
});

test("keeps rapid cross-app transitions in one workflow", () => {
  const episodes = segmentActivityEvents([
    semanticAppEvent("editor", "2026-08-14T09:00:00Z", "com.example.Editor"),
    appEvent("browser-activation", "2026-08-14T09:00:30Z", "com.example.Browser"),
    semanticAppEvent("browser-work", "2026-08-14T09:00:31Z", "com.example.Browser")
  ]);
  assert.equal(episodes.length, 1);
});

test("trims stale boundary context while retaining nearby setup context", () => {
  const activation = appEvent("activation", "2026-08-14T09:00:00Z", "com.example.Editor");
  const work = semanticAppEvent("work", "2026-08-14T09:00:10Z", "com.example.Editor");
  const termination = appEvent("termination", "2026-08-14T09:00:20Z", "com.example.Helper");
  termination.kind = "application_terminated";
  const episode = segmentActivityEvents([activation, work, termination])[0];
  assert.deepEqual(episode?.events.map(({ id }) => id), ["activation", "work"]);
  assert.equal(episode?.id, segmentActivityEvents([work])[0]?.id);
});

test("removes immediately repeated passive context before summarization", () => {
  const first = semanticAppEvent("first", "2026-08-14T09:00:00Z", "com.example.Editor");
  const duplicate = { ...first, id: "duplicate", timestamp: "2026-08-14T09:00:02Z" };
  const episode = segmentActivityEvents([first, duplicate])[0];
  assert.deepEqual(episode?.events.map(({ id }) => id), ["first"]);
});

test("coalesces identical activation context across a short collector restart", () => {
  const before = semanticAppEvent("before", "2026-08-14T09:00:00Z", "com.example.Editor");
  const first = appEvent("activation-one", "2026-08-14T09:00:01Z", "com.example.Editor");
  const duplicate = appEvent("activation-two", "2026-08-14T09:00:46Z", "com.example.Editor");
  const after = semanticAppEvent("after", "2026-08-14T09:00:47Z", "com.example.Editor");
  const episode = segmentActivityEvents([before, first, duplicate, after])[0];
  assert.deepEqual(episode?.events.map(({ id }) => id), ["before", "activation-one", "after"]);
});

function appEvent(id: string, timestamp: string, bundleIdentifier: string): ActivityEvent {
  return {
    version: 1,
    id,
    timestamp,
    kind: "application_activated",
    application: {
      bundleIdentifier,
      localizedName: bundleIdentifier.split(".").at(-1) ?? bundleIdentifier,
      processIdentifier: 42
    }
  };
}

function semanticAppEvent(id: string, timestamp: string, bundleIdentifier: string): ActivityEvent {
  return {
    ...appEvent(id, timestamp, bundleIdentifier),
    kind: "focused_element_changed",
    element: { role: "AXWebArea", title: "Work surface" }
  };
}

function systemEvent(
  id: string,
  timestamp: string,
  kind: "screen_slept" | "screen_woke" | "session_locked" | "session_unlocked"
): ActivityEvent {
  return { version: 1, id, timestamp, kind };
}

test("uses session lock and unlock as hard privacy boundaries", () => {
  const episodes = segmentActivityEvents([
    semanticAppEvent("before", "2026-08-14T09:00:00Z", "com.example.Editor"),
    systemEvent("lock", "2026-08-14T09:00:10Z", "session_locked"),
    systemEvent("unlock", "2026-08-14T09:01:00Z", "session_unlocked"),
    semanticAppEvent("after", "2026-08-14T09:01:01Z", "com.example.Editor")
  ]);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0]?.events.at(-1)?.kind, "session_locked");
  assert.equal(episodes[1]?.events[0]?.kind, "session_unlocked");
});

test("never summarizes activity from an adult browsing interval", () => {
  const before = semanticAppEvent("before", "2026-08-14T09:00:00Z", "com.google.Chrome");
  const protectedNavigation = appEvent("adult", "2026-08-14T09:00:01Z", "com.google.Chrome");
  protectedNavigation.kind = "url_changed";
  protectedNavigation.browser = {
    url: "https://pornhub.com/[redacted]",
    domain: "pornhub.com"
  };
  const protectedClick = appEvent("private", "2026-08-14T09:00:02Z", "com.google.Chrome");
  protectedClick.kind = "pointer_click";
  protectedClick.element = { role: "AXButton", label: "private adult action" };
  const safeNavigation = appEvent("safe-url", "2026-08-14T09:00:03Z", "com.google.Chrome");
  safeNavigation.kind = "url_changed";
  safeNavigation.browser = { url: "https://example.com", domain: "example.com" };
  const after = semanticAppEvent("after", "2026-08-14T09:00:04Z", "com.google.Chrome");

  const episodes = segmentActivityEvents([before, protectedNavigation, protectedClick, safeNavigation, after]);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.flatMap((episode) => episode.events.map(({ id }) => id)), [
    "before",
    "safe-url",
    "after"
  ]);
  assert.doesNotMatch(JSON.stringify(episodes), /pornhub|private adult action/);
});
