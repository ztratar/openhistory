import type { ActivityEpisode, ActivityEvent } from "@shared/contracts";
import { historySummaryAsMarkdown, linkifyHistoryText } from "@shared/history-links";
import assert from "node:assert/strict";
import test from "node:test";
import {
  episodeHistoryLinks,
  rollupLinkCandidates,
  selectedRollupLinks
} from "./history-links";

test("extracts canonical HTTPS work links without retaining unsafe destinations", () => {
  const links = episodeHistoryLinks(episode([
    browserEvent("pr-files", "https://github.com/example/openhistory/pull/4/files?diff=split", "Fix links · Pull Request #4"),
    browserEvent("pr-root", "https://github.com/example/openhistory/pull/4", "Duplicate PR"),
    browserEvent("issue", "https://github.com/example/openhistory/issues/9", "Issue 9"),
    browserEvent("insecure", "http://example.test/private", "Insecure page")
  ]));

  assert.deepEqual(links, [
    { label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" },
    { label: "Issue #9", url: "https://github.com/example/openhistory/issues/9" }
  ]);
});

test("resolves only model-selected candidates whose exact labels occur in the summary", () => {
  const candidates = rollupLinkCandidates([{ links: [
    { label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" },
    { label: "Release notes", url: "https://example.test/releases/1" }
  ] }]);

  assert.deepEqual(selectedRollupLinks(
    "- Updated Pull Request #4 and verified the build.",
    candidates,
    ["link-1", "link-2", "link-999", "link-1"]
  ), [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }]);
});

test("infers a safe local candidate when its exact label is present without a model reference", () => {
  const candidates = rollupLinkCandidates([{ links: [
    { label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }
  ] }]);

  assert.deepEqual(selectedRollupLinks(
    "- Reviewed Pull Request #4 and verified the build.",
    candidates,
    [],
    true
  ), [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }]);
});

test("renders selected labels as safe inline segments and Markdown links", () => {
  const links = [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }];
  const summary = "- Updated Pull Request #4 with inline links.";

  assert.deepEqual(linkifyHistoryText("Updated Pull Request #4 with inline links.", links), [
    { text: "Updated " },
    { text: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" },
    { text: " with inline links." }
  ]);
  assert.equal(
    historySummaryAsMarkdown(summary, links),
    "- Updated [Pull Request #4](<https://github.com/example/openhistory/pull/4>) with inline links."
  );
});

function browserEvent(id: string, url: string, title: string): ActivityEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-08-15T09:00:00.000Z",
    kind: "url_changed",
    browser: { url, domain: new URL(url).hostname, title }
  };
}

function episode(events: ActivityEvent[]): ActivityEpisode {
  return {
    id: "episode-links",
    startTime: "2026-08-15T09:00:00.000Z",
    endTime: "2026-08-15T09:10:00.000Z",
    events,
    applications: []
  };
}
