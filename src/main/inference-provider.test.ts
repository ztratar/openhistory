import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  AppleFoundationModelProvider,
  minimalAppleInput,
  normalizeAppleOutput,
  reducedAppleInput,
  type AppleWorkerResponse
} from "./inference/providers/apple";

test("preserves Apple refusal fallback ordering and worker request fields", async () => {
  const calls: object[] = [];
  const responses: AppleWorkerResponse[] = [
    { ok: false, reason: "unsupportedLanguageOrLocale" },
    { ok: false, reason: "guardrailViolation" },
    { ok: true, output: JSON.stringify({ title: "Drafted local timeline", description: "Drafted a timeline requirement." }) }
  ];
  const provider = new AppleFoundationModelProvider(
    "system-default",
    "/synthetic/foundation-model-worker",
    async (_executable, request) => {
      calls.push(request);
      return responses.shift()!;
    }
  );
  const schema = z.object({
    title: z.string(),
    description: z.string(),
    suggestion: z.null()
  });

  const result = await provider.generate({
    instructions: "Synthetic instructions",
    input: "Evidence follows.\n{\"insertedText\":\"private draft\",\"surface\":\"Timeline\"}",
    schema,
    schemaName: "timeline_entry_compact",
    maxOutputTokens: 550
  });

  assert.equal(result.title, "Drafted local timeline");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], {
    operation: "timeline_entry_compact",
    instructions: "Synthetic instructions",
    input: "Evidence follows.\n{\"insertedText\":\"private draft\",\"surface\":\"Timeline\"}",
    maximumResponseTokens: 550
  });
  assert.match((calls[1] as { input: string }).input, /^Reduced evidence JSON follows/);
  assert.match((calls[2] as { input: string }).input, /^Metadata-only evidence follows/);
});

test("keeps Apple fallback inputs bounded and removes detailed content", () => {
  const detailed = JSON.stringify({
    insertedText: "a private draft",
    resultingValue: "a private final value",
    surface: "Timeline settings",
    nested: Array.from({ length: 10 }, (_, index) => ({ title: `Item ${index}` }))
  });
  const reduced = reducedAppleInput(detailed);
  assert.doesNotMatch(reduced, /private draft|private final value/);
  assert.match(reduced, /Timeline settings/);
  assert(!reduced.includes("Item 9"));

  const minimal = minimalAppleInput("Surface: Timeline\nentered “a private draft value”\nPassword token visible\nClicked Save");
  assert.match(minimal, /Surface: Timeline/);
  assert.match(minimal, /Clicked Save/);
  assert.doesNotMatch(minimal, /private draft|Password token/);
});

test("passes an explicitly configured Foundation Models adapter to every worker attempt", async () => {
  const calls: object[] = [];
  const provider = new AppleFoundationModelProvider(
    "system-default",
    "/synthetic/foundation-model-worker",
    async (_executable, request) => {
      calls.push(request);
      return { ok: true, output: JSON.stringify({ title: "Drafted local timeline", description: "Drafted locally." }) };
    },
    "/private/tmp/openhistory.fmadapter"
  );
  const result = await provider.generate({
    instructions: "Synthetic instructions",
    input: "Synthetic evidence",
    schema: z.object({ title: z.string(), description: z.string(), suggestion: z.null() }),
    schemaName: "timeline_entry_compact",
    maxOutputTokens: 550
  });

  assert.equal(result.title, "Drafted local timeline");
  assert.equal((calls[0] as { adapterPath: string }).adapterPath, "/private/tmp/openhistory.fmadapter");
});

test("normalizes Apple bullets and timeline suggestion without changing supported text", () => {
  assert.deepEqual(normalizeAppleOutput("hour_rollup_compact", {
    title: "Revised timeline behavior",
    summary: "Revised hour expansion\n• Preserved history ordering",
    workThreads: []
  }), {
    title: "Revised timeline behavior",
    summary: "- Revised hour expansion\n- Preserved history ordering",
    workThreads: []
  });

  assert.deepEqual(normalizeAppleOutput("timeline_entry_compact", {
    title: "Drafted timeline request",
    description: "Drafted a request without claiming implementation."
  }), {
    title: "Drafted timeline request",
    description: "Drafted a request without claiming implementation.",
    suggestion: null
  });
});

test("bounds compact hour and day summaries after adding bullet prefixes", () => {
  const day = normalizeAppleOutput("daily_rollup_compact", {
    title: "Summarized synthetic day",
    summary: "x".repeat(1_300)
  }) as { summary: string };
  const hour = normalizeAppleOutput("hour_rollup_compact", {
    title: "Summarized synthetic hour",
    summary: "x".repeat(1_100)
  }) as { summary: string };

  assert(day.summary.startsWith("- "));
  assert(day.summary.length <= 1_200);
  assert(hour.summary.startsWith("- "));
  assert(hour.summary.length <= 1_000);
});
