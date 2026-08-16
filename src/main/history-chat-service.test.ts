import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProjectionStore } from "./agent-projection";
import { HistoryChatService } from "./history-chat-service";
import type { InferenceService } from "./inference/service";
import type { RecentActivitySource } from "./unsummarized-activity";

test("uses the shared history search tool before answering", async () => {
  const searches: unknown[] = [];
  const projection = {
    search: (options: unknown) => {
      searches.push(options);
      return [{ title: "Built the prototype", date: "2026-08-14" }];
    }
  } as unknown as AgentProjectionStore;
  const actions = [
    {
      tool: "search_history",
      query: "prototype",
      date: null,
      id: null,
      from: null,
      to: null,
      limit: 5,
      answer: null
    },
    {
      tool: "answer",
      query: null,
      date: null,
      id: null,
      from: null,
      to: null,
      limit: null,
      answer: "You built the prototype on August 14."
    }
  ];
  const inference = {
    provider: "openai",
    generateStructured: async () => actions.shift()
  } as unknown as InferenceService;

  const response = await new HistoryChatService(projection, inference).reply([
    { role: "user", content: "When did I build the prototype?" }
  ]);

  assert.deepEqual(searches, [{ query: "prototype", limit: 5 }]);
  assert.deepEqual(response.toolsUsed, ["search_history"]);
  assert.equal(response.answer, "You built the prototype on August 14.");
});

test("turns the yesterday starter into a standup-ready day lookup", async () => {
  const requestedDates: string[] = [];
  const projection = {
    getDay: (date: string) => {
      requestedDates.push(date);
      return { date, timeline: [] };
    }
  } as unknown as AgentProjectionStore;
  const inference = {
    provider: "openai",
    generateStructured: async () => ({
      tool: "answer",
      query: null,
      date: null,
      id: null,
      from: null,
      to: null,
      limit: null,
      answer: "Progress\n- Reviewed the prototype."
    })
  } as unknown as InferenceService;

  const response = await new HistoryChatService(projection, inference).reply([
    { role: "user", content: "Summarize my work yesterday" }
  ]);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const expectedDate = [
    yesterday.getFullYear(),
    String(yesterday.getMonth() + 1).padStart(2, "0"),
    String(yesterday.getDate()).padStart(2, "0")
  ].join("-");

  assert.deepEqual(requestedDates, [expectedDate]);
  assert.deepEqual(response.toolsUsed, ["get_day"]);
  assert.match(response.answer, /Progress/);
});

test("lets chat inspect recent activity that has not been summarized", async () => {
  const requestedWindows: number[] = [];
  const unsummarizedActivity = {
    getRecent: (minutes: number) => {
      requestedWindows.push(minutes);
      return {
        events: [{ timestamp: "2026-08-15T20:00:00.000Z", kind: "text_input" }],
        submissionActions: [],
        totalAvailable: 1,
        totalInWindow: 1,
        windowMinutes: minutes,
        windowStartedAt: "2026-08-15T19:50:00.000Z",
        timeZone: "America/Los_Angeles",
        truncated: false
      };
    }
  } satisfies RecentActivitySource;
  const actions = [
    {
      tool: "get_recent_activity",
      query: null,
      date: null,
      id: null,
      from: null,
      to: null,
      limit: null,
      minutes: null,
      answer: null
    },
    {
      tool: "answer",
      query: null,
      date: null,
      id: null,
      from: null,
      to: null,
      limit: null,
      answer: "Your newest unsummarized activity was a text edit."
    }
  ];
  const inference = {
    provider: "openai",
    generateStructured: async () => actions.shift()
  } as unknown as InferenceService;

  const response = await new HistoryChatService(
    {} as AgentProjectionStore,
    inference,
    unsummarizedActivity
  ).reply([{ role: "user", content: "What do my unsummarized logs show?" }]);

  assert.deepEqual(requestedWindows, [10]);
  assert.deepEqual(response.toolsUsed, ["get_recent_activity"]);
  assert.equal(response.answer, "Your newest unsummarized activity was a text edit.");
});

test("routes explicit minute-window questions directly to recent activity", async () => {
  const requestedWindows: number[] = [];
  const recentActivity = {
    getRecent: (minutes: number) => {
      requestedWindows.push(minutes);
      return {
        events: [{
          timestamp: "2026-08-16T04:56:01.000Z",
          localTime: "Aug 15, 2026, 9:56:01 PM",
          kind: "pointer_click",
          element: { role: "AXButton", label: "Send and archive" }
        }],
        submissionActions: [{
          timestamp: "2026-08-16T04:56:01.000Z",
          localTime: "Aug 15, 2026, 9:56:01 PM",
          verb: "Sent",
          control: "Send and archive",
          application: "Google Chrome"
        }],
        totalAvailable: 100,
        totalInWindow: 1,
        windowMinutes: minutes,
        windowStartedAt: "2026-08-16T04:38:00.000Z",
        timeZone: "America/Los_Angeles",
        truncated: false
      };
    }
  } satisfies RecentActivitySource;
  let generations = 0;
  const inference = {
    provider: "openai",
    generateStructured: async () => {
      generations += 1;
      return {
        tool: "answer",
        query: null,
        date: null,
        id: null,
        from: null,
        to: null,
        limit: null,
        minutes: null,
        answer: "You clicked Send and archive on a Gmail reply at 9:56 PM."
      };
    }
  } as unknown as InferenceService;

  const response = await new HistoryChatService(
    {} as AgentProjectionStore,
    inference,
    recentActivity
  ).reply([{ role: "user", content: "What email activity have I had in the past 45mins?" }]);

  assert.deepEqual(requestedWindows, [45]);
  assert.equal(generations, 1);
  assert.deepEqual(response.toolsUsed, ["get_recent_activity"]);
  assert.match(response.answer, /Send and archive/);
  assert.match(response.answer, /9:56 PM/);
});
