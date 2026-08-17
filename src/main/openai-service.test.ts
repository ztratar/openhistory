import type { ActivityEpisode, ActivityEvent } from "@shared/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { StructuredGenerationRequest } from "./inference/contracts";
import { InferenceOutputError } from "./inference/errors";
import {
  appleSemanticHourPrompt,
  appleSemanticDailyRollupPrompt,
  appleEpisodePrompt,
  dailyEvidenceSummary,
  episodeForHybridModel,
  episodeForModel,
  eventsForModel,
  FACT_STATUS_INSTRUCTIONS,
  HOUR_INSTRUCTIONS,
  hourForHybridModel,
  InferenceService,
  DAILY_ROLLUP_INSTRUCTIONS,
  ROLLUP_COVERAGE_INSTRUCTIONS,
  ROLLUP_LINK_INSTRUCTIONS,
  SUMMARY_INSTRUCTIONS,
  semanticKindForModel,
  prepareEpisodeForInference
} from "./openai-service";

test("keeps evidence-status guardrails in history, hour, and day prompts", () => {
  assert.match(FACT_STATUS_INSTRUCTIONS, /requested 12px.*changed from 24px to 20px/i);
  assert.match(FACT_STATUS_INSTRUCTIONS, /patch, diff, code block, or proposed change.*not proof/i);
  assert.match(FACT_STATUS_INSTRUCTIONS, /unsubmitted draft.*not an adopted decision/i);
  assert.match(FACT_STATUS_INSTRUCTIONS, /Send, Submit, Post, or Publish.*user-initiated submission/i);
  assert.match(SUMMARY_INSTRUCTIONS, /summaryMode.*sparse_literal/i);
  assert.match(SUMMARY_INSTRUCTIONS, /context_only.*do not imply.*viewed, opened, reviewed/i);
  assert.match(SUMMARY_INSTRUCTIONS, /briefly visible.*workThreads or surfaces/i);
  assert.match(SUMMARY_INSTRUCTIONS, /actionSurfaces.*materially distinct direct actions/i);
  assert.match(SUMMARY_INSTRUCTIONS, /Merely opening, navigating to, or viewing.*does not make it a surface/i);
  assert.match(ROLLUP_COVERAGE_INSTRUCTIONS, /Preserve every substantive workstream/i);
  assert.match(ROLLUP_LINK_INSTRUCTIONS, /Never invent a reference or URL/i);
  assert.match(ROLLUP_LINK_INSTRUCTIONS, /exact candidate label verbatim/i);
  assert.match(HOUR_INSTRUCTIONS, /requested, proposed, observed, submitted, and completed states distinct/i);
  assert.match(HOUR_INSTRUCTIONS, /passive or briefly mentioned secondary context/i);
  assert.match(HOUR_INSTRUCTIONS, /Preserve every substantive workstream/i);
  assert.match(DAILY_ROLLUP_INSTRUCTIONS, /requested, proposed, observed, submitted, and completed states distinct/i);
  assert.match(DAILY_ROLLUP_INSTRUCTIONS, /passive or briefly mentioned secondary context/i);
  assert.match(DAILY_ROLLUP_INSTRUCTIONS, /Preserve every substantive workstream/i);
});

test("refuses protected activity at the final inference boundary", () => {
  const adultNavigation = event("adult", "url_changed");
  adultNavigation.application = {
    bundleIdentifier: "com.google.Chrome",
    localizedName: "Chrome",
    processIdentifier: 42
  };
  adultNavigation.browser = {
    url: "https://pornhub.com/private",
    domain: "pornhub.com"
  };
  assert.throws(
    () => prepareEpisodeForInference(makeEpisode([adultNavigation])),
    /protected activity/
  );

  const password = event("password", "text_input");
  password.application = {
    bundleIdentifier: "com.google.Chrome",
    localizedName: "Chrome",
    processIdentifier: 42
  };
  password.element = { role: "AXTextField", identifier: "current-password" };
  password.textChange = {
    insertedText: "arbitrary-canary-password",
    deletedCharacterCount: 0,
    resultingValue: "arbitrary-canary-password"
  };
  assert.throws(
    () => prepareEpisodeForInference(makeEpisode([password]), { captureEmailActivity: true }),
    /protected activity/
  );
});

test("allows email at the final boundary only when capture is enabled", () => {
  const gmailNavigation = event("gmail", "url_changed");
  gmailNavigation.application = {
    bundleIdentifier: "com.google.Chrome",
    localizedName: "Chrome",
    processIdentifier: 42
  };
  gmailNavigation.browser = {
    url: "https://mail.google.com/mail/u/0/#inbox",
    domain: "mail.google.com"
  };
  const episode = makeEpisode([gmailNavigation]);

  assert.throws(() => prepareEpisodeForInference(episode), /protected activity/);
  assert.equal(
    prepareEpisodeForInference(episode, { captureEmailActivity: true }),
    episode
  );
});

test("allows messaging at the final boundary only when capture is enabled", () => {
  const messagesTyping = event("messages", "text_input");
  messagesTyping.application = {
    bundleIdentifier: "com.apple.MobileSMS",
    localizedName: "Messages",
    processIdentifier: 42
  };
  messagesTyping.textChange = {
    insertedText: "Project update",
    deletedCharacterCount: 0,
    resultingValue: "Project update"
  };
  const episode = makeEpisode([messagesTyping]);

  assert.throws(() => prepareEpisodeForInference(episode), /protected activity/);
  assert.equal(
    prepareEpisodeForInference(episode, { captureMessagingActivity: true }),
    episode
  );
});

test("can disable inference and switch direct providers without exposing credentials", () => {
  const settings = {
    version: 1 as const,
    enabled: false,
    provider: "openai" as const,
    models: { apple: "system-default", openai: "gpt-5.6-luna", anthropic: "claude-sonnet-5", kimi: "kimi-k3" }
  };
  const service = new InferenceService({ apiKey: "sk-test-secret-that-is-long-enough", settings });
  assert.equal(service.configured, false);
  assert.match(service.unavailableMessage, /turned off/i);

  service.configure({ ...settings, enabled: true, provider: "anthropic" }, "sk-test-secret");
  assert.equal(service.configured, true);
  assert.equal(service.provider, "anthropic");
  assert.equal(service.model, "claude-sonnet-5");
});

test("retries malformed structured output once with a larger output budget", async () => {
  const budgets: number[] = [];
  const adapter = {
    provider: "openai" as const,
    model: "synthetic-openai",
    async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
      budgets.push(request.maxOutputTokens);
      if (budgets.length === 1) throw new InferenceOutputError("invalid_output");
      return request.schema.parse({ title: "Recovered summary" });
    }
  };
  const service = new InferenceService({
    apiKey: "synthetic-key",
    adapter,
    settings: {
      version: 1,
      enabled: true,
      provider: "openai",
      models: {
        apple: "system-default",
        openai: "synthetic-openai",
        anthropic: "synthetic-anthropic",
        kimi: "synthetic-kimi"
      }
    }
  });

  const result = await service.generateStructured({
    instructions: "Synthetic instructions",
    input: "Synthetic input",
    schema: z.object({ title: z.string() }),
    schemaName: "synthetic_entry",
    maxOutputTokens: 300
  });

  assert.deepEqual(result, { title: "Recovered summary" });
  assert.deepEqual(budgets, [300, 600]);
});

test("falls back when captured application names are blank", async () => {
  const adapter = {
    provider: "openai" as const,
    model: "synthetic-openai",
    async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
      return request.schema.parse({
        title: "Recovered local application metadata",
        description: "Created a timeline entry from locally captured activity.",
        workThreads: [],
        decisions: [],
        outcomes: [],
        blockers: [],
        surfaces: [],
        suggestion: null
      });
    }
  };
  const service = new InferenceService({
    apiKey: "synthetic-key",
    adapter,
    settings: {
      version: 1,
      enabled: true,
      provider: "openai",
      models: {
        apple: "system-default",
        openai: "synthetic-openai",
        anthropic: "synthetic-anthropic",
        kimi: "synthetic-kimi"
      }
    }
  });
  const episode = makeEpisode([event("blank-app", "application_activated")]);
  episode.applications = [
    { bundleIdentifier: "com.example.Editor", localizedName: "   ", processIdentifier: 42 },
    { bundleIdentifier: "   ", localizedName: "", processIdentifier: 43 }
  ];

  const result = await service.summarizeEpisode(episode);

  assert.deepEqual(result.applications, [
    { bundleIdentifier: "com.example.Editor", name: "com.example.Editor" },
    { bundleIdentifier: null, name: "Unknown application" }
  ]);
});

test("formats Apple episode evidence as a concise natural-language brief", () => {
  const changed = event("changed", "text_input");
  changed.textChange = {
    insertedText: "Drafted a local timeline requirement",
    deletedCharacterCount: 0,
    resultingValue: "Drafted a local timeline requirement"
  };
  const prompt = appleEpisodePrompt(makeEpisode([changed]));
  assert.match(prompt, /Write the work-history entry in English/);
  assert.match(prompt, /direct action; text input/);
  assert.match(prompt, /entered “Drafted a local timeline requirement”/);
  assert(!prompt.includes('"observations"'));
  assert(!prompt.includes("2026-08-14"));
  assert(prompt.length < 7_000);
});

test("samples busy semantic streams across the whole episode", () => {
  const events: ActivityEvent[] = Array.from({ length: 100 }, (_, index) => ({
    version: 1,
    id: `focus-${index}`,
    timestamp: new Date(Date.UTC(2026, 7, 14, 9, 0, index)).toISOString(),
    kind: "focused_element_changed",
    element: { role: "AXButton", title: `Control ${index}` }
  }));
  const episode: ActivityEpisode = {
    id: "busy",
    startTime: events[0]!.timestamp,
    endTime: events.at(-1)!.timestamp,
    events,
    applications: []
  };

  const sampled = eventsForModel(episode);
  assert.equal(sampled.length, 12);
  assert.equal(sampled[0]?.id, "focus-0");
  assert.equal(sampled.at(-1)?.id, "focus-99");
  assert(sampled.some((event) => Number(event.id.split("-")[1]) >= 45 && Number(event.id.split("-")[1]) <= 55));
});

test("normalizes legacy large replacements as document changes for the model", () => {
  const event: ActivityEvent = {
    version: 1,
    id: "legacy-note-switch",
    timestamp: "2026-08-14T09:00:00Z",
    kind: "text_input",
    textChange: {
      insertedText: "A different short note",
      deletedCharacterCount: 1_182,
      resultingValue: "A different short note"
    }
  };
  assert.equal(semanticKindForModel(event), "document_changed");
});

test("omits focus context when stronger direct actions are available", () => {
  const focus = event("focus-1", "focused_element_changed");
  focus.element = { role: "AXButton", title: "Save" };
  const duplicateFocus = { ...focus, id: "focus-2" };
  const click = event("click-1", "pointer_click");
  click.element = { role: "AXButton", title: "Save" };
  const duplicateClick = { ...click, id: "click-2" };
  const episode = makeEpisode([focus, duplicateFocus, click, duplicateClick]);

  assert.deepEqual(eventsForModel(episode).map(({ id }) => id), ["click-1", "click-2"]);
});

test("adds deterministic evidence counts and an ordered semantic sequence", () => {
  const episode = makeEpisode([
    event("focus", "focused_element_changed"),
    event("typing", "text_input"),
    event("navigation", "url_changed")
  ]);
  const modelInput = episodeForModel(episode) as {
    evidenceSummary: {
      directActionCount: number;
      navigationCount: number;
      contextCount: number;
      contentChangeCount: number;
      summaryMode: string;
      sequence: Array<{ kind: string }>;
    };
  };
  assert.equal(modelInput.evidenceSummary.directActionCount, 1);
  assert.equal(modelInput.evidenceSummary.navigationCount, 1);
  assert.equal(modelInput.evidenceSummary.contextCount, 0);
  assert.equal(modelInput.evidenceSummary.contentChangeCount, 1);
  assert.equal(modelInput.evidenceSummary.summaryMode, "standard");
  assert.deepEqual(modelInput.evidenceSummary.sequence.map(({ kind }) => kind), [
    "text_input", "url_changed"
  ]);
  assert(!JSON.stringify(modelInput).includes("com.example.Editor"));
});

test("builds the promoted hybrid history input without absolute timestamps", () => {
  const changed = event("changed", "text_input");
  changed.textChange = {
    insertedText: "Draft local agent access requirements",
    deletedCharacterCount: 0,
    resultingValue: "Draft local agent access requirements"
  };
  const input = episodeForHybridModel(makeEpisode([changed])) as {
    startTime?: string;
    endTime?: string;
    observations: Array<{ timestamp?: string }>;
    semanticGuide: { workUnits: Array<{ claimCeiling: string }> };
  };

  assert.equal(input.startTime, undefined);
  assert.equal(input.endTime, undefined);
  assert.equal(input.observations[0]!.timestamp, undefined);
  assert.equal(input.semanticGuide.workUnits[0]!.claimCeiling, "draft_or_revision");
});

test("marks brief interaction-only episodes for literal summarization", () => {
  const opened = event("opened", "application_activated");
  opened.timestamp = "2026-08-14T09:00:00Z";
  const selected = event("selected", "pointer_click");
  selected.timestamp = "2026-08-14T09:00:09Z";
  selected.element = { role: "AXButton", title: "Today August 14th" };

  const modelInput = episodeForModel(makeEpisode([opened, selected])) as {
    evidenceSummary: { durationSeconds: number; contentChangeCount: number; summaryMode: string };
  };
  assert.equal(modelInput.evidenceSummary.durationSeconds, 9);
  assert.equal(modelInput.evidenceSummary.contentChangeCount, 0);
  assert.equal(modelInput.evidenceSummary.summaryMode, "sparse_literal");
});

test("marks passive snapshots as context only rather than user activity", () => {
  const opened = event("opened", "application_activated");
  opened.timestamp = "2026-08-14T09:00:00Z";
  const snapshot = event("snapshot", "ui_snapshot");
  snapshot.timestamp = "2026-08-14T09:00:10Z";
  snapshot.windowTitle = "Login Window";

  const modelInput = episodeForModel(makeEpisode([opened, snapshot])) as {
    evidenceSummary: { directActionCount: number; navigationCount: number; summaryMode: string };
  };
  assert.equal(modelInput.evidenceSummary.directActionCount, 0);
  assert.equal(modelInput.evidenceSummary.navigationCount, 0);
  assert.equal(modelInput.evidenceSummary.summaryMode, "context_only");
});

test("does not apply sparse literal mode when content changed", () => {
  const opened = event("opened", "application_activated");
  opened.timestamp = "2026-08-14T09:00:00Z";
  const typed = event("typed", "text_input");
  typed.timestamp = "2026-08-14T09:00:09Z";
  typed.textChange = { insertedText: "Set the gutter to 12px", deletedCharacterCount: 0, resultingValue: "Set the gutter to 12px" };

  const modelInput = episodeForModel(makeEpisode([opened, typed])) as {
    evidenceSummary: { contentChangeCount: number; summaryMode: string };
  };
  assert.equal(modelInput.evidenceSummary.contentChangeCount, 1);
  assert.equal(modelInput.evidenceSummary.summaryMode, "standard");
});

test("provides a direct-action surface checklist without promoting passive context", () => {
  const edited = event("edited", "text_input");
  edited.timestamp = "2026-08-14T09:00:00Z";
  edited.document = { displayPath: "notes.md", name: "notes.md", fileExtension: "md" };
  edited.textChange = { insertedText: "Updated copy", deletedCharacterCount: 0, resultingValue: "Updated copy" };

  const navigated = event("navigated", "url_changed");
  navigated.timestamp = "2026-08-14T09:01:00Z";
  navigated.application = {
    bundleIdentifier: "com.example.Browser",
    localizedName: "Browser",
    processIdentifier: 43
  };
  navigated.browser = { url: "https://example.test/release", domain: "example.test", title: "Release notes" };

  const passive = event("passive", "focused_element_changed");
  passive.timestamp = "2026-08-14T09:02:00Z";
  passive.application = {
    bundleIdentifier: "com.example.Notes",
    localizedName: "Notes",
    processIdentifier: 44
  };
  passive.windowTitle = "Unrelated note";

  const modelInput = episodeForModel(makeEpisode([edited, navigated, passive])) as {
    evidenceSummary: {
      actionSurfaces: Array<{
        application: string;
        surface?: string;
        directActionCount: number;
        navigationCount: number;
        contentChangeCount: number;
      }>;
    };
  };
  assert.deepEqual(modelInput.evidenceSummary.actionSurfaces, [
    {
      application: "Editor",
      surface: "notes.md",
      directActionCount: 1,
      navigationCount: 0,
      contentChangeCount: 1
    },
    {
      application: "Browser",
      surface: "Release notes",
      directActionCount: 0,
      navigationCount: 1,
      contentChangeCount: 0
    }
  ]);
});

test("builds compact deterministic day evidence without timeline identifiers", () => {
  const item = {
    version: 1 as const,
    id: "opaque-provenance-id",
    startTime: "2026-08-14T09:00:00Z",
    endTime: "2026-08-14T09:12:00Z",
    title: "Work",
    description: "Worked locally.",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Core"],
    decisions: ["Keep evidence local"],
    outcomes: ["Built fixture"],
    blockers: [],
    surfaces: [],
    links: [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }],
    suggestion: null
  };
  assert.deepEqual(dailyEvidenceSummary([item]), {
    timelineEntryCount: 1,
    observedDurationMinutes: 12,
    applications: [{ name: "Editor", entryCount: 1 }],
    decisionCount: 1,
    outcomeCount: 1,
    blockerCount: 0
  });
  assert(!JSON.stringify(dailyEvidenceSummary([item])).includes(item.id));
});

test("builds the promoted metadata-free semantic hour input", () => {
  const item = {
    version: 1 as const,
    id: "opaque-provenance-id",
    startTime: "2026-08-14T09:00:00Z",
    endTime: "2026-08-14T09:12:00Z",
    title: "Drafted local access requirements",
    description: "Drafted an MCP setup request without implementing it.",
    applications: [{ bundleIdentifier: "com.openai.chat", name: "ChatGPT" }],
    workThreads: ["Local agent access"],
    decisions: ["Keep credentials out of URLs"],
    outcomes: [],
    blockers: [],
    surfaces: [],
    links: [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }],
    suggestion: null
  };
  const input = hourForHybridModel([item]);
  const serialized = JSON.stringify(input);
  assert(!serialized.includes(item.id));
  assert(!serialized.includes(item.startTime));
  assert(!serialized.includes("ChatGPT"));
  assert.match(serialized, /priorHourContextOnly/);
  assert.match(serialized, /Keep credentials out of URLs/);
  assert.match(serialized, /Pull Request #4/);
  assert.doesNotMatch(serialized, /https:\/\//);

  const apple = appleSemanticHourPrompt([item]);
  assert.doesNotMatch(apple, /2026-08-14|opaque-provenance-id/);
  assert.match(apple, /Supported decisions or requests/);
  assert.match(apple, /link-1: “Pull Request #4” \(github\.com\)/);
  assert.doesNotMatch(apple, /https:\/\//);
  assert.match(apple, /prior hour is context only/i);
});

test("builds the promoted metadata-free Apple daily input", () => {
  const item = {
    version: 1 as const,
    id: "opaque-session-id",
    startTime: "2026-08-14T09:00:00Z",
    endTime: "2026-08-14T09:12:00Z",
    title: "Drafted timeline requirements",
    description: "Drafted an expandable timeline request without implementing it.",
    applications: [{ bundleIdentifier: "com.openai.chat", name: "ChatGPT" }],
    workThreads: ["Timeline design"],
    decisions: [],
    outcomes: [],
    blockers: [],
    surfaces: [],
    links: [{ label: "Pull Request #4", url: "https://github.com/example/openhistory/pull/4" }],
    suggestion: null
  };
  const prompt = appleSemanticDailyRollupPrompt([], [item]);
  assert.doesNotMatch(prompt, /opaque-session-id|2026-08-14|ChatGPT/);
  assert.match(prompt, /Prior draft context only:\nnone/);
  assert.match(prompt, /Current sessions not represented by an hour/);
  assert.match(prompt, /link-1: “Pull Request #4” \(github\.com\)/);
  assert.doesNotMatch(prompt, /https:\/\//);
  assert.match(prompt, /never turn drafted requests into completed accomplishments/i);
});

function event(id: string, kind: ActivityEvent["kind"]): ActivityEvent {
  return {
    version: 1,
    id,
    timestamp: `2026-08-14T09:00:0${id.length % 10}Z`,
    kind,
    application: {
      bundleIdentifier: "com.example.Editor",
      localizedName: "Editor",
      processIdentifier: 42
    }
  };
}

function makeEpisode(events: ActivityEvent[]): ActivityEpisode {
  return {
    id: "fixture",
    startTime: events[0]!.timestamp,
    endTime: events.at(-1)!.timestamp,
    events,
    applications: []
  };
}
