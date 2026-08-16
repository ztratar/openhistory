import { resolve } from "node:path";
import { analyzeEventQuality } from "../src/main/event-quality";
import { loadActivityEvents } from "../src/main/activity-event-file";

const dataDirectory = process.argv[2] || process.env.OPENHISTORY_DATA_DIR || process.env.COMPUTER_HISTORY_DATA_DIR;
if (!dataDirectory) {
  console.error("Usage: npm run benchmark:events -- /path/to/activity-data");
  process.exitCode = 1;
} else {
  const resolvedDirectory = resolve(dataDirectory);
  const coldStartedAt = performance.now();
  const events = loadActivityEvents(resolvedDirectory);
  const coldLoadMs = performance.now() - coldStartedAt;
  const warmStartedAt = performance.now();
  loadActivityEvents(resolvedDirectory);
  const warmLoadMs = performance.now() - warmStartedAt;
  console.log(JSON.stringify({
    ...analyzeEventQuality(events),
    loaderTimingMs: {
      cold: Math.round(coldLoadMs * 100) / 100,
      cached: Math.round(warmLoadMs * 100) / 100
    }
  }, null, 2));
}
