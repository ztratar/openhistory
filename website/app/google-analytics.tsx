"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function destinationPath(element: HTMLAnchorElement): string | undefined {
  if (!element.href) return undefined;

  try {
    const url = new URL(element.href, window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function GoogleAnalyticsClickTracking() {
  useEffect(() => {
    const trackClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const element = target.closest<HTMLElement>("[data-analytics-id]");
      if (!element) return;

      const link = element instanceof HTMLAnchorElement ? element : null;

      window.gtag?.("event", "site_click", {
        click_id: element.dataset.analyticsId,
        element_type: element.tagName.toLowerCase(),
        link_url: link ? destinationPath(link) : undefined,
        page_path: window.location.pathname,
      });
    };

    document.addEventListener("click", trackClick);
    return () => document.removeEventListener("click", trackClick);
  }, []);

  return null;
}
