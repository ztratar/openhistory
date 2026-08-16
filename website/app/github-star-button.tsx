"use client";

import GitHubButton from "react-github-btn";

export function GitHubStarButton() {
  return (
    <GitHubButton
      href="https://github.com/ztratar/openhistory"
      data-color-scheme="no-preference: light; light: light; dark: dark;"
      data-size="large"
      data-show-count="true"
      aria-label="Star ztratar/openhistory on GitHub"
    >
      Star
    </GitHubButton>
  );
}
