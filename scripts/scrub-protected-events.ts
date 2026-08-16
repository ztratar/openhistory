import { resolve } from "node:path";
import { scrubProtectedActivityEvents } from "../src/main/activity-event-file";

const dataDirectory = process.argv[2] || process.env.OPENHISTORY_DATA_DIR || process.env.COMPUTER_HISTORY_DATA_DIR;
if (!dataDirectory) {
  console.error("Usage: npm run privacy:scrub-protected -- /path/to/activity-data");
  process.exitCode = 1;
} else {
  const removed = scrubProtectedActivityEvents(resolve(dataDirectory));
  console.log(`Removed ${removed} protected event(s).`);
}
