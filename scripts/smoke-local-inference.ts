/**
 * Live smoke test for the local OpenAI-compatible provider using the public synthetic
 * preservation fixture. Usage:
 *   LOCAL_INFERENCE_BASE_URL=http://127.0.0.1:8080/v1 LOCAL_INFERENCE_MODEL=<id> \
 *     node --import tsx scripts/smoke-local-inference.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LOCAL_INFERENCE_BASE_URL, DEFAULT_LOCAL_INFERENCE_MODEL } from "../src/shared/inference";
import { InferenceService } from "../src/main/inference/service";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/inference/preservation-v1.json"), "utf8"));
const service = new InferenceService({
  settings: {
    version: 1,
    enabled: true,
    provider: "local",
    models: {
      apple: "system-default",
      local: process.env.LOCAL_INFERENCE_MODEL?.trim() || DEFAULT_LOCAL_INFERENCE_MODEL,
      openai: "unused",
      anthropic: "unused",
      kimi: "unused"
    },
    localBaseUrl: process.env.LOCAL_INFERENCE_BASE_URL?.trim() || DEFAULT_LOCAL_INFERENCE_BASE_URL
  }
});
if (!service.configured) throw new Error(service.unavailableMessage);

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await run();
  console.log(`\n=== ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(result, null, 2).slice(0, 1500));
  return result;
}

await timed("timeline entry", () => service.summarizeEpisode(fixture.episode));
const hour = await timed("hour rollup", () => service.consolidateHour(
  fixture.currentHour.startTime,
  fixture.currentHour.endTime,
  fixture.timelineItems,
  fixture.lastHour
));
await timed("daily rollup", () => service.consolidateDailyRollup(
  fixture.existingDailyRollup.date,
  fixture.timelineItems,
  fixture.existingDailyRollup,
  [fixture.lastHour, hour]
));
