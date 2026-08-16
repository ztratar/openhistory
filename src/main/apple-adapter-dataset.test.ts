import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityEpisode, ActivityEvent, TimelineItem } from "@shared/contracts";
import {
  appleAdapterDatasetDigest,
  appleAdapterJsonLine,
  buildAppleTimelineAdapterDataset
} from "./apple-adapter-dataset";

test("exports deterministic, disjoint 100-train and 27-eval timeline examples", () => {
  const fixtures = Array.from({ length: 130 }, (_value, index) => fixture(index));
  const input = {
    timeline: fixtures.map(({ item }) => item),
    episodes: fixtures.map(({ episode }) => episode)
  };
  const first = buildAppleTimelineAdapterDataset(input.timeline, input.episodes);
  const second = buildAppleTimelineAdapterDataset(
    [...input.timeline].reverse(),
    [...input.episodes].reverse()
  );

  assert.equal(first.train.length, 100);
  assert.equal(first.eval.length, 27);
  assert.equal(first.eligibleCount, 130);
  assert.equal(first.omittedEligibleCount, 3);
  assert.equal(first.reconstructedEpisodeCount, 0);
  assert.equal(new Set([...first.train, ...first.eval].map(({ id }) => id)).size, 127);
  assert.deepEqual(first, second);
  assert.equal(
    new Set(first.train.flatMap(({ sourceEventIds }) => sourceEventIds)
      .filter((id) => new Set(first.eval.flatMap(({ sourceEventIds }) => sourceEventIds)).has(id))).size,
    0
  );
  assert.equal(appleAdapterDatasetDigest(first.train), appleAdapterDatasetDigest(second.train));
});

test("serializes instructions, compact evidence, and only title/description labels", () => {
  const fixtures = [fixture(1), fixture(2)];
  const split = buildAppleTimelineAdapterDataset(
    fixtures.map(({ item }) => item),
    fixtures.map(({ episode }) => episode),
    { trainSize: 1, evalSize: 1 }
  );
  const messages = JSON.parse(appleAdapterJsonLine(split.train[0]!)) as Array<{
    role: string;
    content: string;
  }>;
  const system = messages[0];
  const user = messages[1];
  const assistant = messages[2];
  assert.ok(system);
  assert.ok(user);
  assert.ok(assistant);

  assert.deepEqual(messages.map(({ role }) => role), ["system", "user", "assistant"]);
  assert.match(system.content, /^A conversation between a user and a helpful assistant\./);
  assert.match(system.content, /Summarize a short activity episode/);
  assert.doesNotMatch(user.content, /Summarize a short activity episode/);
  assert.match(assistant.content, /^\{"title": .+, "description": .+\}$/);
  assert.deepEqual(JSON.parse(assistant.content), {
    title: split.train[0]!.id.includes("episode-1") ? "Drafted item 1" : "Drafted item 2",
    description: split.train[0]!.id.includes("episode-1") ? "Drafted synthetic item 1." : "Drafted synthetic item 2."
  });
  assert.doesNotMatch(assistant.content, /workThreads|decisions|outcomes|surfaces/);
});

test("reconstructs a provenance-complete example when segmenter identity has changed", () => {
  const { item, episode } = fixture(1);
  const second = fixture(2);
  const split = buildAppleTimelineAdapterDataset(
    [item, second.item],
    [second.episode],
    {
      trainSize: 1,
      evalSize: 1,
      sourceEvents: [...episode.events, ...second.episode.events]
    }
  );

  assert.equal(split.eligibleCount, 2);
  assert.equal(split.reconstructedEpisodeCount, 1);
});

test("rejects an undersized source-backed corpus", () => {
  const { item, episode } = fixture(1);
  assert.throws(
    () => buildAppleTimelineAdapterDataset([item], [episode], { trainSize: 1, evalSize: 1 }),
    /needs 2 source-backed examples; only 1/
  );
});

function fixture(index: number): { item: TimelineItem; episode: ActivityEpisode } {
  const timestamp = new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString();
  const event: ActivityEvent = {
    version: 1,
    id: `event-${index}`,
    timestamp,
    kind: "text_input",
    textChange: {
      insertedText: `synthetic ${index}`,
      deletedCharacterCount: 0,
      resultingValue: `synthetic ${index}`
    }
  };
  const episode: ActivityEpisode = {
    id: `episode-${index}`,
    startTime: timestamp,
    endTime: timestamp,
    events: [event],
    applications: []
  };
  return {
    episode,
    item: {
      version: 1,
      id: episode.id,
      startTime: timestamp,
      endTime: timestamp,
      title: `Drafted item ${index}`,
      description: `Drafted synthetic item ${index}.`,
      applications: [],
      workThreads: ["Synthetic adapter export"],
      decisions: [],
      outcomes: [],
      blockers: [],
      surfaces: [],
      suggestion: null,
      sourceEventIds: [event.id]
    }
  };
}
