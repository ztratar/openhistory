import { createHash } from "node:crypto";
import type { TimelineItem } from "@shared/contracts";

export function timelineRevision(item: TimelineItem): string | undefined {
  if (!item.sourceEventIds) return undefined;
  const digest = createHash("sha256")
    .update(item.sourceEventIds.join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `${item.id}:${digest}`;
}
