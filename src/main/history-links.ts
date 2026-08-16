import type { ActivityEpisode, HistoryLink } from "@shared/contracts";

const MAX_EPISODE_LINKS = 12;
const MAX_ROLLUP_LINKS = 5;

export interface HistoryLinkCandidate extends HistoryLink {
  reference: string;
  domain: string;
}

export function episodeHistoryLinks(episode: ActivityEpisode): HistoryLink[] {
  const links = new Map<string, { link: HistoryLink; sequence: number }>();
  episode.events.forEach((event, sequence) => {
    if (!event.browser) return;
    const normalized = normalizedHistoryUrl(event.browser.url);
    if (!normalized) return;
    links.set(normalized, {
      link: {
        label: historyLinkLabel(normalized, event.browser.title),
        url: normalized
      },
      sequence
    });
  });
  return [...links.values()]
    .sort((left, right) =>
      linkPriority(right.link) - linkPriority(left.link) || right.sequence - left.sequence
    )
    .slice(0, MAX_EPISODE_LINKS)
    .map(({ link }) => link);
}

export function rollupLinkCandidates(sources: Array<{ links?: HistoryLink[] }>): HistoryLinkCandidate[] {
  const links = new Map<string, HistoryLink>();
  for (const source of sources) {
    for (const link of source.links ?? []) {
      const normalized = normalizedHistoryUrl(link.url);
      if (!normalized || links.has(normalized)) continue;
      const label = link.label.replace(/\s+/g, " ").trim().slice(0, 160);
      if (!label) continue;
      links.set(normalized, { label, url: normalized });
    }
  }
  return [...links.values()].slice(0, 20).map((link, index) => ({
    ...link,
    reference: `link-${index + 1}`,
    domain: new URL(link.url).hostname
  }));
}

export function selectedRollupLinks(
  summary: string,
  candidates: HistoryLinkCandidate[],
  references: string[]
): HistoryLink[] {
  const byReference = new Map(candidates.map((candidate) => [candidate.reference, candidate]));
  const selected: HistoryLink[] = [];
  const seenUrls = new Set<string>();
  const seenLabels = new Set<string>();
  for (const reference of references) {
    const candidate = byReference.get(reference);
    const labelKey = candidate?.label.toLocaleLowerCase();
    if (!candidate || !labelKey || seenUrls.has(candidate.url) || seenLabels.has(labelKey)) continue;
    const label = exactSummaryLabel(summary, candidate.label);
    if (!label) continue;
    selected.push({ label, url: candidate.url });
    seenUrls.add(candidate.url);
    seenLabels.add(labelKey);
    if (selected.length >= MAX_ROLLUP_LINKS) break;
  }
  return selected;
}

export function historyLinkCandidatesForModel(candidates: HistoryLinkCandidate[]): object[] {
  return candidates.map(({ reference, label, domain }) => ({ reference, label, domain }));
}

function exactSummaryLabel(summary: string, label: string): string | undefined {
  const index = summary.toLocaleLowerCase().indexOf(label.toLocaleLowerCase());
  return index < 0 ? undefined : summary.slice(index, index + label.length);
}

function normalizedHistoryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.hash = "";

    const githubSurface = url.hostname.toLocaleLowerCase() === "github.com"
      ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/i)
      : undefined;
    if (githubSurface) {
      url.pathname = `/${githubSurface[1]}/${githubSurface[2]}/${githubSurface[3]}/${githubSurface[4]}`;
      url.search = "";
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function historyLinkLabel(urlValue: string, title: string | undefined): string {
  const url = new URL(urlValue);
  const githubSurface = url.hostname.toLocaleLowerCase() === "github.com"
    ? url.pathname.match(/^\/[^/]+\/[^/]+\/(pull|issues)\/(\d+)$/i)
    : undefined;
  if (githubSurface?.[1] === "pull") return `Pull Request #${githubSurface[2]}`;
  if (githubSurface?.[1] === "issues") return `Issue #${githubSurface[2]}`;

  const cleanTitle = title
    ?.replace(/\s+[-–—]\s+(?:Google Chrome|Safari|Mozilla Firefox|Firefox|Microsoft Edge)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleanTitle || url.hostname).slice(0, 160);
}

function linkPriority(link: HistoryLink): number {
  if (/^Pull Request #\d+$/i.test(link.label)) return 3;
  if (/^Issue #\d+$/i.test(link.label)) return 2;
  return 1;
}
