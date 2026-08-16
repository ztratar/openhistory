import type { HistoryLink } from "./contracts";

export type HistoryTextSegment =
  | { text: string }
  | { text: string; url: string };

export function linkifyHistoryText(text: string, links: HistoryLink[] | undefined): HistoryTextSegment[] {
  const usable = uniqueLinks(links).sort((left, right) => right.label.length - left.label.length);
  if (!usable.length || !text) return [{ text }];

  const segments: HistoryTextSegment[] = [];
  let remaining = text;
  while (remaining) {
    let next: { index: number; link: HistoryLink } | undefined;
    for (const link of usable) {
      const index = remaining.toLocaleLowerCase().indexOf(link.label.toLocaleLowerCase());
      if (index < 0) continue;
      if (!next || index < next.index || (index === next.index && link.label.length > next.link.label.length)) {
        next = { index, link };
      }
    }
    if (!next) {
      segments.push({ text: remaining });
      break;
    }
    if (next.index > 0) segments.push({ text: remaining.slice(0, next.index) });
    const label = remaining.slice(next.index, next.index + next.link.label.length);
    segments.push({ text: label, url: next.link.url });
    remaining = remaining.slice(next.index + next.link.label.length);
  }
  return segments;
}

export function historySummaryAsMarkdown(summary: string, links: HistoryLink[] | undefined): string {
  return summary.split("\n").map((line) => linkifyHistoryText(line, links).map((segment) => {
    if (!("url" in segment)) return segment.text;
    return `[${escapeMarkdownLabel(segment.text)}](<${segment.url}>)`;
  }).join("")).join("\n");
}

function uniqueLinks(links: HistoryLink[] | undefined): HistoryLink[] {
  const seen = new Set<string>();
  return (links ?? []).filter((link) => {
    const key = `${link.label.toLocaleLowerCase()}\n${link.url}`;
    if (!link.label.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}
