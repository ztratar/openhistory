import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProjectionStore } from "./agent-projection";
import { HistoryChatService, isSubstantiveAnswer, isWholeDayRequest, referencedDate } from "./history-chat-service";
import type { InferenceService } from "./inference/service";
import type { RecentActivitySource } from "./unsummarized-activity";

const NOW = new Date(2026, 9, 26, 15, 30);
const unusedInference = {
  provider: "local",
  generateStructured: async () => {
    throw new Error("whole-day answers must not call the model");
  }
} as unknown as InferenceService;

function rollup(date: string) {
  return {
    id: date,
    date,
    title: "Shipped the local provider",
    summary: "Built and tested the oMLX provider.",
    themes: ["Local inference"],
    accomplishments: ["Revoked old API keys", "Benchmarked Qwen 4B"],
    decisions: ["Keep Docker running"],
    unfinishedWork: ["Fix chat"],
    recurringPatterns: [],
    sourceTimelineIds: ["a"],
    updatedAt: `${date}T18:00:00.000Z`
  };
}

function action(overrides: Record<string, unknown>) {
  return {
    tool: "answer",
    query: null,
    date: null,
    id: null,
    from: null,
    to: null,
    limit: null,
    minutes: null,
    answer: null,
    ...overrides
  };
}

test("answers whole-day requests from the saved daily rollup without a model pass", async () => {
  const requestedDates: string[] = [];
  const projection = {
    getDay: (date: string) => {
      requestedDates.push(date);
      return { date, dailyRollup: rollup(date), timeline: [{}, {}] };
    }
  } as unknown as AgentProjectionStore;
  const chat = new HistoryChatService(projection, unusedInference, undefined, () => NOW);

  for (const content of [
    "summarize my work yesterday",
    "Summarize my work on 2026-10-25",
    "what did I do on Oct 25?"
  ]) {
    const response = await chat.reply([{ role: "user", content }]);
    assert.deepEqual(response.toolsUsed, ["get_day"]);
    assert.match(response.answer, /Shipped the local provider/);
    assert.match(response.answer, /- Revoked old API keys/);
    assert.match(response.answer, /- Keep Docker running/);
  }
  assert.deepEqual(requestedDates, ["2026-10-25", "2026-10-25", "2026-10-25"]);

  const yesterday = await chat.reply([{ role: "user", content: "summarize my work yesterday" }]);
  assert.match(yesterday.answer, /yesterday \(Sunday, October 25\)/);
  assert.doesNotMatch(yesterday.answer, /today/i);
});

test("falls back to timeline entries when the day has no rollup yet", async () => {
  const projection = {
    getDay: (date: string) => ({
      date,
      timeline: [{
        id: "1",
        startTime: "2026-10-26T09:00:00.000Z",
        endTime: "2026-10-26T09:10:00.000Z",
        title: "Reviewed backlog",
        description: "Ordered enhancements.",
        applications: [],
        workThreads: [],
        decisions: [],
        outcomes: [],
        blockers: [],
        surfaces: [],
        evidenceEventCount: 3
      }]
    })
  } as unknown as AgentProjectionStore;
  const response = await new HistoryChatService(projection, unusedInference, undefined, () => NOW)
    .reply([{ role: "user", content: "what have I done today?" }]);
  assert.match(response.answer, /Reviewed backlog/);
  assert.match(response.answer, /daily summary for today/);
});

test("explains today's pending summaries using recent raw activity", async () => {
  const projection = {
    getDay: (date: string) => ({ date, timeline: [] })
  } as unknown as AgentProjectionStore;
  const recent = {
    getRecent: (minutes: number) => ({
      events: [{ application: "Safari" }, { application: "Safari" }, { application: "Terminal" }],
      submissionActions: [],
      totalAvailable: 3,
      totalInWindow: 3,
      windowMinutes: minutes,
      windowStartedAt: "2026-10-26T14:30:00.000Z",
      timeZone: "Europe/Lisbon",
      truncated: false
    })
  } satisfies RecentActivitySource;
  const response = await new HistoryChatService(projection, unusedInference, recent, () => NOW)
    .reply([{ role: "user", content: "what have i done today?" }]);
  assert.match(response.answer, /hasn't been summarized yet/);
  assert.match(response.answer, /Safari: 2 events/);
});

test("fills a missing get_day date from the question instead of failing", async () => {
  const requestedDates: string[] = [];
  const projection = {
    getDay: (date: string) => {
      requestedDates.push(date);
      return { date, timeline: [] };
    }
  } as unknown as AgentProjectionStore;
  const actions = [
    action({ tool: "get_day", query: "today" }),
    action({ answer: "You had no blockers recorded yesterday." })
  ];
  const inference = {
    provider: "local",
    generateStructured: async () => actions.shift()
  } as unknown as InferenceService;
  const response = await new HistoryChatService(projection, inference, undefined, () => NOW)
    .reply([{ role: "user", content: "any blockers yesterday?" }]);
  assert.deepEqual(requestedDates, ["2026-10-25"]);
  assert.equal(response.answer, "You had no blockers recorded yesterday.");
});

test("retries once when the model returns only headings", async () => {
  const projection = { search: () => [{ title: "Prototype" }] } as unknown as AgentProjectionStore;
  const answers = [
    "Here is a summary of your work, organized by category:\n**Progress** -\n**Decisions** -",
    "You built the prototype and fixed the chat retry on Monday."
  ];
  let calls = 0;
  const inference = {
    provider: "local",
    generateStructured: async () => {
      calls += 1;
      if (calls === 1) return action({ tool: "search_history", query: "prototype", limit: 5 });
      return action({ answer: answers.shift() });
    }
  } as unknown as InferenceService;
  const response = await new HistoryChatService(projection, inference, undefined, () => NOW)
    .reply([{ role: "user", content: "when did I build the prototype?" }]);
  assert.equal(calls, 3);
  assert.match(response.answer, /built the prototype/);
});

test("date helpers resolve references and detect heading-only answers", () => {
  assert.equal(referencedDate("what about yesterday", NOW), "2026-10-25");
  assert.equal(referencedDate("so far today", NOW), "2026-10-26");
  assert.equal(referencedDate("on Oct 25th", NOW), "2026-10-25");
  assert.equal(referencedDate("on Dec 3", NOW), "2025-12-03");
  assert.equal(referencedDate("2026-02-30", NOW), undefined);
  assert.equal(referencedDate("when did I build it", NOW), undefined);
  assert.equal(isWholeDayRequest("what have I done today?"), true);
  assert.equal(isWholeDayRequest("what have I done so far today?"), true);
  assert.equal(isWholeDayRequest("Please give me a summary of my day yesterday"), true);
  assert.equal(isWholeDayRequest("summary of yesterday"), true);
  assert.equal(isWholeDayRequest("Summarize my work on 2026-10-25"), true);
  for (const scoped of [
    "what did I do yesterday morning?",
    "summarize my decisions yesterday",
    "what did I do yesterday in Safari?",
    "summarize my meetings yesterday",
    "summarize my coding yesterday",
    "summarize my email work yesterday",
    "summarize my work from 9 to 10 yesterday",
    "summarize my migration project yesterday",
    "any blockers yesterday?"
  ]) assert.equal(isWholeDayRequest(scoped), false, scoped);
  assert.equal(isSubstantiveAnswer("Here is a summary of your work today, organized by category:"), false);
  assert.equal(isSubstantiveAnswer("**Progress** -\n**Decisions** -"), false);
  assert.equal(isSubstantiveAnswer("- Revoked the OpenAI keys and tested Time Machine speed."), true);
});
