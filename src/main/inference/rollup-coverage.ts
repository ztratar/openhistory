import type { DailyRollupDraft } from "../daily-rollup-schema";
import type { HourDraft } from "../hour-schema";
import type { HourItem, TimelineItem } from "@shared/contracts";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had", "has",
  "have", "in", "into", "is", "it", "its", "no", "of", "on", "or", "that", "the", "their", "then",
  "this", "to", "was", "were", "with"
]);

export function ensureAppleHourCoverage(draft: HourDraft, items: TimelineItem[]): HourDraft {
  const bullets = summaryBullets(draft.summary);
  cleanGeneratedBullets(bullets, 34, false);
  removeShorterNearDuplicates(bullets);
  const minimumWords = items.length >= 3 ? 32 : items.length === 2 ? 24 : 1;
  const candidates = items.map((item) => ({
    text: boundedSentence(item.description, 34, item.title),
    evidence: `${item.title} ${item.description} ${item.decisions.join(" ")} ${item.outcomes.join(" ")} ${item.blockers.join(" ")}`,
    score: materialScore(item)
  })).filter(({ text }) => text.length > 0).sort((left, right) => right.score - left.score);

  supplementBullets(bullets, candidates, minimumWords, 4);
  return {
    ...draft,
    title: normalizedTitle(draft.title, items[0]?.title),
    summary: bullets.map((bullet) => `- ${bullet}`).join("\n")
  };
}

export function fallbackAppleHourDraft(items: TimelineItem[]): HourDraft {
  const primary = [...items].sort((left, right) => materialScore(right) - materialScore(left))[0];
  const draft: HourDraft = {
    title: primary?.title ?? "Summarized local work activity",
    summary: `- ${primary?.description ?? "Summarized the available local work history."}`,
    workThreads: unique(items.flatMap((item) => item.workThreads), 8),
    decisions: unique(items.flatMap((item) => item.decisions), 8),
    outcomes: unique(items.flatMap((item) => item.outcomes), 8),
    blockers: unique(items.flatMap((item) => item.blockers), 8),
    surfaces: unique(items.flatMap((item) => item.surfaces), 12),
    linkReferences: []
  };
  return ensureAppleHourCoverage(draft, items);
}

export function ensureAppleDayCoverage(
  draft: DailyRollupDraft,
  hours: HourItem[],
  unrolledTimeline: TimelineItem[],
  allTimelineItems: TimelineItem[] = unrolledTimeline
): DailyRollupDraft {
  const bullets = summaryBullets(draft.summary);
  cleanGeneratedBullets(bullets, 36, true);
  removeShorterNearDuplicates(bullets);
  const candidates = [
    ...hours.flatMap((hour) => summaryBullets(hour.summary).map((text, index) => ({
      text: boundedSentence(text, 36, hour.title),
      evidence: `${hour.title} ${text}`,
      score: 30 + hour.sourceTimelineIds.length * 2 - index - (isTelemetryLike(text) ? 25 : 0)
    }))),
    ...allTimelineItems.map((item) => ({
      text: boundedSentence(item.description, 36, item.title),
      evidence: `${item.title} ${item.description}`,
      score: 50 + materialScore(item)
    }))
  ].filter(({ text }) => text.length > 0 && !isArtifactLike(text)).sort((left, right) => right.score - left.score);
  const sourceCount = hours.length + allTimelineItems.length;
  const minimumWords = sourceCount >= 4 ? 52 : sourceCount >= 2 ? 30 : 1;

  supplementBullets(bullets, candidates, minimumWords, 5);
  return {
    ...draft,
    title: normalizedTitle(draft.title, hours[0]?.title ?? unrolledTimeline[0]?.title),
    summary: bullets.map((bullet) => `- ${bullet}`).join("\n")
  };
}

export function fallbackAppleDayDraft(
  hours: HourItem[],
  unrolledTimeline: TimelineItem[],
  allTimelineItems: TimelineItem[] = unrolledTimeline
): DailyRollupDraft {
  const primaryHour = [...hours].sort((left, right) =>
    right.sourceTimelineIds.length - left.sourceTimelineIds.length
  )[0];
  const primaryTimeline = [...unrolledTimeline].sort((left, right) =>
    materialScore(right) - materialScore(left)
  )[0];
  const summary = primaryHour?.summary ?? primaryTimeline?.description ?? "Summarized the available local work history.";
  const draft: DailyRollupDraft = {
    title: primaryHour?.title ?? primaryTimeline?.title ?? "Summarized local work activity",
    summary,
    themes: unique([
      ...hours.flatMap((hour) => hour.workThreads),
      ...unrolledTimeline.flatMap((item) => item.workThreads)
    ], 12),
    accomplishments: unique([
      ...hours.flatMap((hour) => hour.outcomes),
      ...unrolledTimeline.flatMap((item) => item.outcomes)
    ], 12),
    decisions: unique([
      ...hours.flatMap((hour) => hour.decisions),
      ...unrolledTimeline.flatMap((item) => item.decisions)
    ], 12),
    unfinishedWork: unique([
      ...hours.flatMap((hour) => hour.blockers),
      ...unrolledTimeline.flatMap((item) => item.blockers)
    ], 12),
    recurringPatterns: [],
    linkReferences: []
  };
  return ensureAppleDayCoverage(draft, hours, unrolledTimeline, allTimelineItems);
}

function supplementBullets(
  bullets: string[],
  candidates: Array<{ text: string; evidence: string; score: number }>,
  minimumWords: number,
  maximumBullets: number
): void {
  for (const candidate of candidates) {
    if (wordCount(bullets.join(" ")) >= minimumWords || bullets.length >= maximumBullets) break;
    if (coverage(candidate.evidence, bullets.join(" ")) >= 0.45) continue;
    if (bullets.some((bullet) => similarity(bullet, candidate.text) >= 0.32)) continue;
    bullets.push(candidate.text);
  }
}

function summaryBullets(value: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const prepared = value.trim().replace(/\s+\/\s+-\s+/g, " / ");
  for (const raw of prepared.split(/\r?\n+|\s+(?=[-•]\s+)/)) {
    const bullet = raw.trim().replace(/^(?:[-•]\s*)+/, "").replace(/;\s*$/, "").trim();
    if (!bullet) continue;
    const key = bullet.toLocaleLowerCase();
    if (seen.has(key)) continue;
    result.push(bullet);
    seen.add(key);
  }
  return result;
}

function normalizedTitle(value: string, fallback?: string): string {
  const title = value.trim().replace(/^(?:[-•]\s*)+/, "").replace(/[.]+$/, "").trim();
  const count = wordCount(title);
  if (count >= 4 && count <= 10) return title;
  const safeFallback = fallback?.trim().replace(/^(?:[-•]\s*)+/, "").replace(/[.]+$/, "").trim();
  if (safeFallback && wordCount(safeFallback) >= 4 && wordCount(safeFallback) <= 10) return safeFallback;
  if (count === 3) {
    const words = title.split(/\s+/);
    const modifier = /\b(?:login|macos|settings|system)\b/i.test(title) ? "macOS" : "local";
    return `${words[0]} ${modifier} ${words.slice(1).join(" ")}`;
  }
  return title.split(/\s+/).slice(0, 10).join(" ");
}

function boundedSentence(value: string, maximumWords: number, fallback: string): string {
  const normalized = value.replace(/\.;/g, ";").replace(/\s+/g, " ").trim() || fallback.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const firstTwoSentences = normalized.match(/^.*?[.!?](?:\s+.*?[.!?])?/)?.[0] ?? normalized;
  const words = firstTwoSentences.split(/\s+/).filter(Boolean);
  return words.length <= maximumWords
    ? firstTwoSentences
    : `${words.slice(0, maximumWords).join(" ").replace(/[,:;]$/, "")}…`;
}

function cleanGeneratedBullets(bullets: string[], maximumWords: number, removeTelemetry: boolean): void {
  const cleaned = bullets.map((bullet) => {
    const withoutNestedChrome = bullet
      .replace(/\s*\([^)]*\/[^)]*\)/g, "")
      .replace(/\s*\([^)]*\/\s+-.*$/i, "")
      .replace(/\s+\/\s+-.*$/i, "")
      .trim();
    return boundedSentence(withoutNestedChrome, maximumWords, bullet);
  }).filter(Boolean);
  const substantive = removeTelemetry
    ? cleaned.filter((bullet) => !isTelemetryLike(bullet) && !isArtifactLike(bullet))
    : cleaned;
  bullets.splice(0, bullets.length, ...(removeTelemetry ? substantive : cleaned));
}

function isTelemetryLike(value: string): boolean {
  return /^(?:clicked|displayed|navigated|opened|used|viewed)\b.*\b(?:application|controls?|interface|page|screen|window)\b/i.test(value);
}

function isArtifactLike(value: string): boolean {
  const trimmed = value.trim();
  const bareUiLabel = /^(?:[\p{Lu}][\p{L}'’-]*)(?:\s+[\p{Lu}][\p{L}'’-]*)?\)?$/u.test(trimmed);
  return /^(?:part of group\b|google chrome\b)/i.test(trimmed) || bareUiLabel || /\s\/\s-\s/.test(trimmed);
}

function materialScore(item: TimelineItem): number {
  const durationMinutes = Math.max(0, (Date.parse(item.endTime) - Date.parse(item.startTime)) / 60_000);
  return Math.min(durationMinutes, 20) + Math.min(wordCount(item.description), 30) +
    5 * (item.decisions.length + item.outcomes.length + item.blockers.length);
}

function coverage(evidence: string, candidate: string): number {
  const evidenceTokens = new Set(tokens(evidence));
  if (!evidenceTokens.size) return 1;
  const candidateTokens = new Set(tokens(candidate));
  let overlap = 0;
  for (const token of evidenceTokens) if (candidateTokens.has(token)) overlap += 1;
  return overlap / evidenceTokens.size;
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function tokens(value: string): string[] {
  return (value.toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [])
    .filter((token) => !STOP_WORDS.has(token));
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function removeShorterNearDuplicates(bullets: string[]): void {
  for (let left = 0; left < bullets.length; left += 1) {
    for (let right = bullets.length - 1; right > left; right -= 1) {
      if (similarity(bullets[left]!, bullets[right]!) < 0.32) continue;
      if (wordCount(bullets[left]!) >= wordCount(bullets[right]!)) bullets.splice(right, 1);
      else {
        bullets.splice(left, 1);
        left -= 1;
        break;
      }
    }
  }
}

function unique(values: string[], maximum: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}
