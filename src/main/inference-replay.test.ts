import type { ActivityEpisode, HourItem, DailyRollupItem, TimelineItem } from "@shared/contracts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type {
  InferenceProviderAdapter,
  StructuredGenerationRequest
} from "./inference/contracts";
import { InferenceService } from "./openai-service";

interface ReplayFixture {
  episode: ActivityEpisode;
  timelineItems: TimelineItem[];
  lastHour: HourItem;
  currentHour: HourItem;
  existingDailyRollup: DailyRollupItem;
  replayOutputs: Record<string, unknown>;
}

const fixture = JSON.parse(readFileSync(resolve(
  import.meta.dirname,
  "../../fixtures/inference/preservation-v1.json"
), "utf8")) as ReplayFixture;

class ReplayProvider implements InferenceProviderAdapter {
  readonly provider = "apple" as const;
  readonly model = "system-default";
  readonly requests: Array<{ schemaName: string; input: string }> = [];

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    this.requests.push({ schemaName: request.schemaName, input: request.input });
    return request.schema.parse(fixture.replayOutputs[request.schemaName]);
  }
}

test("replays timeline, hour, and day outputs through the stable inference facade", async () => {
  const adapter = new ReplayProvider();
  const service = new InferenceService({
    settings: {
      version: 1,
      enabled: true,
      provider: "apple",
      models: { apple: "system-default", openai: "unused", anthropic: "unused", kimi: "unused" }
    },
    adapter
  });

  const timeline = await service.summarizeEpisode(fixture.episode);
  assert.equal(timeline.title, "Drafted expandable timeline specification");
  assert.deepEqual(timeline.sourceEventIds, fixture.episode.events.map(({ id }) => id));

  const hour = await service.consolidateHour(
    fixture.currentHour.startTime,
    fixture.currentHour.endTime,
    fixture.timelineItems,
    fixture.lastHour
  );
  assert.equal(hour.title, "Drafted and verified timeline fixtures");
  assert.deepEqual(hour.links, [{
    label: "Pull Request #4",
    url: "https://github.com/example/openhistory/pull/4"
  }]);
  assert.deepEqual(hour.sourceTimelineIds, fixture.timelineItems.map(({ id }) => id).sort());

  const day = await service.consolidateDailyRollup(
    fixture.existingDailyRollup.date,
    fixture.timelineItems,
    fixture.existingDailyRollup,
    [fixture.currentHour]
  );
  assert.equal(day.title, "Prepared inference preservation fixtures");
  assert.deepEqual(day.links, hour.links);
  assert.deepEqual(day.sourceTimelineIds, fixture.timelineItems.map(({ id }) => id).sort());
  assert.deepEqual(adapter.requests.map(({ schemaName }) => schemaName), [
    "timeline_entry_compact",
    "hour_rollup_compact",
    "daily_rollup_compact"
  ]);
  assert.match(adapter.requests[1]!.input, /Prior hour context only/);
  assert.match(adapter.requests[1]!.input, /link-1: “Pull Request #4” \(github\.com\)/);
  assert.doesNotMatch(adapter.requests[1]!.input, /https:\/\//);
  assert.match(adapter.requests[2]!.input, /Current sessions not represented by an hour/);
  assert.match(adapter.requests[2]!.input, /link-1: “Pull Request #4” \(github\.com\)/);
  assert.doesNotMatch(adapter.requests[2]!.input, /https:\/\//);
});
