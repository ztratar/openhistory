"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: HTMLElement) => void;
      };
    };
  }
}

const widgetSrc = "https://platform.twitter.com/widgets.js";

export function XFollowButton({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.twttr?.widgets) {
      window.twttr.widgets.load(containerRef.current ?? undefined);
      return;
    }

    if (document.querySelector(`script[src="${widgetSrc}"]`)) return;

    const script = document.createElement("script");
    script.src = widgetSrc;
    script.async = true;
    script.charset = "utf-8";
    document.body.appendChild(script);
  }, []);

  return (
    <div className={`x-follow-widget ${className}`.trim()} ref={containerRef}>
      <a
        className="twitter-follow-button"
        href="https://x.com/zachtratar"
        data-size="large"
        data-show-count="false"
        data-show-screen-name="true"
        data-dnt="true"
        aria-label="Follow Zach Tratar on X"
      >
        Follow @zachtratar
      </a>
    </div>
  );
}
