import type { ActivityEpisode, ActivityEvent } from "@shared/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEpisodeEvidencePacket,
  renderCompactEpisodeEvidenceBrief,
  renderEpisodeEvidenceBrief
} from "./episode-evidence";

test("groups event telemetry into action-centered work units without absolute timestamps", () => {
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:10:14.000Z",
    applications: [],
    events: [
      event("typed", "text_input", {
        windowTitle: "Project review",
        textChange: {
          insertedText: "Review this codebase for technical differentiation",
          deletedCharacterCount: 0,
          resultingValue: "Review this codebase for technical differentiation"
        }
      }),
      event("sent", "pointer_click", {
        windowTitle: "Project review",
        element: { role: "AXButton", title: "Send and archive" }
      }),
      event("passive", "window_changed", { windowTitle: "Unrelated notification" })
    ]
  };

  const packet = buildEpisodeEvidencePacket(episode);
  assert.equal(packet.workUnits.length, 1);
  assert.match(packet.workUnits[0]!.contentChanges[0]!, /technical differentiation/);
  assert.match(packet.workUnits[0]!.interactions[0]!, /button “Send and archive”/);
  assert.match(packet.workUnits[0]!.submissionActions[0]!, /button “Send and archive”/);
  assert.equal(packet.workUnits[0]!.claimCeiling, "submitted_action");
  assert.deepEqual(packet.workUnits[0]!.safeLeadVerbs, ["Sent"]);
  assert.match(packet.evidenceBoundaries.join(" "), /supports a user-initiated submission/);
  assert.match(packet.ambientContext[0]!, /Unrelated notification/);

  const brief = renderEpisodeEvidenceBrief(packet);
  assert(!brief.includes("2026-08-14"));
  assert.match(brief, /Ordered work units/);
  assert.match(brief, /Project review/);
  assert.match(brief, /Explicit submission actions/);
  assert.match(brief, /downstream delivery, processing, or success/);
});

test("keeps the final text snapshot and does not promote static-text clicks", () => {
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:10:14.000Z",
    applications: [],
    events: [
      event("fragment", "text_input", {
        windowTitle: "Draft",
        textChange: { insertedText: "impl", deletedCharacterCount: 0, resultingValue: "Please impl" }
      }),
      event("complete", "text_input", {
        windowTitle: "Draft",
        textChange: {
          insertedText: "ement the proposed timeline",
          deletedCharacterCount: 0,
          resultingValue: "Please implement the proposed timeline"
        }
      }),
      event("message", "pointer_click", {
        windowTitle: "Draft",
        element: { role: "AXStaticText", title: "Implemented the proposed timeline" }
      }),
      event("send", "pointer_click", {
        windowTitle: "Draft",
        element: { role: "AXButton", title: "Send" }
      })
    ]
  };

  const packet = buildEpisodeEvidencePacket(episode);
  assert.deepEqual(packet.workUnits[0]!.contentChanges, [
    "Final observed edited text: “Please implement the proposed timeline”"
  ]);
  assert.deepEqual(packet.workUnits[0]!.interactions, ["Clicked button “Send”."]);
  assert.equal(packet.workUnits[0]!.claimCeiling, "submitted_action");
  assert.deepEqual(packet.workUnits[0]!.safeLeadVerbs, ["Sent"]);
  assert.doesNotMatch(renderEpisodeEvidenceBrief(packet), /Clicked static text/);
});

test("context-only evidence uses a displayed claim ceiling", () => {
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:02:20.000Z",
    applications: [],
    events: [event("window", "window_changed", { windowTitle: "loginwindow" })]
  };

  const brief = renderEpisodeEvidenceBrief(buildEpisodeEvidencePacket(episode));
  assert.match(brief, /Use "Displayed" as the lead verb/);
  assert.match(brief, /Never say created, opened, activated, viewed, or reviewed/);
});

test("ranks explicit outcomes and substantive drafts ahead of incidental activity", () => {
  const chrome = {
    bundleIdentifier: "com.google.Chrome",
    localizedName: "Google Chrome",
    processIdentifier: 2
  };
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:10:14.000Z",
    applications: [],
    events: [
      event("click", "pointer_click", {
        application: {
          bundleIdentifier: "com.apple.finder",
          localizedName: "Finder",
          processIdentifier: 3
        },
        windowTitle: "Other screen",
        element: { role: "AXButton", title: "Close" }
      }),
      event("draft", "text_input", {
        windowTitle: "Product feedback",
        textChange: {
          insertedText: "Change the fixed timeline hierarchy",
          deletedCharacterCount: 0,
          resultingValue: "Change the fixed timeline hierarchy to support nested day and hour expansion"
        }
      }),
      event("success", "url_changed", {
        application: chrome,
        windowTitle: "openhistory.sh successfully registered! - Google Chrome",
        browser: {
          url: "https://example.test/success",
          domain: "example.test",
          title: "openhistory.sh successfully registered! - Google Chrome"
        }
      })
    ]
  };

  const packet = buildEpisodeEvidencePacket(episode);
  assert.equal(packet.workUnits[0]!.claimCeiling, "demonstrated_result");
  assert.deepEqual(packet.workUnits[0]!.safeLeadVerbs, ["Registered"]);
  assert.equal(packet.workUnits[1]!.claimCeiling, "draft_or_revision");
  assert.equal(packet.workUnits.at(-1)!.claimCeiling, "literal_interaction");
  const compact = renderCompactEpisodeEvidenceBrief(packet);
  assert.match(compact, /PRIMARY: openhistory\.sh successfully registered!/);
  assert.match(compact, /Preferred title verbs: Registered/);
  assert(compact.length < 4_000);
});

test("treats address-bar edits as literal navigation intent, not drafted work", () => {
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:10:14.000Z",
    applications: [],
    events: [
      event("address", "text_input", {
        application: {
          bundleIdentifier: "com.google.Chrome",
          localizedName: "Google Chrome",
          processIdentifier: 2
        },
        windowTitle: "Hacker News",
        element: { role: "AXTextField", label: "Address and search bar" },
        textChange: { insertedText: "test", deletedCharacterCount: 20, resultingValue: "test" }
      }),
      event("note", "text_input", {
        application: {
          bundleIdentifier: "com.apple.Notes",
          localizedName: "Notes",
          processIdentifier: 3
        },
        element: { role: "AXTextArea", identifier: "Note Body Text View" },
        textChange: {
          insertedText: "I wrote a note",
          deletedCharacterCount: 1_182,
          resultingValue: "I wrote a note"
        }
      })
    ]
  };

  const packet = buildEpisodeEvidencePacket(episode);
  assert.equal(packet.workUnits[0]!.application, "Notes");
  assert.equal(packet.workUnits[0]!.claimCeiling, "draft_or_revision");
  assert.equal(packet.workUnits[1]!.claimCeiling, "literal_interaction");
  assert.match(packet.workUnits[1]!.interactions[0]!, /address or search bar/);
  assert.equal(packet.workUnits[1]!.contentChanges.length, 0);
  const compact = renderCompactEpisodeEvidenceBrief(packet);
  assert.match(compact, /PRIMARY: Notes/);
  assert.doesNotMatch(compact, /address or search bar/);
  assert.match(compact, /intentionally excludes clicks and navigation/);
});

test("retains consequential later drafts instead of the first three snapshots", () => {
  const values = [
    "A short initial setup thought",
    "A much longer design exploration about local access and configuration that provides useful context",
    "A separate medium-length discussion about permissions and projected data access",
    "Do not put the credential in the URL. Build this!",
    "Describe your goal, define measurable outcomes for best results"
  ];
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:10:14.000Z",
    applications: [],
    events: values.map((value, index) => event(`change-${index}`, "text_input", {
      windowTitle: "Design draft",
      element: { role: "AXTextArea", label: "Do anything" },
      textChange: { insertedText: value, deletedCharacterCount: 0, resultingValue: value }
    }))
  };

  const changes = buildEpisodeEvidencePacket(episode).workUnits[0]!.contentChanges;
  assert.equal(changes.length, 3);
  assert.match(changes.join(" "), /credential in the URL/);
  assert.doesNotMatch(changes.join(" "), /Describe your goal/);
});

test("replaces deleted draft content with the later observed state", () => {
  const episode: ActivityEpisode = {
    id: "episode",
    startTime: "2026-08-14T17:02:15.000Z",
    endTime: "2026-08-14T17:10:14.000Z",
    applications: [],
    events: [
      event("before-delete", "text_input", {
        windowTitle: "Design draft",
        textChange: {
          insertedText: " Also add AI permission controls",
          deletedCharacterCount: 0,
          resultingValue: "Use a projection instead of files. Also add AI permission controls"
        }
      }),
      event("after-delete", "text_input", {
        windowTitle: "Design draft",
        textChange: {
          insertedText: "",
          deletedCharacterCount: 33,
          resultingValue: "Use a projection instead of files."
        }
      })
    ]
  };

  const changes = buildEpisodeEvidencePacket(episode).workUnits[0]!.contentChanges;
  assert.equal(changes.length, 1);
  assert.match(changes[0]!, /Use a projection instead of files/);
  assert.doesNotMatch(changes[0]!, /AI permission controls/);
});

function event(
  id: string,
  kind: ActivityEvent["kind"],
  values: Partial<ActivityEvent>
): ActivityEvent {
  return {
    version: 1,
    id,
    timestamp: "2026-08-14T17:02:15.000Z",
    kind,
    application: {
      bundleIdentifier: "com.openai.chat",
      localizedName: "ChatGPT",
      processIdentifier: 1
    },
    ...values
  };
}
